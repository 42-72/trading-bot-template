import { observable, runInAction } from 'mobx';
import { useStore } from '@/hooks/useStore';
import AiScannerStore from '@/stores/ai-scanner-store';
import RootStore from '@/stores/root-store';
import { loadBotIntoBuilder } from '@/utils/load-bot-into-builder';
import { act, render } from '@testing-library/react';
import AiScanner from '../ai-scanner';

// The real AiScanner, MarketFeed and useDigitAnalysis against a fake socket:
// once the winner is picked, scanner feeds must go completely quiet.

jest.mock('../../../assets/ai-engine/bull-ai-overunder.xml', () => {
    const { readFileSync } = jest.requireActual('fs');
    const { join } = jest.requireActual('path');
    return readFileSync(join(__dirname, '../../../assets/ai-engine/bull-ai-overunder.xml'), 'utf8');
});
jest.mock('@/utils/load-bot-into-builder', () => ({ loadBotIntoBuilder: jest.fn() }));
jest.mock('@/hooks/useApiBase', () => ({ useApiBase: () => ({ connectionStatus: 'opened', isAuthorized: true }) }));
jest.mock('@/hooks/useSyntheticSymbols', () => ({ useSyntheticSymbols: () => [], MARKET_TOOL_SUBMARKETS: [] }));
jest.mock('@deriv-com/ui', () => ({ useDevice: () => ({ isDesktop: true }) }));
jest.mock('../ai-scanner-button', () => () => null);
jest.mock('../ai-scanner-panel', () => () => null);

type TListener = (message: unknown) => void;
const socket = {
    listeners: new Set<TListener>(),
    requests: [] as Record<string, unknown>[],
};
jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: {
        api: {
            send: jest.fn(async (request: Record<string, unknown>) => {
                socket.requests.push(request);
                if ('contracts_for' in request) {
                    return {
                        contracts_for: {
                            available: ['DIGITOVER', 'DIGITUNDER'].map(contract_type => ({
                                contract_type,
                                min_contract_duration: '1t',
                                max_contract_duration: '10t',
                            })),
                        },
                    };
                }
                if ('ticks_history' in request) {
                    const symbol = request.ticks_history as string;
                    return {
                        history: {
                            prices: Array.from({ length: 600 }, (_, i) => 100 + i / 100),
                            times: Array.from({ length: 600 }, (_, i) => i + 1),
                        },
                        pip_size: 2,
                        subscription: { id: `sub-${symbol}` },
                    };
                }
                return {};
            }),
            onMessage: () => ({
                subscribe: (listener: TListener) => {
                    socket.listeners.add(listener);
                    return { unsubscribe: () => socket.listeners.delete(listener) };
                },
            }),
        },
    },
}));

jest.mock('@/hooks/useStore', () => ({ useStore: jest.fn() }));

const MARKETS = [
    { symbol: '1HZ10V', text: 'Volatility 10 (1s) Index', submarket: 'random_index' },
    { symbol: '1HZ50V', text: 'Volatility 50 (1s) Index', submarket: 'random_index' },
    { symbol: 'JD50', text: 'Jump 50 Index', submarket: 'jump_index' },
];

const flush = async () => {
    await act(async () => {
        for (let i = 0; i < 30; i++) await Promise.resolve();
    });
};

const tick = (symbol: string, epoch: number) => {
    act(() => {
        socket.listeners.forEach(listener =>
            listener({ data: { msg_type: 'tick', tick: { symbol, quote: 105.01, epoch } } })
        );
    });
};

describe('AI Scanner feeds after the winner', () => {
    let workspace_xml = '';
    const workspace: { current_strategy_id?: string } = {};

    beforeEach(() => {
        jest.useFakeTimers();
        socket.listeners.clear();
        socket.requests = [];
        localStorage.clear();
        (window as unknown as { Blockly: unknown }).Blockly = {
            derivWorkspace: workspace,
            Xml: { workspaceToDom: () => null, domToText: () => workspace_xml },
        };
        (loadBotIntoBuilder as jest.Mock).mockImplementation(async ({ block_string, strategy_id }) => {
            workspace_xml = block_string;
            workspace.current_strategy_id = strategy_id;
            return true;
        });
    });

    afterEach(() => jest.useRealTimers());

    // The real AiScanner, feeds and hook, scanning 3 markets with the TEST
    // strategy (every market qualifies on its seed, any live tick enters).
    const startScanning = async () => {
        const run_panel = observable(
            {
                is_running: false,
                has_open_contract: false,
                is_drawer_open: false,
                get is_stop_button_visible(): boolean {
                    return this.is_running || this.has_open_contract;
                },
                clearStat: jest.fn(),
                onRunButtonClick: jest.fn(async () => {
                    runInAction(() => (run_panel.is_running = true));
                }),
                onStopBotClick: jest.fn(),
                dbot: { saveRecentWorkspace: jest.fn() },
            },
            { clearStat: false, onRunButtonClick: false, onStopBotClick: false, dbot: false }
        );
        const root = {
            run_panel,
            client: observable({ is_logged_in: true, currency: 'USD', is_virtual: true, loginid: 'VRTC1' }),
            transactions: observable({ statistics: { total_profit: 0, number_of_runs: 0 } }),
            dashboard: { setActiveTab: jest.fn() },
        } as unknown as RootStore;
        const store = new AiScannerStore(root);
        (useStore as jest.Mock).mockReturnValue({ ...root, ai_scanner: store });

        render(<AiScanner />);
        store.setMarkets(MARKETS);
        store.setFormField('strategy', 'over');
        store.setFormField('stake', '0.35');
        store.setFormField('martingale', '2');
        store.setFormField('take_profit', '5');
        store.setFormField('stop_loss', '10');
        store.setUseTestStrategy(true);
        act(() => store.start());
        await flush(); // contracts_for -> scanning -> feeds mount and seed
        expect(store.stage).toBe('scanning');
        expect(socket.requests.filter(request => 'ticks_history' in request)).toHaveLength(3);
        expect(socket.listeners.size).toBe(3);
        return { store, run_panel };
    };
    const advance = async (ms: number) => {
        await act(async () => {
            jest.advanceTimersByTime(ms);
        });
        await flush();
    };
    const forgets = () => socket.requests.filter(request => 'forget' in request).map(request => request.forget);

    it('qualifying loads nothing and sends no forget_all; the winner: feeds closed, then load, then quiet for 60s', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        let forgets_at_load: unknown[] | null = null;
        (loadBotIntoBuilder as jest.Mock).mockImplementation(async ({ block_string, strategy_id }) => {
            forgets_at_load = forgets();
            workspace_xml = block_string;
            workspace.current_strategy_id = strategy_id;
            return true;
        });
        const { store } = await startScanning();
        expect(store.qualified).toHaveLength(3); // all qualified on their seed
        expect(loadBotIntoBuilder).not.toHaveBeenCalled();
        expect(socket.requests.some(request => 'forget_all' in request)).toBe(false);

        // Ticks arrive a second apart (the hook stamps each with Date.now()).
        await advance(1000);
        tick('JD50', 601); // the TEST strategy's entry on JD50
        await advance(100); // Run waits (20ms polls) for every feed to close
        expect(store.target?.symbol).toBe('JD50');
        expect(store.stage).toBe('running');

        // Every feed had forgotten its own stream before the engine loaded.
        expect((forgets_at_load as unknown as string[]).sort()).toEqual(['sub-1HZ10V', 'sub-1HZ50V', 'sub-JD50']);
        expect(loadBotIntoBuilder).toHaveBeenCalledTimes(1);
        expect(socket.listeners.size).toBe(0);

        const after_winner = socket.requests.length;
        await advance(60000);
        expect(socket.requests.slice(after_winner)).toEqual([]);
        expect(warn.mock.calls.filter(([message]) => String(message).includes('No tick for'))).toEqual([]);
        warn.mockRestore();
    });

    it('a watchdog re-seed (3s without ticks) is never taken as an entry', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { store, run_panel } = await startScanning();

        // No ticks for 3s: every feed re-subscribes and is seeded again.
        await advance(3000);
        expect(warn.mock.calls.filter(([message]) => String(message).includes('No tick for 3s'))).toHaveLength(3);
        expect(socket.requests.filter(request => 'ticks_history' in request)).toHaveLength(6);
        await advance(0);
        expect(store.stage).toBe('scanning');
        expect(run_panel.onRunButtonClick).not.toHaveBeenCalled();
        expect(loadBotIntoBuilder).not.toHaveBeenCalled();

        // The next real tick is the entry.
        await advance(1000);
        tick('1HZ10V', 601);
        await advance(100);
        expect(store.target?.symbol).toBe('1HZ10V');
        expect(run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('a feed that is still mounted closes itself the moment the scan ends', async () => {
        const root = {
            run_panel: observable({ is_running: false, has_open_contract: false, is_stop_button_visible: false }),
            client: observable({ is_logged_in: true, currency: 'USD', is_virtual: true, loginid: 'VRTC1' }),
            transactions: observable({ statistics: { total_profit: 0 } }),
            dashboard: { setActiveTab: jest.fn() },
        } as unknown as RootStore;
        const store = new AiScannerStore(root);
        (useStore as jest.Mock).mockReturnValue({ ...root, ai_scanner: store });
        runInAction(() => {
            store.stage = 'scanning';
        });

        // MarketFeed on its own - nothing above it will unmount it.
        const { default: MarketFeed } = await import('../market-feed');
        render(<MarketFeed symbol='1HZ50V' />);
        await flush();
        expect(socket.listeners.size).toBe(1);

        act(() => {
            runInAction(() => {
                store.stage = 'starting';
            });
        });
        await flush();
        expect(socket.requests.filter(request => 'forget' in request).map(request => request.forget)).toEqual([
            'sub-1HZ50V',
        ]);
        expect(socket.listeners.size).toBe(0);

        const closed_at = socket.requests.length;
        await act(async () => {
            jest.advanceTimersByTime(60000);
        });
        await flush();
        expect(socket.requests.slice(closed_at)).toEqual([]);
    });
});
