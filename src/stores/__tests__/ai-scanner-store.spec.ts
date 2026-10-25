import fs from 'fs';
import { observable, runInAction } from 'mobx';
import path from 'path';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { readEngineValues } from '@/utils/ai-engine-xml';
import { setTestStrategy } from '@/utils/ai-strategies/__mocks__/test-strategy';
import { loadBotIntoBuilder } from '@/utils/load-bot-into-builder';
import AiScannerStore, {
    CONDITIONS_NOT_MET_MESSAGE,
    DEFAULT_FORM,
    NO_MARKETS_OFFERED_MESSAGE,
    SCAN_STOPPED_MESSAGE,
} from '../ai-scanner-store';
import RootStore from '../root-store';

// jest stubs *.xml imports - hand the store the real engine.
// The TEST strategy (tests only) drives scan -> load -> Run without real patterns.
jest.mock('@/utils/ai-strategies', () =>
    jest.requireActual('@/utils/ai-strategies/__mocks__/test-strategy').strategiesWithTestSwitch()
);
jest.mock('../../assets/ai-engine/bull-ai-overunder.xml', () => {
    const { readFileSync } = jest.requireActual('fs');
    const { join } = jest.requireActual('path');
    return readFileSync(join(__dirname, '../../assets/ai-engine/bull-ai-overunder.xml'), 'utf8');
});

jest.mock('../../assets/ai-engine/bull-ai-evenodd.xml', () => {
    const { readFileSync } = jest.requireActual('fs');
    const { join } = jest.requireActual('path');
    return readFileSync(join(__dirname, '../../assets/ai-engine/bull-ai-evenodd.xml'), 'utf8');
});

jest.mock('@/utils/load-bot-into-builder', () => ({ loadBotIntoBuilder: jest.fn() }));

// contracts_for on the app's socket: every market offers all digit contracts
// at 1-10 ticks unless a test says otherwise in `offerings`.
const ALL_DIGITS = ['DIGITMATCH', 'DIGITDIFF', 'DIGITODD', 'DIGITEVEN', 'DIGITOVER', 'DIGITUNDER'].map(
    contract_type => ({ contract_type, min_contract_duration: '1t', max_contract_duration: '10t' })
);
let offerings: Record<string, unknown[] | 'error'> = {};
jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: {
        api: {
            send: jest.fn(async ({ contracts_for }: { contracts_for: string }) => {
                const reply = offerings[contracts_for] ?? ALL_DIGITS;
                if (reply === 'error') throw { error: { code: 'InternalServerError', message: 'error' } };
                return { contracts_for: { available: reply } };
            }),
            // Messages of any kind on the app's socket (the silence watch listens).
            onMessage: () => ({
                subscribe: (listener: () => void) => {
                    mockSocketListeners.add(listener);
                    return { unsubscribe: () => mockSocketListeners.delete(listener) };
                },
            }),
        },
    },
}));
const mockSocketListeners = new Set<() => void>();
const socketMessage = () => mockSocketListeners.forEach(listener => listener());

const ENGINE = fs.readFileSync(path.join(__dirname, '../../assets/ai-engine/bull-ai-overunder.xml'), 'utf8');

const MARKETS = [
    { symbol: '1HZ10V', text: 'Volatility 10 (1s) Index', submarket: 'random_index' },
    { symbol: 'JD25', text: 'Jump 25 Index', submarket: 'jump_index' },
];

const full = (digit = 5) => new Array(600).fill(digit);

// Windows for the real Over strategy: three+ of 6-9 at 64+, each of 0-2 at 58
// or fewer. `tail` ends the window (and is part of the counts).
//                  0   1   2   3   4   5   6   7   8   9
const QUALIFYING = [58, 58, 58, 57, 57, 56, 64, 64, 64, 64];
const windowOf = (counts: number[], tail: number[] = []) => {
    const remaining = counts.slice();
    tail.forEach(digit => {
        remaining[digit] -= 1;
    });
    return [...remaining.flatMap((count, digit) => new Array(count).fill(digit)), ...tail];
};
// Qualifies, not an entry (ends ...9,9,9).
const qualifying = windowOf(QUALIFYING);
// Qualifies AND is an entry on its last tick (7, 9 then 1).
const entering = windowOf(QUALIFYING, [7, 9, 1]);
const faded = full(5);

// The Bot Builder workspace as the store sees it: whatever XML was loaded last.
let workspace_xml = '';
const workspace: { current_strategy_id?: string } = {};

const makeRoot = () => {
    const run_panel = observable(
        {
            is_running: false,
            has_open_contract: false,
            get is_stop_button_visible(): boolean {
                return this.is_running || this.has_open_contract;
            },
            clearStat: jest.fn(),
            onRunButtonClick: jest.fn(async (): Promise<void> => {
                runInAction(() => (run_panel.is_running = true));
            }),
            onStopBotClick: jest.fn((): void => {
                runInAction(() => (run_panel.is_running = false));
            }),
            dbot: { saveRecentWorkspace: jest.fn() },
        },
        // Keep the mocks as plain jest.fn()s, not MobX actions.
        { clearStat: false, onRunButtonClick: false, onStopBotClick: false, dbot: false }
    );
    const client = observable({ is_logged_in: true, currency: 'USD', is_virtual: true, loginid: 'VRTC1' });
    const transactions = observable({ statistics: { total_profit: 0 } });
    const dashboard = { setActiveTab: jest.fn() };
    return { run_panel, client, transactions, dashboard } as unknown as RootStore & {
        run_panel: typeof run_panel;
        client: typeof client;
        transactions: typeof transactions;
    };
};

const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
};

const fillForm = (store: AiScannerStore, strategy: 'over' | 'under' = 'over') => {
    store.setFormField('strategy', strategy);
    store.setFormField('stake', '0.35');
    store.setFormField('martingale', '2');
    store.setFormField('take_profit', '5');
    store.setFormField('stop_loss', '10');
};

// Scan & Run, then let the contracts_for check finish.
const startScan = async (
    strategy: 'over' | 'under' = 'over',
    use_test = false,
    tab: 'over_under' | 'even_odd' = 'over_under'
) => {
    const root = makeRoot();
    const store = new AiScannerStore(root);
    store.setMarkets(MARKETS);
    store.setActiveTab(tab);
    fillForm(store, strategy);
    setTestStrategy(use_test);
    store.start();
    await flush();
    return { root, store };
};

const armedSymbols = (store: AiScannerStore) => store.armed.map(market => market.symbol);
const armedOf = (store: AiScannerStore, symbol: string) => store.armed.find(market => market.symbol === symbol);
// No longer meets Over's condition, but its last ticks (7, 9, then 1) are an entry.
const fadedEntering = [...full(5).slice(3), 7, 9, 1];

describe('AiScannerStore', () => {
    beforeEach(() => {
        localStorage.clear();
        offerings = {};
        workspace_xml = '';
        delete workspace.current_strategy_id;
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

    describe('the form', () => {
        it('starts on the defaults - stake 10, martingale 2, TP 20, SL 50 - which are valid', async () => {
            const store = new AiScannerStore(makeRoot());
            store.setMarkets(MARKETS);
            expect(store.form).toEqual({
                strategy: 'over',
                stake: '10',
                martingale: '2',
                take_profit: '20',
                stop_loss: '50',
            });
            expect(store.form).toEqual(DEFAULT_FORM);
            expect(store.can_start).toBe(true);
        });

        it('keeps Scan disabled until all four values are valid - and has no upper limits', async () => {
            const store = new AiScannerStore(makeRoot());
            store.setMarkets(MARKETS);
            store.setFormField('stake', '');
            expect(store.can_start).toBe(false);
            fillForm(store);
            expect(store.can_start).toBe(true);
            store.setFormField('stake', '100000');
            store.setFormField('martingale', '50');
            store.setFormField('take_profit', '999999');
            store.setFormField('stop_loss', '999999');
            expect(store.form_errors).toEqual({});
            expect(store.can_start).toBe(true);
            store.setFormField('stake', '0.34');
            expect(store.form_errors.stake).toBeDefined();
            store.setFormField('stake', '0.35');
            store.setFormField('martingale', '0.9');
            expect(store.can_start).toBe(false);
            store.setFormField('martingale', '1');
            store.setFormField('stop_loss', '0');
            expect(store.can_start).toBe(false);
        });

        it('refuses to start while a bot is running, or on a non-USD account', async () => {
            const root = makeRoot();
            const store = new AiScannerStore(root);
            store.setMarkets(MARKETS);
            fillForm(store);
            runInAction(() => (root.run_panel.is_running = true));
            expect(store.start_blocker).toMatch(/already running/);
            runInAction(() => {
                root.run_panel.is_running = false;
                root.client.currency = 'EUR';
            });
            expect(store.start_blocker).toMatch(/USD/);
        });

        it('a page load never restores the previous values - the defaults every time', async () => {
            localStorage.setItem('ai_scanner_form', JSON.stringify({ strategy: 'under', stake: '3' }));
            const first = new AiScannerStore(makeRoot());
            fillForm(first, 'under');
            const second = new AiScannerStore(makeRoot()); // the reload
            expect(second.form).toEqual(DEFAULT_FORM);
            expect(localStorage.getItem('ai_scanner_form')).toBeNull();
        });

        it('switching strategy - Over <-> Under, or the Even/Odd tab - puts the defaults back', async () => {
            const store = new AiScannerStore(makeRoot());
            store.setFormField('stake', '3');
            store.setFormField('take_profit', '7');
            store.setFormField('strategy', 'under');
            expect(store.form).toEqual({ ...DEFAULT_FORM, strategy: 'under' });
            store.setFormField('stake', '4');
            store.setActiveTab('even_odd');
            expect(store.form).toMatchObject({ stake: '10', martingale: '2', take_profit: '20', stop_loss: '50' });
            store.setFormField('stop_loss', '9');
            store.setActiveTab('over_under');
            expect(store.form.stop_loss).toBe('50');
            // Picking the same strategy again changes nothing.
            store.setFormField('stake', '6');
            store.setFormField('strategy', 'under');
            expect(store.form.stake).toBe('6');
        });

        it('reopening the panel with nothing running starts fresh: defaults, no old result or message', async () => {
            const { root, store } = await startScan();
            store.setPanelOpen(true);
            store.onMarketTick('JD25', entering, 1, true);
            store.onMarketTick('JD25', entering, 1);
            await flush();
            runInAction(() => {
                root.transactions.statistics.total_profit = 5.2;
                root.run_panel.is_running = false;
            });
            expect(store.stage).toBe('stopped');
            expect(store.message).toMatch(/Take profit/);
            expect(store.final_profit).toBe(5.2);
            store.setFormField('stake', '3');

            store.setPanelOpen(false);
            store.togglePanel(); // reopen
            expect(store.is_panel_open).toBe(true);
            expect(store.stage).toBe('idle');
            expect(store.message).toBe('');
            expect(store.final_profit).toBeNull();
            expect(store.target).toBeNull();
            expect(store.form).toEqual(DEFAULT_FORM);
        });

        it('closing mid-scan keeps scanning; reopening shows the live scan, untouched', async () => {
            const { root, store } = await startScan();
            store.setPanelOpen(true);
            store.onMarketTick('JD25', qualifying, 9, true);
            store.setPanelOpen(false);
            expect(store.stage).toBe('scanning');
            expect(store.are_feeds_wanted).toBe(true);
            store.onMarketTick('JD25', entering, 1); // the entry, with the panel closed
            await flush();
            expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
            expect(store.stage).toBe('running');
            store.setPanelOpen(true);
            expect(store.stage).toBe('running');
            expect(store.target?.symbol).toBe('JD25');
            store.setPanelOpen(false); // closing never stops the bot
            expect(root.run_panel.onStopBotClick).not.toHaveBeenCalled();
            expect(store.stage).toBe('running');
        });

        it('the old hidden-switch key is cleared - the scanner shows for everyone', async () => {
            localStorage.setItem('ct_ai_scanner', '1');
            new AiScannerStore(makeRoot()); // eslint-disable-line no-new
            expect(localStorage.getItem('ct_ai_scanner')).toBeNull();
        });

        it('ships the engine unmodified', async () => {
            expect(readEngineValues(ENGINE).stake).toBe(20);
        });
    });

    describe('parallel markets', () => {
        it('with the default (Under) strategy, scans and never loads or runs anything', async () => {
            const { root, store } = await startScan('under');
            for (let i = 0; i < 50; i++) MARKETS.forEach(m => store.onMarketTick(m.symbol, full(i % 10), i % 10));
            await flush();
            expect(store.stage).toBe('scanning');
            expect(store.armed).toEqual([]);
            expect(loadBotIntoBuilder).not.toHaveBeenCalled();
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
        });

        it('qualifying loads nothing: every feed keeps running', async () => {
            const { store } = await startScan();
            store.onMarketTick('1HZ10V', qualifying, 9, true);
            store.onMarketTick('JD25', qualifying, 9, true);
            for (let i = 0; i < 10; i++) store.onMarketTick('JD25', qualifying, 9);
            await flush();
            expect(store.stage).toBe('scanning');
            expect(store.are_feeds_wanted).toBe(true);
            expect(armedSymbols(store)).toEqual(['1HZ10V', 'JD25']);
            expect(store.owns_workspace).toBe(false);
            expect(loadBotIntoBuilder).not.toHaveBeenCalled();
            expect(workspace_xml).toBe('');
        });

        it('entry: feeds closed, then load, then read-back, then Run - in that order', async () => {
            const { root, store } = await startScan();
            const order: string[] = [];
            const release = store.registerFeed(); // one feed still open at the entry
            (loadBotIntoBuilder as jest.Mock).mockImplementation(async ({ block_string, strategy_id }) => {
                order.push('load');
                workspace_xml = block_string;
                workspace.current_strategy_id = strategy_id;
                return true;
            });
            (window as unknown as { Blockly: { Xml: unknown } }).Blockly.Xml = {
                workspaceToDom: () => null,
                domToText: () => {
                    order.push('read-back');
                    return workspace_xml;
                },
            };
            root.run_panel.clearStat.mockImplementation(() => order.push('clearStat'));
            root.run_panel.onRunButtonClick.mockImplementation(async () => {
                order.push('run');
                runInAction(() => (root.run_panel.is_running = true));
            });

            store.onMarketTick('JD25', entering, 1, true);
            store.onMarketTick('JD25', entering, 1);
            await flush();
            expect(order).toEqual([]); // nothing loads while a feed is still open
            order.push('feeds closed');
            release();
            await new Promise(resolve => setTimeout(resolve, 60));
            await flush();
            expect(order).toEqual(['feeds closed', 'load', 'read-back', 'clearStat', 'run']);
            expect(store.stage).toBe('running');
        });

        it('two armed at once, the second hits its entry first: the second wins and the engine is on it', async () => {
            const { root, store } = await startScan();
            store.onMarketTick('1HZ10V', qualifying, 9, true);
            store.onMarketTick('JD25', qualifying, 9, true);
            await flush();
            expect(loadBotIntoBuilder).not.toHaveBeenCalled();

            store.onMarketTick('1HZ10V', qualifying, 9); // still qualified, no entry
            store.onMarketTick('JD25', entering, 1); // entry
            expect(store.stage).toBe('starting');
            expect(store.are_feeds_wanted).toBe(false); // every feed closes
            await flush();

            expect(store.target?.symbol).toBe('JD25');
            expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
            expect(loadBotIntoBuilder).toHaveBeenCalledTimes(1); // once, with the winner
            expect(readEngineValues(workspace_xml)).toMatchObject({
                symbol: 'JD25',
                submarket: 'jump_index',
                market: 'synthetic_index',
                stake: 0.35,
                stake_2: 0.35,
                martingale: 2,
                take_profit: 5,
                stop_loss: 10,
                ai_direction: 1,
                first_barrier: 2,
                recovery_barrier: 3,
            });
            expect(store.stage).toBe('running');
        });

        it('a market that qualified and then faded stays armed - the other can still win', async () => {
            const { root, store } = await startScan();
            store.onMarketTick('1HZ10V', qualifying, 9, true);
            store.onMarketTick('JD25', qualifying, 9, true);
            await flush();
            store.onMarketTick('1HZ10V', faded, 5);
            expect(armedSymbols(store)).toEqual(['1HZ10V', 'JD25']);
            expect(armedOf(store, '1HZ10V')?.still_met).toBe(false);
            expect(store.stage).toBe('scanning');
            expect(store.message).toBe('');

            store.onMarketTick('JD25', entering, 1);
            await flush();
            expect(store.target?.symbol).toBe('JD25');
            expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
            expect(readEngineValues(workspace_xml).symbol).toBe('JD25');
        });

        it('two entries on the same tick: only the first counts, only one Run', async () => {
            const { root, store } = await startScan();
            store.onMarketTick('1HZ10V', qualifying, 9, true);
            store.onMarketTick('JD25', qualifying, 9, true);
            await flush();
            store.onMarketTick('1HZ10V', entering, 1);
            store.onMarketTick('JD25', entering, 1);
            await flush();
            expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
            expect(store.target?.symbol).toBe('1HZ10V');
            expect(readEngineValues(workspace_xml).symbol).toBe('1HZ10V');
            expect(loadBotIntoBuilder).toHaveBeenCalledTimes(1);
        });

        it('symbol read back from the workspace is not the winner: no Run, and the panel says why', async () => {
            const { root, store } = await startScan();
            store.onMarketTick('1HZ10V', qualifying, 9, true);
            await flush();
            // The load for the winner "lands" on another market, as a refused
            // dropdown would leave it.
            (loadBotIntoBuilder as jest.Mock).mockImplementationOnce(async ({ block_string, strategy_id }) => {
                workspace_xml = block_string.replace(
                    '<field name="SYMBOL_LIST">JD25</field>',
                    '<field name="SYMBOL_LIST">1HZ10V</field>'
                );
                workspace.current_strategy_id = strategy_id;
                return true;
            });
            store.onMarketTick('JD25', entering, 1);
            await flush();
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
            expect(store.stage).toBe('idle');
            expect(store.message).toBe("Run not pressed: the engine's market is 1HZ10V, not the winning market JD25.");
        });

        it('any other locked value read back wrong: no Run either', async () => {
            const { root, store } = await startScan();
            (loadBotIntoBuilder as jest.Mock).mockImplementationOnce(async ({ block_string, strategy_id }) => {
                workspace_xml = block_string.replace(/(id="bull-ai-n-mart"><field name="NUM">)2</, '$19<');
                workspace.current_strategy_id = strategy_id;
                return true;
            });
            store.onMarketTick('JD25', entering, 1, true);
            store.onMarketTick('JD25', entering, 1);
            await flush();
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
            expect(store.message).toBe('Run not pressed: the engine bot does not hold the locked values.');
        });

        it('never enters on a re-seed of the window, only on a live tick', async () => {
            const { root, store } = await startScan();
            store.onMarketTick('JD25', entering, 1, true);
            await flush();
            store.onMarketTick('JD25', entering, 1, true);
            await flush();
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
            store.onMarketTick('JD25', entering, 1);
            await flush();
            expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
        });

        it('presses Run only after every scanner feed has stopped (and forgotten its stream)', async () => {
            const { root, store } = await startScan('over', true);
            const release = store.registerFeed();
            store.onMarketTick('1HZ10V', full(), 5, true);
            await flush();
            store.onMarketTick('1HZ10V', full(), 5);
            await flush();
            expect(store.stage).toBe('starting');
            expect(store.are_feeds_wanted).toBe(false);
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
            release();
            await new Promise(resolve => setTimeout(resolve, 60));
            await flush();
            expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
        });

        it('Stop scan while waiting for an entry: no load, no Run, feeds closed, "Scan stopped."', async () => {
            const { root, store } = await startScan();
            store.onMarketTick('1HZ10V', qualifying, 9, true);
            await flush();
            store.cancel();
            expect(store.stage).toBe('idle');
            expect(store.message).toBe(SCAN_STOPPED_MESSAGE);
            expect(store.are_feeds_wanted).toBe(false);
            expect(store.scan_deadline).toBeNull();
            expect(store.armed).toEqual([]);
            expect(store.form).toMatchObject({ strategy: 'over', stake: '0.35' });
            expect(store.can_start).toBe(true);
            expect(loadBotIntoBuilder).not.toHaveBeenCalled();
            store.onMarketTick('1HZ10V', entering, 1);
            await flush();
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
            expect(root.run_panel.onStopBotClick).not.toHaveBeenCalled();
        });

        it('Stop scan while scanning (nothing qualified yet): no load, no Run, feeds closed', async () => {
            const { root, store } = await startScan();
            store.onMarketTick('1HZ10V', faded, 5, true);
            store.cancel();
            expect(store.stage).toBe('idle');
            expect(store.message).toBe(SCAN_STOPPED_MESSAGE);
            expect(store.are_feeds_wanted).toBe(false);
            store.onMarketTick('JD25', entering, 1);
            await flush();
            expect(loadBotIntoBuilder).not.toHaveBeenCalled();
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
        });

        it('Stop scan while checking which markets offer the trade', async () => {
            const store = new AiScannerStore(makeRoot());
            store.setMarkets(MARKETS);
            fillForm(store);
            store.start();
            expect(store.stage).toBe('checking');
            store.cancel();
            await flush();
            expect(store.stage).toBe('idle');
            expect(store.message).toBe(SCAN_STOPPED_MESSAGE);
            expect(store.are_feeds_wanted).toBe(false);
        });

        it('owns the workspace (blocking the Market Tool sync) from the entry hit until the bot stops', async () => {
            const { root, store } = await startScan();
            expect(store.owns_workspace).toBe(false);
            store.onMarketTick('1HZ10V', qualifying, 9, true);
            expect(store.owns_workspace).toBe(false); // qualifying loads nothing
            await flush();
            store.onMarketTick('1HZ10V', entering, 1);
            expect(store.owns_workspace).toBe(true);
            await flush();
            expect(store.stage).toBe('running');
            expect(store.owns_workspace).toBe(true);
            runInAction(() => (root.run_panel.is_running = false));
            expect(store.stage).toBe('stopped');
            expect(store.owns_workspace).toBe(false);
        });

        it('the engine stops itself at take profit and the panel says so', async () => {
            const { root, store } = await startScan();
            store.onMarketTick('JD25', entering, 1, true);
            await flush();
            store.onMarketTick('JD25', entering, 1);
            await flush();
            expect(root.run_panel.clearStat).toHaveBeenCalled();
            runInAction(() => {
                root.transactions.statistics.total_profit = 5.2;
                root.run_panel.is_running = false;
            });
            expect(store.stage).toBe('stopped');
            expect(store.message).toMatch(/Take profit/);
        });
    });

    describe('all feeds silent together', () => {
        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        // Live ticks for every market, then silence at T.
        const liveTicks = (store: AiScannerStore) =>
            MARKETS.forEach(market => store.onMarketTick(market.symbol, faded, 5));

        it('all feeds stop at T: every feed re-subscribed at once between T+2.0s and T+2.3s', async () => {
            const { store } = await startScan();
            const retries = [jest.fn(), jest.fn()];
            retries.forEach(retry => store.registerFeed(retry));
            jest.advanceTimersByTime(1234); // any moment in the scan
            liveTicks(store); // T
            jest.advanceTimersByTime(1999);
            retries.forEach(retry => expect(retry).not.toHaveBeenCalled());
            jest.advanceTimersByTime(1); // T+2.0s
            retries.forEach(retry => expect(retry).toHaveBeenCalledTimes(1));
            jest.advanceTimersByTime(299); // still T+2.3s: once only
            retries.forEach(retry => expect(retry).toHaveBeenCalledTimes(1));
        });

        it('every live tick moves the deadline; a market that never ticks does not switch the watch off', async () => {
            const { store } = await startScan();
            const retry = jest.fn();
            store.registerFeed(retry);
            for (let i = 0; i < 10; i++) {
                store.onMarketTick('JD25', faded, 5); // only JD25 ever ticks live
                jest.advanceTimersByTime(1500);
            }
            expect(retry).not.toHaveBeenCalled();
            jest.advanceTimersByTime(500); // 2s after JD25's last tick
            expect(retry).toHaveBeenCalledTimes(1);
        });

        it('a second silence 3s after the first re-subscribe waits for the 5s throttle', async () => {
            const { store } = await startScan();
            const retry = jest.fn();
            store.registerFeed(retry);
            liveTicks(store); // T
            jest.advanceTimersByTime(2000); // R = T+2s: first re-subscribe
            expect(retry).toHaveBeenCalledTimes(1);
            jest.advanceTimersByTime(100);
            liveTicks(store); // ticks come straight back at R+0.1s...
            jest.advanceTimersByTime(900);
            liveTicks(store); // ...and stop again at R+1s
            jest.advanceTimersByTime(2000); // R+3s: silent 2s again - but inside the throttle
            expect(retry).toHaveBeenCalledTimes(1);
            jest.advanceTimersByTime(1999); // R+4.999s
            expect(retry).toHaveBeenCalledTimes(1);
            jest.advanceTimersByTime(1); // R+5s
            expect(retry).toHaveBeenCalledTimes(2);
        });

        it('a socket message re-checks at once - even when timers are being held back', async () => {
            const { store } = await startScan();
            const retry = jest.fn();
            store.registerFeed(retry);
            liveTicks(store);
            // The clock moves on but no timer runs (a throttled background tab)...
            jest.setSystemTime(Date.now() + 2100);
            expect(retry).not.toHaveBeenCalled();
            socketMessage(); // ...a balance / time / any message arrives
            expect(retry).toHaveBeenCalledTimes(1);
            socketMessage(); // throttled: not again
            expect(retry).toHaveBeenCalledTimes(1);
        });

        it('a re-subscribe never counts as an entry and never disarms an armed market', async () => {
            const { root, store } = await startScan();
            const retries = [jest.fn(), jest.fn()];
            retries.forEach(retry => store.registerFeed(retry));
            store.onMarketTick('JD25', qualifying, 9, true); // armed on its seed
            const armed = armedOf(store, 'JD25');
            store.onMarketTick('JD25', qualifying, 9);
            store.onMarketTick('1HZ10V', faded, 5);
            jest.advanceTimersByTime(2000);
            retries.forEach(retry => expect(retry).toHaveBeenCalledTimes(1));

            // The re-subscribes' seeds: an entry pattern on a seed never enters.
            store.onMarketTick('JD25', entering, 1, true);
            store.onMarketTick('1HZ10V', faded, 5, true);
            await flush();
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
            expect(armedOf(store, 'JD25')).toMatchObject({
                armed_at: armed?.armed_at,
                expires_at: armed?.expires_at,
            });
        });

        it('one silent market alone is left to its own watchdog', async () => {
            const { store } = await startScan();
            const retry = jest.fn();
            store.registerFeed(retry);
            store.onMarketTick('JD25', faded, 5);
            store.onMarketTick('1HZ10V', faded, 5);
            for (let i = 0; i < 10; i++) {
                jest.advanceTimersByTime(1000);
                store.onMarketTick('1HZ10V', faded, 5); // 1HZ10V keeps ticking
            }
            expect(retry).not.toHaveBeenCalled();
        });

        it('stops watching when the scan ends', async () => {
            const listeners_before = mockSocketListeners.size;
            const { store } = await startScan();
            expect(mockSocketListeners.size).toBe(listeners_before + 1); // its silence watch
            const retry = jest.fn();
            store.registerFeed(retry);
            MARKETS.forEach(market => store.onMarketTick(market.symbol, faded, 5));
            store.cancel();
            jest.advanceTimersByTime(30000);
            socketMessage();
            expect(retry).not.toHaveBeenCalled();
            expect(mockSocketListeners.size).toBe(listeners_before);
        });
    });

    describe('armed markets', () => {
        const MIN = 60 * 1000;
        const SEC = 1000;

        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        it('qualifies, then fades: stays armed and can still win on its entry', async () => {
            const { root, store } = await startScan();
            store.onMarketTick('JD25', qualifying, 9, true);
            expect(armedSymbols(store)).toEqual(['JD25']);
            jest.advanceTimersByTime(30 * SEC);
            store.onMarketTick('JD25', faded, 5);
            expect(armedSymbols(store)).toEqual(['JD25']);
            store.onMarketTick('JD25', fadedEntering, 1); // condition not met now - still its entry
            await flush();
            expect(store.target?.symbol).toBe('JD25');
            expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
        });

        it('reaching 3:00 without an entry disarms it; it re-arms later with a fresh 3:00', async () => {
            const { store } = await startScan();
            store.onMarketTick('JD25', qualifying, 9, true);
            const first = armedOf(store, 'JD25');
            expect(first?.expires_at).toBe(Date.now() + 3 * MIN);

            jest.advanceTimersByTime(3 * MIN - 1);
            expect(armedSymbols(store)).toEqual(['JD25']);
            jest.advanceTimersByTime(1);
            expect(store.armed).toEqual([]);
            expect(store.stage).toBe('scanning'); // before 5:00: the scan goes on

            jest.advanceTimersByTime(30 * SEC); // 3:30
            store.onMarketTick('JD25', qualifying, 9);
            expect(armedOf(store, 'JD25')?.expires_at).toBe(Date.now() + 3 * MIN);
            expect(armedOf(store, 'JD25')?.armed_at).toBe(Date.now());
        });

        it('several armed at once, each on its own clock', async () => {
            const { store } = await startScan();
            store.onMarketTick('1HZ10V', qualifying, 9, true);
            jest.advanceTimersByTime(1 * MIN);
            store.onMarketTick('JD25', qualifying, 9);
            expect(armedSymbols(store)).toEqual(['1HZ10V', 'JD25']);
            jest.advanceTimersByTime(2 * MIN); // 3:00
            expect(armedSymbols(store)).toEqual(['JD25']);
            jest.advanceTimersByTime(1 * MIN); // 4:00
            expect(store.armed).toEqual([]);
        });

        it('5:00 with nothing armed: "Conditions not met - no entry found.", feeds closed, Scan usable', async () => {
            const { root, store } = await startScan();
            MARKETS.forEach(market => store.onMarketTick(market.symbol, faded, 5, true));
            jest.advanceTimersByTime(5 * MIN - 1);
            expect(store.stage).toBe('scanning');
            jest.advanceTimersByTime(1);
            expect(store.stage).toBe('idle');
            expect(store.message).toBe('Conditions not met — no entry found.');
            expect(store.message).toBe(CONDITIONS_NOT_MET_MESSAGE);
            expect(store.are_feeds_wanted).toBe(false);
            expect(loadBotIntoBuilder).not.toHaveBeenCalled();
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
            expect(store.can_start).toBe(true);
            store.start();
            expect(store.stage).toBe('checking');
            await flush();
            expect(store.stage).toBe('scanning');
            expect(store.scan_deadline).toBe(Date.now() + 5 * MIN);
        });

        it('armed at 4:50: still waiting at 7:00, disarmed at 7:50 - and the scan stops if nothing else is armed', async () => {
            const { root, store } = await startScan();
            jest.advanceTimersByTime(4 * MIN + 50 * SEC);
            store.onMarketTick('JD25', qualifying, 9, true); // 4:50
            jest.advanceTimersByTime(10 * SEC); // 5:00 - armed, so no stop
            expect(store.stage).toBe('scanning');

            jest.advanceTimersByTime(2 * MIN); // 7:00
            store.onMarketTick('JD25', faded, 5); // fading changes nothing
            expect(store.stage).toBe('scanning');
            expect(armedSymbols(store)).toEqual(['JD25']);

            jest.advanceTimersByTime(50 * SEC - 1);
            expect(store.stage).toBe('scanning');
            jest.advanceTimersByTime(1); // 7:50
            expect(store.stage).toBe('idle');
            expect(store.message).toBe(CONDITIONS_NOT_MET_MESSAGE);
            expect(store.are_feeds_wanted).toBe(false);
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
            expect(loadBotIntoBuilder).not.toHaveBeenCalled();
        });

        it('past 5:00, a disarm leaves the scan running while another market is still armed', async () => {
            const { store } = await startScan();
            jest.advanceTimersByTime(4 * MIN);
            store.onMarketTick('1HZ10V', qualifying, 9, true); // 4:00 -> 7:00
            jest.advanceTimersByTime(2 * MIN);
            store.onMarketTick('JD25', qualifying, 9); // 6:00 -> 9:00
            jest.advanceTimersByTime(1 * MIN); // 7:00
            expect(armedSymbols(store)).toEqual(['JD25']);
            expect(store.stage).toBe('scanning');
            jest.advanceTimersByTime(2 * MIN); // 9:00
            expect(store.stage).toBe('idle');
        });

        it('armed past 5:00 can still win', async () => {
            const { root, store } = await startScan();
            jest.advanceTimersByTime(4 * MIN);
            store.onMarketTick('JD25', qualifying, 9, true);
            jest.advanceTimersByTime(2 * MIN); // 6:00
            store.onMarketTick('JD25', entering, 1);
            await flush();
            expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
        });

        it('Stop scan while armed: nothing loaded, all feeds closed, timers cleared', async () => {
            const { root, store } = await startScan();
            store.onMarketTick('JD25', qualifying, 9, true);
            store.onMarketTick('1HZ10V', qualifying, 9, true);
            store.cancel();
            expect(store.stage).toBe('idle');
            expect(store.message).toBe(SCAN_STOPPED_MESSAGE);
            expect(store.armed).toEqual([]);
            expect(store.are_feeds_wanted).toBe(false);
            expect(jest.getTimerCount()).toBe(0);
            jest.advanceTimersByTime(10 * MIN);
            expect(store.stage).toBe('idle');
            expect(store.message).toBe(SCAN_STOPPED_MESSAGE);
            expect(loadBotIntoBuilder).not.toHaveBeenCalled();
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
        });

        it('the tag follows the live condition, at once; the reason text is the latest check', async () => {
            const { store } = await startScan();
            store.onMarketTick('JD25', qualifying, 9, true);
            expect(armedOf(store, 'JD25')?.still_met).toBe(true);
            store.onMarketTick('JD25', faded, 5); // same second: the flip is still shown at once
            expect(armedOf(store, 'JD25')?.still_met).toBe(false);
            expect(armedOf(store, 'JD25')?.reason).toMatch(/not met/);
            jest.advanceTimersByTime(SEC);
            store.onMarketTick('JD25', qualifying, 9);
            expect(armedOf(store, 'JD25')?.still_met).toBe(true);
            expect(armedOf(store, 'JD25')?.reason).toMatch(/4 of 6-9 at 10.6%\+ \| .* all under 10%$/);
        });
    });

    describe('Under wins a scan', () => {
        // Under qualifies: three of 0-3 at 64+, each of 7-9 at 59 or fewer -
        // and its last ticks (1, 0, then 7) are Under's entry.
        //                         0   1   2   3   4   5   6   7   8   9
        const UNDER_QUALIFYING = [64, 64, 64, 64, 56, 57, 57, 58, 58, 58];
        const under_entering = windowOf(UNDER_QUALIFYING, [1, 0, 7]);

        it('writes AI DIRECTION 0, FIRST BARRIER 7, RECOVERY BARRIER 6 into the engine, reads them back, Runs', async () => {
            const { root, store } = await startScan('under');
            store.onMarketTick('JD25', under_entering, 7, true); // armed on the seed
            expect(armedSymbols(store)).toEqual(['JD25']);
            store.onMarketTick('JD25', under_entering, 7); // live tick: Under's entry
            await flush();
            expect(store.target?.symbol).toBe('JD25');
            expect(readEngineValues(workspace_xml)).toMatchObject({
                ai_direction: 0,
                first_barrier: 7,
                recovery_barrier: 6,
                symbol: 'JD25',
                stake: 0.35,
                stake_2: 0.35,
                martingale: 2,
                take_profit: 5,
                stop_loss: 10,
            });
            expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
            expect(store.stage).toBe('running');
        });

        it('a barrier that reads back wrong (FIRST BARRIER 2) blocks Run', async () => {
            const { root, store } = await startScan('under');
            (loadBotIntoBuilder as jest.Mock).mockImplementationOnce(async ({ block_string, strategy_id }) => {
                workspace_xml = block_string.replace(/(id="bull-ai-n-first"><field name="NUM">)7</, '$12<');
                workspace.current_strategy_id = strategy_id;
                return true;
            });
            store.onMarketTick('JD25', under_entering, 7, true);
            store.onMarketTick('JD25', under_entering, 7);
            await flush();
            expect(readEngineValues(workspace_xml).first_barrier).toBe(2);
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
            expect(store.stage).toBe('idle');
            expect(store.message).toBe('Run not pressed: the engine bot does not hold the locked values.');
        });
    });

    describe('Even/Odd tab', () => {
        // Even/Odd windows: body odd digits first, even digits last, then the tail.
        const eoWindow = (counts: number[], tail: number[] = [], odd_last = false) => {
            const remaining = counts.slice();
            tail.forEach(digit => {
                remaining[digit] -= 1;
            });
            const of = (parity: number) =>
                remaining.flatMap((count, digit) => (digit % 2 === parity ? new Array(count).fill(digit) : []));
            return [...(odd_last ? [...of(0), ...of(1)] : [...of(1), ...of(0)]), ...tail];
        };
        const mirrorCounts = (counts: number[]) => counts.map((_, digit) => counts[9 - digit]);
        //                0   1   2   3   4   5   6   7   8   9
        const EVEN_SIDE = [64, 59, 68, 43, 71, 59, 64, 50, 64, 58]; // EVEN qualifies, least 3
        const ODD_SIDE = mirrorCounts(EVEN_SIDE); // ODD qualifies, least 6
        const even_armed = eoWindow(EVEN_SIDE);
        const even_entering = eoWindow(EVEN_SIDE, [3, 5, 7, 4]); // red bar 3, two more odd, then even
        const odd_armed = eoWindow(ODD_SIDE, [], true);
        const odd_entering = eoWindow(ODD_SIDE, [6, 4, 2, 5], true); // red bar 6, two more even, then odd

        it('arms with the side, and the winner writes AI DIRECTION 1 for EVEN into the Even/Odd engine', async () => {
            const { root, store } = await startScan('over', false, 'even_odd');
            store.onMarketTick('JD25', even_armed, 4, true);
            expect(armedOf(store, 'JD25')).toMatchObject({ side: 'even', still_met: true });
            store.onMarketTick('JD25', even_entering, 4);
            await flush();
            expect(store.target).toMatchObject({ symbol: 'JD25', side: 'even' });
            const values = readEngineValues(workspace_xml);
            expect(values).toMatchObject({
                ai_direction: 1,
                symbol: 'JD25',
                submarket: 'jump_index',
                stake: 0.35,
                stake_2: 0.35,
                martingale: 2,
                take_profit: 5,
                stop_loss: 10,
            });
            // The Even/Odd engine (no barrier variables), not the Over/Under one.
            expect(values.first_barrier).toBeUndefined();
            expect(workspace_xml).toContain('DIGITEVEN');
            expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
            expect(store.stage).toBe('running');
        });

        it('an ODD winner writes AI DIRECTION 0 and the read-back passes', async () => {
            const { root, store } = await startScan('over', false, 'even_odd');
            store.onMarketTick('1HZ10V', odd_armed, 5, true);
            expect(armedOf(store, '1HZ10V')?.side).toBe('odd');
            store.onMarketTick('1HZ10V', odd_entering, 5);
            await flush();
            expect(store.target?.side).toBe('odd');
            expect(readEngineValues(workspace_xml)).toMatchObject({ ai_direction: 0, symbol: '1HZ10V' });
            expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
        });

        describe('dropped when the condition changes (keepArmedWhenConditionFades: false)', () => {
            beforeEach(() => jest.useFakeTimers());
            afterEach(() => jest.useRealTimers());

            // Neither side qualifies (uniform 5s), but its last ticks are EVEN's entry pattern.
            const faded_entering = [...full(5).slice(4), 3, 5, 7, 4];

            it('condition fails on the next tick: disarmed at once, no entry possible, a 3s notice', async () => {
                const { root, store } = await startScan('over', false, 'even_odd');
                store.onMarketTick('JD25', even_armed, 4, true);
                expect(armedSymbols(store)).toEqual(['JD25']);
                store.onMarketTick('JD25', faded_entering, 4); // live: condition gone, entry pattern
                await flush();
                expect(store.armed).toEqual([]);
                expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
                expect(store.drop_notices.map(notice => notice.text)).toEqual([
                    'Jump 25 Index dropped — conditions changed',
                ]);
                jest.advanceTimersByTime(2999);
                expect(store.drop_notices).toHaveLength(1);
                jest.advanceTimersByTime(1);
                expect(store.drop_notices).toEqual([]);
                expect(store.stage).toBe('scanning');
            });

            it('flips to the opposite side: dropped, then armed on the new side with a fresh 3:00', async () => {
                const { root, store } = await startScan('over', false, 'even_odd');
                store.onMarketTick('JD25', even_armed, 4, true);
                jest.advanceTimersByTime(60000);
                store.onMarketTick('JD25', odd_armed, 5); // now ODD qualifies
                expect(store.drop_notices).toHaveLength(1);
                expect(armedOf(store, 'JD25')).toMatchObject({
                    side: 'odd',
                    still_met: true,
                    armed_at: Date.now(),
                    expires_at: Date.now() + 180000,
                });
                store.onMarketTick('JD25', odd_entering, 5); // its new side's entry
                await flush();
                expect(store.target?.side).toBe('odd');
                expect(readEngineValues(workspace_xml).ai_direction).toBe(0);
                expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
            });

            it('an entry on the tick the condition fails never wins', async () => {
                const { root, store } = await startScan('over', false, 'even_odd');
                store.onMarketTick('JD25', even_armed, 4, true);
                store.onMarketTick('JD25', faded_entering, 4);
                store.onMarketTick('JD25', faded_entering, 4);
                await flush();
                expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
            });

            it('condition holding: still disarmed at 3:00', async () => {
                const { store } = await startScan('over', false, 'even_odd');
                store.onMarketTick('JD25', even_armed, 4, true);
                for (let second = 1; second < 180; second++) {
                    jest.advanceTimersByTime(1000);
                    store.onMarketTick('JD25', even_armed, 4);
                }
                expect(armedSymbols(store)).toEqual(['JD25']);
                jest.advanceTimersByTime(1000); // 3:00
                expect(store.armed).toEqual([]);
                expect(store.drop_notices).toEqual([]); // a timeout, not a drop
            });

            it('a re-subscribe seed with a changed condition never drops it - the next live tick decides', async () => {
                const { store } = await startScan('over', false, 'even_odd');
                store.onMarketTick('JD25', even_armed, 4, true);
                store.onMarketTick('JD25', full(5), 5, true); // re-seed: condition gone
                expect(armedSymbols(store)).toEqual(['JD25']);
                store.onMarketTick('JD25', full(5), 5); // live
                expect(store.armed).toEqual([]);
            });

            it('dropped past 5:00 with nothing else armed: the scan ends as usual', async () => {
                const { store } = await startScan('over', false, 'even_odd');
                jest.advanceTimersByTime(4 * 60000);
                store.onMarketTick('JD25', even_armed, 4, true);
                jest.advanceTimersByTime(90000); // 5:30
                expect(store.stage).toBe('scanning');
                store.onMarketTick('JD25', full(5), 5);
                await flush();
                expect(store.stage).toBe('idle');
                expect(store.message).toBe(CONDITIONS_NOT_MET_MESSAGE);
            });
        });

        it('a direction that reads back wrong blocks Run', async () => {
            const { root, store } = await startScan('over', false, 'even_odd');
            (loadBotIntoBuilder as jest.Mock).mockImplementationOnce(async ({ block_string, strategy_id }) => {
                workspace_xml = block_string.replace(/(id="bull-ai-n-dir"><field name="NUM">)1</, '$10<');
                workspace.current_strategy_id = strategy_id;
                return true;
            });
            store.onMarketTick('JD25', even_armed, 4, true);
            store.onMarketTick('JD25', even_entering, 4);
            await flush();
            expect(readEngineValues(workspace_xml).ai_direction).toBe(0);
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
            expect(store.message).toBe('Run not pressed: the engine bot does not hold the locked values.');
        });

        it('the Even/Odd tab needs DIGITEVEN and DIGITODD at 1 tick', async () => {
            offerings = { JD25: ALL_DIGITS.filter(contract => contract.contract_type !== 'DIGITODD') };
            const { store } = await startScan('over', false, 'even_odd');
            expect(store.scan_markets.map(market => market.symbol)).toEqual(['1HZ10V']);
        });

        it('the tab is fixed for the run: switching mid-scan is ignored', async () => {
            const { store } = await startScan('over', false, 'even_odd');
            store.setActiveTab('over_under');
            expect(store.active_tab).toBe('even_odd');
            expect(store.locked?.tab).toBe('even_odd');
        });

        it('TEST on the Even/Odd tab arms as EVEN and runs on the next live tick', async () => {
            const { root, store } = await startScan('over', true, 'even_odd');
            store.onMarketTick('JD25', full(), 5, true);
            expect(armedOf(store, 'JD25')?.side).toBe('even');
            store.onMarketTick('JD25', full(), 5);
            await flush();
            expect(readEngineValues(workspace_xml).ai_direction).toBe(1);
            expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
        });
    });

    describe('TEST strategy, every time', () => {
        it.each(['over', 'under'] as const)(
            'with %s selected: qualifies on the first check of the seeded history, runs on the next live tick',
            async strategy => {
                const { root, store } = await startScan(strategy, true);
                store.onMarketTick('1HZ10V', full(), 5, true); // the very first check
                expect(armedSymbols(store)).toEqual(['1HZ10V']);
                expect(store.armed[0].reason).toMatch(/^TEST strategy/);
                expect(loadBotIntoBuilder).not.toHaveBeenCalled();
                await flush();
                store.onMarketTick('1HZ10V', full(), 4); // first live tick
                await flush();
                expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
            }
        );

        it('qualifies even when the seeded window holds fewer than 600 digits', async () => {
            const { store } = await startScan('over', true);
            store.onMarketTick('JD25', new Array(450).fill(3), 3, true);
            expect(armedSymbols(store)).toEqual(['JD25']);
        });

        it('the real Over strategy still needs the full 600', async () => {
            const { store } = await startScan('over');
            store.onMarketTick('JD25', new Array(450).fill(9), 9, true);
            expect(store.armed).toEqual([]);
            expect(store.scan_progress?.closest?.reason).toBe('Not enough ticks yet (450 of 600).');
        });
    });

    describe('scan progress (real numbers only)', () => {
        afterEach(() => jest.useRealTimers());

        it('counts checked markets, stamps the last check, names the closest with its real reason, once a second', async () => {
            jest.useFakeTimers();
            jest.setSystemTime(new Date(2026, 9, 23, 14, 5, 9));
            const { store } = await startScan('over');
            expect(store.scan_progress).toBeNull();

            //            0   1   2   3   4   5   6   7   8   9
            const near = [58, 58, 58, 58, 58, 57, 64, 64, 63, 62]; // 2 of 6-9 at 64+
            store.onMarketTick('1HZ10V', full(5), 5, true);
            // N = the markets this scan covers (both offered here).
            expect(store.scan_progress).toMatchObject({ checked: 2, last_check_at: Date.now() });
            expect(store.scan_progress?.closest?.text).toBe('Volatility 10 (1s) Index');

            // Within the same second: recorded, but the panel isn't refreshed yet.
            store.onMarketTick('JD25', windowOf(near), 9, true);
            expect(store.scan_progress?.closest?.text).toBe('Volatility 10 (1s) Index');

            jest.advanceTimersByTime(1000);
            store.onMarketTick('1HZ10V', full(5), 5);
            const progress = store.scan_progress;
            expect(progress?.checked).toBe(2);
            expect(progress?.last_check_at).toBe(Date.now());
            // JD25 is 1 tick short; 1HZ10V (all 5s) is far off.
            expect(progress?.closest?.text).toBe('Jump 25 Index');
            expect(progress?.closest?.reason).toMatch(
                /^6: 10.7% · 7: 10.7% · 8: 10.5% · 9: 10.3% — 2 of 6-9 at 10.6%\+/
            );
        });

        it('lists every qualified market with its own reason, at once when the set changes', async () => {
            const { store } = await startScan('over');
            store.onMarketTick('1HZ10V', qualifying, 9, true);
            store.onMarketTick('JD25', qualifying, 9, true);
            expect(store.armed.map(market => market.text)).toEqual(['Volatility 10 (1s) Index', 'Jump 25 Index']);
            store.armed.forEach(market => expect(market.reason).toMatch(/4 of 6-9 at 10.6%\+/));
        });
    });

    describe('only markets that offer the trade', () => {
        it('checks contracts_for first: no feeds and no scan until it answers', () => {
            const store = new AiScannerStore(makeRoot());
            store.setMarkets(MARKETS);
            fillForm(store);
            store.start();
            expect(store.stage).toBe('checking');
            expect(store.are_feeds_wanted).toBe(false);
            store.onMarketTick('JD25', entering, 1, true);
            expect(store.armed).toEqual([]);
        });

        it('all offered -> every market scanned', async () => {
            const { store } = await startScan();
            expect(store.stage).toBe('scanning');
            expect(store.scan_markets.map(market => market.symbol)).toEqual(['1HZ10V', 'JD25']);
        });

        it('skips a market without DIGITOVER: never scanned, never qualifies, not counted', async () => {
            offerings = { JD25: ALL_DIGITS.filter(contract => contract.contract_type !== 'DIGITOVER') };
            const { store } = await startScan();
            expect(store.scan_markets.map(market => market.symbol)).toEqual(['1HZ10V']);
            store.onMarketTick('JD25', qualifying, 9, true);
            expect(store.armed).toEqual([]);
            store.onMarketTick('1HZ10V', faded, 5, true);
            expect(store.scan_progress?.checked).toBe(1); // the real number scanned
        });

        it('skips a market whose contracts_for errors', async () => {
            offerings = { '1HZ10V': 'error' };
            const { store } = await startScan();
            expect(store.scan_markets.map(market => market.symbol)).toEqual(['JD25']);
        });

        it('no market offers the trade: says so and does not scan', async () => {
            offerings = { '1HZ10V': [], JD25: 'error' };
            const { root, store } = await startScan();
            expect(store.stage).toBe('idle');
            expect(store.message).toBe(NO_MARKETS_OFFERED_MESSAGE);
            expect(store.are_feeds_wanted).toBe(false);
            expect(store.scan_deadline).toBeNull();
            expect(loadBotIntoBuilder).not.toHaveBeenCalled();
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
            expect(store.can_start).toBe(true);
        });

        it('cancel while checking: the late answer starts nothing', async () => {
            const store = new AiScannerStore(makeRoot());
            store.setMarkets(MARKETS);
            fillForm(store);
            store.start();
            store.cancel();
            await flush();
            expect(store.stage).toBe('idle');
            expect(store.scan_markets).toEqual([]);
        });
    });

    describe('when the engine fails before its first contract', () => {
        const runOnJD25 = async () => {
            const scan = await startScan();
            scan.store.onMarketTick('JD25', entering, 1, true);
            await flush();
            scan.store.onMarketTick('JD25', entering, 1);
            await flush();
            expect(scan.store.stage).toBe('running');
            return scan;
        };
        const settle = () => new Promise(resolve => setTimeout(resolve, 5));

        it('Deriv refusing the buy stops the bot and shows "Run failed on <market>: <message>"', async () => {
            const { root, store } = await runOnJD25();
            globalObserver.emit('Error', { code: 'X', message: 'Trading is not offered for this duration.' });
            await settle();
            expect(root.run_panel.onStopBotClick).toHaveBeenCalledTimes(1);
            expect(store.stage).toBe('idle');
            expect(store.message).toBe('Run failed on Jump 25 Index: Trading is not offered for this duration.');
            // Back to the start state, form kept.
            expect(store.form).toMatchObject({ strategy: 'over', stake: '0.35', take_profit: '5', stop_loss: '10' });
            expect(store.can_start).toBe(true);
        });

        it('also catches an API error wrapped as { error } and a ui.log.error message', async () => {
            const first = await runOnJD25();
            globalObserver.emit('Error', { error: { code: 'X', message: 'Wrapped message.' } });
            await settle();
            expect(first.store.message).toBe('Run failed on Jump 25 Index: Wrapped message.');

            const second = await runOnJD25();
            globalObserver.emit('ui.log.error', 'Could not buy.');
            await settle();
            expect(second.store.message).toBe('Run failed on Jump 25 Index: Could not buy.');
        });

        it('a bot that already stopped itself on the error still ends with the reason', async () => {
            const { root, store } = await runOnJD25();
            // An unrecoverable error: the engine stops itself, the error arrives with it.
            globalObserver.emit('Error', { message: 'Trading is not offered for this duration.' });
            runInAction(() => (root.run_panel.is_running = false));
            await settle();
            expect(store.stage).toBe('idle');
            expect(store.message).toBe('Run failed on Jump 25 Index: Trading is not offered for this duration.');
        });

        it('errors after the first contract settled are left to the engine', async () => {
            const { root, store } = await runOnJD25();
            runInAction(() => Object.assign(root.transactions.statistics, { number_of_runs: 1 }));
            globalObserver.emit('Error', { message: 'Some later error.' });
            await settle();
            expect(root.run_panel.onStopBotClick).not.toHaveBeenCalled();
            expect(store.stage).toBe('running');
        });

        it('stops listening once the run is over', async () => {
            const { root, store } = await runOnJD25();
            runInAction(() => (root.run_panel.is_running = false));
            expect(store.stage).toBe('stopped');
            globalObserver.emit('Error', { message: 'Late error.' });
            await settle();
            expect(store.stage).toBe('stopped');
            expect(store.message).not.toMatch(/Run failed/);
        });
    });

    describe('stopping the bot never throws', () => {
        // The run panel drops every 'Error' listener (observer.unregisterAll)
        // when a bot stops - the scanner's included - before the scanner sees
        // the stop. The observer's own unregister then threw ("reading
        // 'filter'"), mobx swallowed it as an uncaught reaction error, and the
        // panel never left 'running'.
        let mobx_errors: jest.SpyInstance;
        beforeEach(() => {
            mobx_errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        });
        afterEach(() => {
            expect(mobx_errors.mock.calls.filter(([message]) => String(message).includes('[mobx]'))).toEqual([]);
            mobx_errors.mockRestore();
        });

        const run = async () => {
            const scan = await startScan();
            scan.store.onMarketTick('JD25', entering, 1, true);
            await flush();
            scan.store.onMarketTick('JD25', entering, 1);
            await flush();
            expect(scan.store.stage).toBe('running');
            return scan;
        };
        const botStops = (root: Awaited<ReturnType<typeof run>>['root']) => {
            globalObserver.unregisterAll('Error'); // what run_panel.unregisterBotListeners does
            runInAction(() => (root.run_panel.is_running = false));
        };

        it('a normal stop (take profit / stop loss)', async () => {
            const { root, store } = await run();
            expect(() => botStops(root)).not.toThrow();
            expect(store.stage).toBe('stopped');
        });

        it('a stop after a failed buy', async () => {
            const { root, store } = await run();
            globalObserver.emit('Error', { message: 'Trading is not offered for this duration.' });
            botStops(root);
            await new Promise(resolve => setTimeout(resolve, 5));
            expect(store.stage).toBe('idle');
            expect(store.message).toBe('Run failed on Jump 25 Index: Trading is not offered for this duration.');
        });

        it('two stops in a row, and two runs one after the other', async () => {
            const first = await run();
            botStops(first.root);
            expect(() => first.store.cancel()).not.toThrow();
            expect(first.store.stage).toBe('stopped');
            // Scan again from the stopped state.
            expect(first.store.can_start).toBe(true);

            const second = await run();
            botStops(second.root);
            runInAction(() => (second.root.run_panel.is_running = false));
            expect(second.store.stage).toBe('stopped');
        });

        it('cancel while running, then the bot stopping on its own as well', async () => {
            const { root, store } = await run();
            expect(() => store.cancel()).not.toThrow(); // Stop's own path
            expect(() => botStops(root)).not.toThrow();
            expect(store.stage).toBe('stopped');
        });
    });
});
