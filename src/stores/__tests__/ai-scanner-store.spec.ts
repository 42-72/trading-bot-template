import fs from 'fs';
import { observable, runInAction } from 'mobx';
import path from 'path';
import { readEngineValues } from '@/utils/ai-engine-xml';
import { loadBotIntoBuilder } from '@/utils/load-bot-into-builder';
import AiScannerStore, { CONDITIONS_NOT_MET_MESSAGE } from '../ai-scanner-store';
import RootStore from '../root-store';

// jest stubs *.xml imports - hand the store the real engine.
jest.mock('../../assets/ai-engine/bull-ai-overunder.xml', () => {
    const { readFileSync } = jest.requireActual('fs');
    const { join } = jest.requireActual('path');
    return readFileSync(join(__dirname, '../../assets/ai-engine/bull-ai-overunder.xml'), 'utf8');
});

jest.mock('@/utils/load-bot-into-builder', () => ({ loadBotIntoBuilder: jest.fn() }));

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

const startScan = (strategy: 'over' | 'under' = 'over', use_test = false) => {
    const root = makeRoot();
    const store = new AiScannerStore(root);
    store.setMarkets(MARKETS);
    fillForm(store, strategy);
    store.setUseTestStrategy(use_test);
    store.start();
    return { root, store };
};

const qualifiedSymbols = (store: AiScannerStore) => store.qualified.map(market => market.symbol);

describe('AiScannerStore', () => {
    beforeEach(() => {
        localStorage.clear();
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
        it('keeps Scan & Run disabled until all four values are valid', () => {
            const store = new AiScannerStore(makeRoot());
            store.setMarkets(MARKETS);
            expect(store.can_start).toBe(false);
            fillForm(store);
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

        it('refuses to start while a bot is running, or on a non-USD account', () => {
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

        it('remembers the form, including the chosen strategy', () => {
            const first = new AiScannerStore(makeRoot());
            fillForm(first, 'under');
            const second = new AiScannerStore(makeRoot());
            expect(second.form).toMatchObject({ strategy: 'under', stake: '0.35', take_profit: '5', stop_loss: '10' });
            expect(second.use_test_strategy).toBe(false);
        });

        it('never runs the TEST strategy on a real account', () => {
            const root = makeRoot();
            runInAction(() => (root.client.is_virtual = false));
            const store = new AiScannerStore(root);
            store.setUseTestStrategy(true);
            expect(store.use_test_strategy).toBe(false);
        });

        it('ships the engine unmodified', () => {
            expect(readEngineValues(ENGINE).stake).toBe(20);
        });
    });

    describe('parallel markets', () => {
        it('with the default (Under) strategy, scans and never loads or runs anything', async () => {
            const { root, store } = startScan('under');
            for (let i = 0; i < 50; i++) MARKETS.forEach(m => store.onMarketTick(m.symbol, full(i % 10), i % 10));
            await flush();
            expect(store.stage).toBe('scanning');
            expect(store.qualified).toEqual([]);
            expect(loadBotIntoBuilder).not.toHaveBeenCalled();
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
        });

        it('loads the engine at the first qualify and keeps every market scanning', async () => {
            const { store } = startScan();
            store.onMarketTick('1HZ10V', qualifying, 9, true);
            expect(store.stage).toBe('scanning');
            expect(store.are_feeds_wanted).toBe(true);
            expect(store.engine_state).toBe('loading');
            expect(qualifiedSymbols(store)).toEqual(['1HZ10V']);
            await flush();
            expect(store.engine_state).toBe('loaded');
            expect(readEngineValues(workspace_xml).symbol).toBe('1HZ10V');

            // A second market qualifies alongside it; the engine isn't reloaded.
            store.onMarketTick('JD25', qualifying, 9, true);
            expect(qualifiedSymbols(store)).toEqual(['1HZ10V', 'JD25']);
            expect(loadBotIntoBuilder).toHaveBeenCalledTimes(1);
        });

        it('two qualified at once, the second hits its entry first: the second wins and the engine is on it', async () => {
            const { root, store } = startScan();
            store.onMarketTick('1HZ10V', qualifying, 9, true);
            store.onMarketTick('JD25', qualifying, 9, true);
            await flush();
            expect(readEngineValues(workspace_xml).symbol).toBe('1HZ10V'); // loaded for the first

            store.onMarketTick('1HZ10V', qualifying, 9); // still qualified, no entry
            store.onMarketTick('JD25', entering, 1); // entry
            expect(store.stage).toBe('starting');
            expect(store.are_feeds_wanted).toBe(false); // every feed closes
            await flush();

            expect(store.target?.symbol).toBe('JD25');
            expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
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

        it('one qualified market fades while another stays: the other can still win', async () => {
            const { root, store } = startScan();
            store.onMarketTick('1HZ10V', qualifying, 9, true);
            store.onMarketTick('JD25', qualifying, 9, true);
            await flush();
            store.onMarketTick('1HZ10V', faded, 5);
            expect(qualifiedSymbols(store)).toEqual(['JD25']);
            expect(store.stage).toBe('scanning');
            expect(store.message).toBe('');

            store.onMarketTick('JD25', entering, 1);
            await flush();
            expect(store.target?.symbol).toBe('JD25');
            expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
            expect(readEngineValues(workspace_xml).symbol).toBe('JD25');
        });

        it('two entries on the same tick: only the first counts, only one Run', async () => {
            const { root, store } = startScan();
            store.onMarketTick('1HZ10V', qualifying, 9, true);
            store.onMarketTick('JD25', qualifying, 9, true);
            await flush();
            store.onMarketTick('1HZ10V', entering, 1);
            store.onMarketTick('JD25', entering, 1);
            await flush();
            expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
            expect(store.target?.symbol).toBe('1HZ10V');
            expect(readEngineValues(workspace_xml).symbol).toBe('1HZ10V');
            expect(loadBotIntoBuilder).toHaveBeenCalledTimes(1); // already on the winner - no reload
        });

        it('symbol read back from the workspace is not the winner: no Run, and the panel says why', async () => {
            const { root, store } = startScan();
            store.onMarketTick('1HZ10V', qualifying, 9, true);
            await flush();
            // The reload for the winner "lands" on the old market, as a refused
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

        it('an engine edited in Bot Builder during the scan is reloaded with the locked values before Run', async () => {
            const { root, store } = startScan();
            store.onMarketTick('1HZ10V', qualifying, 9, true);
            await flush();
            workspace_xml = workspace_xml.replace(/(id="bull-ai-n-mart"><field name="NUM">)2</, '$19<');
            store.onMarketTick('1HZ10V', entering, 1);
            await flush();
            expect(loadBotIntoBuilder).toHaveBeenCalledTimes(2);
            expect(readEngineValues(workspace_xml).martingale).toBe(2);
            expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
        });

        it('never enters on a re-seed of the window, only on a live tick', async () => {
            const { root, store } = startScan();
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
            const { root, store } = startScan('over', true);
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

        it('cancel while markets are qualified stands down without touching the run panel', async () => {
            const { root, store } = startScan();
            store.onMarketTick('1HZ10V', qualifying, 9, true);
            await flush();
            store.cancel();
            expect(store.stage).toBe('idle');
            expect(store.qualified).toEqual([]);
            store.onMarketTick('1HZ10V', entering, 1);
            await flush();
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
            expect(root.run_panel.onStopBotClick).not.toHaveBeenCalled();
        });

        it('owns the workspace (blocking the Market Tool sync) from the first qualify until the bot stops', async () => {
            const { root, store } = startScan();
            expect(store.owns_workspace).toBe(false);
            store.onMarketTick('1HZ10V', qualifying, 9, true);
            expect(store.owns_workspace).toBe(true);
            await flush();
            store.onMarketTick('1HZ10V', entering, 1);
            await flush();
            expect(store.stage).toBe('running');
            expect(store.owns_workspace).toBe(true);
            runInAction(() => (root.run_panel.is_running = false));
            expect(store.stage).toBe('stopped');
            expect(store.owns_workspace).toBe(false);
        });

        it('the engine stops itself at take profit and the panel says so', async () => {
            const { root, store } = startScan();
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

    describe('5-minute rule', () => {
        const MIN = 60 * 1000;

        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        it('nothing qualifies: stops at exactly 5:00, feeds closed, Scan & Run usable again', () => {
            const { root, store } = startScan();
            MARKETS.forEach(market => store.onMarketTick(market.symbol, faded, 5, true));
            jest.advanceTimersByTime(5 * MIN - 1);
            expect(store.stage).toBe('scanning');
            jest.advanceTimersByTime(1);
            expect(store.stage).toBe('idle');
            expect(store.message).toBe('Conditions not met — no market qualified in 5 minutes.');
            expect(store.are_feeds_wanted).toBe(false);
            expect(loadBotIntoBuilder).not.toHaveBeenCalled();
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
            expect(store.can_start).toBe(true);
            store.start();
            expect(store.stage).toBe('scanning');
            expect(store.scan_deadline).toBe(Date.now() + 5 * MIN);
        });

        it('at 5:00 with one market qualified it keeps going; that market fading at 5:40 stops it', async () => {
            const { root, store } = startScan();
            jest.advanceTimersByTime(4 * MIN);
            store.onMarketTick('JD25', qualifying, 9, true);
            await flush();
            jest.advanceTimersByTime(1 * MIN); // 5:00
            expect(store.stage).toBe('scanning');
            expect(qualifiedSymbols(store)).toEqual(['JD25']);

            jest.advanceTimersByTime(30 * 1000); // 5:30, still holding
            store.onMarketTick('JD25', qualifying, 9);
            store.onMarketTick('1HZ10V', faded, 5); // another market, never qualified
            expect(store.stage).toBe('scanning');

            jest.advanceTimersByTime(10 * 1000); // 5:40
            store.onMarketTick('JD25', faded, 5);
            expect(store.stage).toBe('idle');
            expect(store.message).toBe(CONDITIONS_NOT_MET_MESSAGE);
            expect(store.are_feeds_wanted).toBe(false);
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
            // The engine loaded for it is left as it is, never run.
            expect(workspace.current_strategy_id).toMatch(/^ai-engine-/);
        });

        it('before 5:00, a fade with none qualified just keeps scanning', async () => {
            const { store } = startScan();
            store.onMarketTick('JD25', qualifying, 9, true);
            await flush();
            jest.advanceTimersByTime(3 * MIN);
            store.onMarketTick('JD25', faded, 5);
            expect(store.stage).toBe('scanning');
            expect(store.qualified).toEqual([]);
            store.onMarketTick('1HZ10V', qualifying, 9);
            expect(qualifiedSymbols(store)).toEqual(['1HZ10V']);
        });

        it('one market past 5:00 can still win', async () => {
            const { root, store } = startScan();
            store.onMarketTick('JD25', qualifying, 9, true);
            await flush();
            jest.advanceTimersByTime(6 * MIN);
            store.onMarketTick('JD25', entering, 1);
            await flush();
            expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
        });
    });

    describe('TEST strategy, every time', () => {
        it.each(['over', 'under'] as const)(
            'with %s selected: qualifies on the first check of the seeded history, runs on the next live tick',
            async strategy => {
                const { root, store } = startScan(strategy, true);
                expect(store.locked?.use_test_strategy).toBe(true);
                store.onMarketTick('1HZ10V', full(), 5, true); // the very first check
                expect(qualifiedSymbols(store)).toEqual(['1HZ10V']);
                expect(store.qualified[0].reason).toMatch(/^TEST strategy/);
                expect(store.engine_state).toBe('loading');
                await flush();
                store.onMarketTick('1HZ10V', full(), 4); // first live tick
                await flush();
                expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
            }
        );

        it('qualifies even when the seeded window holds fewer than 600 digits', () => {
            const { store } = startScan('over', true);
            store.onMarketTick('JD25', new Array(450).fill(3), 3, true);
            expect(qualifiedSymbols(store)).toEqual(['JD25']);
        });

        it('the real Over strategy still needs the full 600', () => {
            const { store } = startScan('over');
            store.onMarketTick('JD25', new Array(450).fill(9), 9, true);
            expect(store.qualified).toEqual([]);
            expect(store.scan_progress?.closest?.reason).toBe('Not enough ticks yet (450 of 600).');
        });
    });

    describe('scan progress (real numbers only)', () => {
        afterEach(() => jest.useRealTimers());

        it('counts checked markets, stamps the last check, names the closest with its real reason, once a second', () => {
            jest.useFakeTimers();
            jest.setSystemTime(new Date(2026, 9, 23, 14, 5, 9));
            const { store } = startScan('over');
            expect(store.scan_progress).toBeNull();

            //            0   1   2   3   4   5   6   7   8   9
            const near = [58, 58, 58, 58, 58, 57, 64, 64, 63, 62]; // 2 of 6-9 at 64+
            store.onMarketTick('1HZ10V', full(5), 5, true);
            expect(store.scan_progress).toMatchObject({ checked: 1, last_check_at: Date.now() });

            // Within the same second: recorded, but the panel isn't refreshed yet.
            store.onMarketTick('JD25', windowOf(near), 9, true);
            expect(store.scan_progress?.checked).toBe(1);

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

        it('lists every qualified market with its own reason, at once when the set changes', () => {
            const { store } = startScan('over');
            store.onMarketTick('1HZ10V', qualifying, 9, true);
            store.onMarketTick('JD25', qualifying, 9, true);
            expect(store.qualified.map(market => market.text)).toEqual(['Volatility 10 (1s) Index', 'Jump 25 Index']);
            store.qualified.forEach(market => expect(market.reason).toMatch(/4 of 6-9 at 10.6%\+/));
        });
    });
});
