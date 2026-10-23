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
    for (let i = 0; i < 10; i++) await Promise.resolve();
};

const fillForm = (store: AiScannerStore, strategy: 'over' | 'under' = 'over') => {
    store.setFormField('strategy', strategy);

    store.setFormField('stake', '0.35');

    store.setFormField('martingale', '2');

    store.setFormField('take_profit', '5');

    store.setFormField('stop_loss', '10');
};

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

    it('keeps Load & Run disabled until all four values are valid', () => {
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

    it('with the default (Under) strategy, scans and never loads or runs anything', async () => {
        const root = makeRoot();

        const store = new AiScannerStore(root);

        store.setMarkets(MARKETS);

        fillForm(store, 'under');

        store.start();

        for (let i = 0; i < 50; i++) MARKETS.forEach(m => store.onMarketTick(m.symbol, full(i % 10), i % 10));

        await flush();

        expect(store.stage).toBe('scanning');

        expect(loadBotIntoBuilder).not.toHaveBeenCalled();

        expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
    });

    it('TEST strategy: loads the engine at condition, runs on the next tick, with the locked values', async () => {
        const root = makeRoot();

        const store = new AiScannerStore(root);

        store.setMarkets(MARKETS);

        fillForm(store, 'under');

        store.setUseTestStrategy(true);

        store.start();

        // Editing the form after Load & Run must not reach the bot.

        store.setFormField('stake', '50');

        store.setFormField('strategy', 'over');

        store.onMarketTick('JD25', full(), 5);

        expect(store.stage).toBe('loading');

        await flush();

        expect(store.stage).toBe('waiting');

        expect(root.dashboard.setActiveTab).toHaveBeenCalled();

        expect(readEngineValues(workspace_xml)).toEqual({
            ai_direction: 0,

            first_barrier: 7,

            recovery_barrier: 6,

            stake: 0.35,

            stake_2: 0.35,

            martingale: 2,

            take_profit: 5,

            stop_loss: 10,

            market: 'synthetic_index',

            submarket: 'jump_index',

            symbol: 'JD25',
        });

        expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();

        store.onMarketTick('JD25', full(), 3);

        await flush();

        expect(root.run_panel.clearStat).toHaveBeenCalled();

        expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);

        expect(store.stage).toBe('running');

        // The engine stops itself at take profit.

        runInAction(() => {
            root.transactions.statistics.total_profit = 5.2;

            root.run_panel.is_running = false;
        });

        expect(store.stage).toBe('stopped');

        expect(store.message).toMatch(/Take profit/);
    });

    it('presses Run only after every scanner feed has stopped (and forgotten its stream)', async () => {
        const root = makeRoot();
        const store = new AiScannerStore(root);
        store.setMarkets(MARKETS);
        fillForm(store);
        store.setUseTestStrategy(true);
        const release = store.registerFeed();
        store.start();
        store.onMarketTick('1HZ10V', full(), 5);
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

    it('never enters on a re-seed of the window, only on a live tick', async () => {
        const root = makeRoot();
        const store = new AiScannerStore(root);
        store.setMarkets(MARKETS);
        fillForm(store);
        store.setUseTestStrategy(true);
        store.start();
        store.onMarketTick('1HZ10V', full(), 5, true);
        await flush();
        expect(store.stage).toBe('waiting');
        store.onMarketTick('1HZ10V', full(), 5, true);
        await flush();
        expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
        store.onMarketTick('1HZ10V', full(), 5);
        await flush();
        expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
    });

    it('never runs the TEST strategy on a real account', () => {
        const root = makeRoot();

        runInAction(() => (root.client.is_virtual = false));

        const store = new AiScannerStore(root);

        store.setUseTestStrategy(true);

        expect(store.use_test_strategy).toBe(false);
    });

    it('does not run an engine whose blocks were edited while waiting', async () => {
        const root = makeRoot();

        const store = new AiScannerStore(root);

        store.setMarkets(MARKETS);

        fillForm(store);

        store.setUseTestStrategy(true);

        store.start();

        store.onMarketTick('1HZ10V', full(), 5);

        await flush();

        workspace_xml = workspace_xml.replace(/(id="bull-ai-n-mart"><field name="NUM">)2</, '$19<');

        store.onMarketTick('1HZ10V', full(), 5);

        await flush();

        expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();

        expect(store.stage).not.toBe('running');
    });

    it('cancel while waiting stands down without touching the run panel', async () => {
        const root = makeRoot();

        const store = new AiScannerStore(root);

        store.setMarkets(MARKETS);

        fillForm(store);

        store.setUseTestStrategy(true);

        store.start();

        store.onMarketTick('1HZ10V', full(), 5);

        await flush();

        store.cancel();

        expect(store.stage).toBe('idle');

        store.onMarketTick('1HZ10V', full(), 5);

        await flush();

        expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();

        expect(root.run_panel.onStopBotClick).not.toHaveBeenCalled();
    });

    it('owns the workspace (blocking the Market Tool sync) from load until the bot stops', async () => {
        const root = makeRoot();

        const store = new AiScannerStore(root);

        store.setMarkets(MARKETS);

        fillForm(store);

        store.setUseTestStrategy(true);

        store.start();

        expect(store.owns_workspace).toBe(false);

        store.onMarketTick('1HZ10V', full(), 5);

        expect(store.owns_workspace).toBe(true);

        await flush();

        store.onMarketTick('1HZ10V', full(), 5);

        await flush();

        expect(store.owns_workspace).toBe(true);

        runInAction(() => (root.run_panel.is_running = false));

        expect(store.owns_workspace).toBe(false);
    });

    it('remembers the form, including the chosen strategy', () => {
        const first = new AiScannerStore(makeRoot());

        fillForm(first, 'under');

        const second = new AiScannerStore(makeRoot());

        expect(second.form).toMatchObject({ strategy: 'under', stake: '0.35', take_profit: '5', stop_loss: '10' });

        expect(second.use_test_strategy).toBe(false);
    });

    it('ships the engine unmodified', () => {
        expect(readEngineValues(ENGINE).stake).toBe(20);
    });

    describe('5-minute scan limit (real Over strategy)', () => {
        // Over qualifies: three of 6-9 at 64+ and each of 0-2 at 58 or fewer.
        //                    0   1   2   3   4   5   6   7   8   9
        const QUALIFYING = [58, 58, 58, 57, 57, 56, 64, 64, 64, 64];
        const windowOf = (counts: number[]) => counts.flatMap((count, digit) => new Array(count).fill(digit));
        // Ends ...9,9,9 - qualifies but is not an entry (entry needs 1 or 2).
        const qualifying = windowOf(QUALIFYING);
        const faded = full(5);
        const MIN = 60 * 1000;

        let root: ReturnType<typeof makeRoot>;
        let store: AiScannerStore;

        beforeEach(() => {
            jest.useFakeTimers();
            root = makeRoot();
            store = new AiScannerStore(root);
            store.setMarkets(MARKETS);
            fillForm(store, 'over');
            store.start();
        });

        afterEach(() => {
            store.cancel();
            jest.useRealTimers();
        });

        const lockOn = async (symbol = 'JD25') => {
            store.onMarketTick(symbol, qualifying, 9, true);
            await flush();
            expect(store.stage).toBe('waiting');
            expect(store.target?.symbol).toBe(symbol);
        };

        it('qualifies on the seeded history at 0:00 and loads the engine at once', async () => {
            expect(store.scan_deadline).toBe(Date.now() + 5 * MIN);
            store.onMarketTick('JD25', qualifying, 9, true); // the ticks_history seed, no live tick yet
            expect(store.stage).toBe('loading');
            expect(loadBotIntoBuilder).toHaveBeenCalledTimes(1);
            await flush();
            expect(store.stage).toBe('waiting');
            expect(store.target?.reason).toMatch(/4 of 6-9 at 10.6%\+/);
        });

        it('locked at 4:50 and still holding at 6:00 keeps waiting - the limit no longer applies', async () => {
            jest.advanceTimersByTime(4 * MIN + 50 * 1000);
            await lockOn();
            jest.advanceTimersByTime(70 * 1000); // 6:00
            store.onMarketTick('JD25', qualifying, 9);
            expect(store.stage).toBe('waiting');
            expect(store.message).toBe('');
        });

        it('locked market fading at 3:00 goes back to scanning all markets', async () => {
            await lockOn();
            jest.advanceTimersByTime(3 * MIN);
            store.onMarketTick('JD25', faded, 5);
            expect(store.stage).toBe('scanning');
            expect(store.target).toBeNull();
            // Every market is checked again, and can lock again.
            await lockOn('1HZ10V');
        });

        it('locked market fading at 5:30 stops with "Conditions not met"', async () => {
            await lockOn();
            jest.advanceTimersByTime(5 * MIN + 30 * 1000);
            expect(store.stage).toBe('waiting');
            store.onMarketTick('JD25', faded, 5);
            expect(store.stage).toBe('idle');
            expect(store.message).toBe(CONDITIONS_NOT_MET_MESSAGE);
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
        });

        it('nothing qualifies: stops at exactly 5:00, feeds closed, Load & Run usable again', () => {
            MARKETS.forEach(market => store.onMarketTick(market.symbol, faded, 5, true));
            jest.advanceTimersByTime(5 * MIN - 1);
            expect(store.stage).toBe('scanning');
            expect(store.are_feeds_wanted).toBe(true);
            jest.advanceTimersByTime(1);
            expect(store.stage).toBe('idle');
            expect(store.message).toBe(CONDITIONS_NOT_MET_MESSAGE);
            expect(store.message).toBe('Conditions not met — no market qualified in 5 minutes.');
            expect(store.are_feeds_wanted).toBe(false);
            expect(loadBotIntoBuilder).not.toHaveBeenCalled();
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
            // Form kept; the same Load & Run button starts a fresh scan.
            expect(store.form).toMatchObject({ strategy: 'over', stake: '0.35', take_profit: '5', stop_loss: '10' });
            expect(store.can_start).toBe(true);
            store.start();
            expect(store.stage).toBe('scanning');
            expect(store.scan_deadline).toBe(Date.now() + 5 * MIN);
        });

        it('an engine loaded but never run is left as it is, Run never pressed', async () => {
            await lockOn();
            jest.advanceTimersByTime(6 * MIN);
            store.onMarketTick('JD25', faded, 5);
            expect(store.stage).toBe('idle');
            expect(workspace.current_strategy_id).toMatch(/^ai-engine-/);
            expect(root.run_panel.onRunButtonClick).not.toHaveBeenCalled();
        });
    });
});
