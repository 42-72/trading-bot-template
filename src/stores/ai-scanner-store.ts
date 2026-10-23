import { action, computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import {
    AI_ENGINE_BOT_NAME,
    AI_ENGINE_OVER_UNDER_XML,
    AI_SCANNER_CURRENCY,
    AI_SCANNER_MIN_STAKE,
    AI_SCANNER_SCAN_LIMIT_SECONDS,
    OVER_UNDER_SETUPS,
    TOverUnderStrategyId,
} from '@/constants/ai-engine';
import { DBOT_TABS } from '@/constants/bot-contents';
import { readEngineValues, TEngineValues, writeEngineValues } from '@/utils/ai-engine-xml';
import { getOverUnderStrategy, TConditionResult } from '@/utils/ai-strategies';
import { createAiEngineStrategyId } from '@/utils/library-strategies';
import { loadBotIntoBuilder } from '@/utils/load-bot-into-builder';
import RootStore from './root-store';

// The AI Scanner pipeline (components/ai-scanner):
//
//   idle -> scanning            every market's last 600 digits, live
//        -> loading             condition met on market X: write the locked
//                               values into the engine and load it
//        -> waiting             engine in Bot Builder, waiting for the entry
//                               (condition fades / time limit -> scanning)
//        -> starting            entry hit: clear stats, press Run
//        -> running             the bot trades until its own TP / SL
//        -> stopped             (or 'stopping' while a cancelled run closes)
//
// The form only ever feeds a run through `locked`, the snapshot taken when
// Load & Run is pressed - editing the form mid-run changes nothing.

export type TAiScannerStage =
    | 'idle'
    | 'scanning'
    | 'loading'
    | 'waiting'
    | 'starting'
    | 'running'
    | 'stopping'
    | 'stopped';

export type TAiScannerTab = 'over_under' | 'even_odd';

export type TAiScannerForm = {
    strategy: TOverUnderStrategyId;
    stake: string;
    martingale: string;
    take_profit: string;
    stop_loss: string;
};

export type TAiScannerLocked = {
    strategy: TOverUnderStrategyId;
    stake: number;
    martingale: number;
    take_profit: number;
    stop_loss: number;
    use_test_strategy: boolean;
    loginid: string;
};

export type TAiScannerMarket = { symbol: string; text: string; submarket: string };

export type TAiScannerTarget = TAiScannerMarket & { reason: string };

export type TFeedStatus = { status: string; n: number };

type TFormErrors = Partial<Record<keyof TAiScannerForm, string>>;

const FORM_STORAGE_KEY = 'ai_scanner_form';
export const CONDITIONS_NOT_MET_MESSAGE = `Conditions not met — no market qualified in ${
    AI_SCANNER_SCAN_LIMIT_SECONDS / 60
} minutes.`;

const DEFAULT_FORM: TAiScannerForm = {
    strategy: 'over',
    stake: '',
    martingale: '2',
    take_profit: '',
    stop_loss: '',
};

const readStoredForm = (): TAiScannerForm => {
    try {
        const stored = JSON.parse(localStorage.getItem(FORM_STORAGE_KEY) ?? '{}');
        const form = { ...DEFAULT_FORM };
        (Object.keys(DEFAULT_FORM) as (keyof TAiScannerForm)[]).forEach(key => {
            if (typeof stored?.[key] === 'string') (form as Record<string, string>)[key] = stored[key];
        });
        if (!(form.strategy in OVER_UNDER_SETUPS)) form.strategy = DEFAULT_FORM.strategy;
        return form;
    } catch {
        return { ...DEFAULT_FORM };
    }
};

const parseAmount = (value: string) => {
    const trimmed = value.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return NaN;
    return Number(trimmed);
};

const decimals = (value: string) => value.trim().split('.')[1]?.length ?? 0;

type TBlocklyWorkspace = {
    current_strategy_id?: string;
};

const getWorkspace = () =>
    (window as unknown as { Blockly?: { derivWorkspace?: TBlocklyWorkspace } }).Blockly?.derivWorkspace;

/** The engine values as they actually stand in the Bot Builder workspace right now. */
const readWorkspaceEngineValues = () => {
    const Blockly = (window as unknown as { Blockly?: any }).Blockly; // eslint-disable-line @typescript-eslint/no-explicit-any
    const workspace = Blockly?.derivWorkspace;
    if (!workspace) return null;
    try {
        return readEngineValues(Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace)));
    } catch {
        return null;
    }
};

const sameEngineValues = (actual: ReturnType<typeof readWorkspaceEngineValues>, expected: TEngineValues) =>
    !!actual &&
    actual.market === expected.market &&
    actual.submarket === expected.submarket &&
    actual.symbol === expected.symbol &&
    actual.ai_direction === expected.ai_direction &&
    actual.first_barrier === expected.first_barrier &&
    actual.recovery_barrier === expected.recovery_barrier &&
    actual.stake === expected.stake &&
    actual.stake_2 === expected.stake &&
    actual.martingale === expected.martingale &&
    actual.take_profit === expected.take_profit &&
    actual.stop_loss === expected.stop_loss;

export default class AiScannerStore {
    root_store: RootStore;

    is_panel_open = false;
    active_tab: TAiScannerTab = 'over_under';
    form: TAiScannerForm = readStoredForm();
    // Demo-only pipeline check - never remembered, off on every visit.
    use_test_strategy = false;

    stage: TAiScannerStage = 'idle';
    locked: TAiScannerLocked | null = null;
    target: TAiScannerTarget | null = null;
    markets: TAiScannerMarket[] = [];
    feed_status: Record<string, TFeedStatus> = {};
    /** Last thing the pipeline wants the trader to know (why it went back to scanning, why it stopped...). */
    message = '';
    final_profit: number | null = null;
    /** When the search for a market gives up (ms since epoch) - set at Load & Run. */
    scan_deadline: number | null = null;
    /**
     * Proof of scanning, refreshed at most once a second: how many markets have
     * been checked, when the last check ran, and the market nearest to
     * qualifying with that strategy's own reason text.
     */
    scan_progress: { checked: number; last_check_at: number; closest: { text: string; reason: string } | null } | null =
        null;

    // Not observable: bookkeeping for one pipeline run.
    private run_token = 0;
    private scan_timer: ReturnType<typeof setTimeout> | null = null;
    private engine_strategy_id: string | null = null;
    private engine_values: TEngineValues | null = null;
    // Tick feeds currently mounted (market-feed.tsx). Run waits for this to
    // reach 0 - see pressRun.
    private mounted_feeds = 0;
    // Latest condition() result per market during a scan, and when
    // scan_progress was last published from it.
    private scan_results = new Map<string, { text: string; reason: string; shortfall?: number; at: number }>();
    private scan_progress_published_at = 0;

    constructor(root_store: RootStore) {
        this.root_store = root_store;

        makeObservable<AiScannerStore, 'goBackToScanning' | 'finish'>(this, {
            is_panel_open: observable,
            active_tab: observable,
            form: observable,
            use_test_strategy: observable,
            stage: observable,
            locked: observable,
            target: observable,
            markets: observable.ref,
            feed_status: observable,
            message: observable,
            final_profit: observable,
            scan_deadline: observable,
            scan_progress: observable.ref,
            is_active: computed,
            is_pre_run: computed,
            owns_workspace: computed,
            can_use_test_strategy: computed,
            form_errors: computed,
            start_blocker: computed,
            can_start: computed,
            togglePanel: action,
            setPanelOpen: action,
            setActiveTab: action,
            setFormField: action,
            setUseTestStrategy: action,
            setMarkets: action,
            setFeedStatus: action,
            dismiss: action,
            onMarketTick: action,
            start: action,
            cancel: action,
            goBackToScanning: action,
            finish: action,
        });

        // A bot started some other way while scanning or waiting: the
        // workspace and the Run button are no longer ours - stand down.
        // While running, the bot stopping (TP / SL / Stop) ends the run.
        reaction(
            () => this.root_store.run_panel.is_stop_button_visible,
            is_live => {
                if (is_live && ['scanning', 'loading', 'waiting'].includes(this.stage)) {
                    this.finish('idle', 'Cancelled: another bot was started.');
                } else if (!is_live && ['running', 'stopping'].includes(this.stage)) {
                    this.onBotStopped();
                }
            }
        );

        // Account switch (only possible before Run - it's locked while a bot
        // runs) invalidates the locked values: currency, and for the TEST
        // strategy, the demo-only rule.
        reaction(
            () => this.root_store.client.loginid,
            loginid => {
                if (this.is_pre_run && this.locked && loginid !== this.locked.loginid) {
                    this.finish('idle', 'Cancelled: the account changed.');
                }
                if (!this.can_use_test_strategy) runInAction(() => (this.use_test_strategy = false));
            }
        );
    }

    /** Scanning, waiting or trading - anything but idle / stopped. */
    get is_active() {
        return !['idle', 'stopped'].includes(this.stage);
    }

    /** Before Run was pressed - the stages Cancel ends without touching a bot. */
    get is_pre_run() {
        return ['scanning', 'loading', 'waiting'].includes(this.stage);
    }

    /**
     * The engine is (being) loaded and is the scanner's: the Market Tool ->
     * Bot Builder sync must leave the market block alone (market-tool-sync.ts).
     */
    get owns_workspace() {
        return ['loading', 'waiting', 'starting', 'running', 'stopping'].includes(this.stage);
    }

    get can_use_test_strategy() {
        return !!this.root_store.client.is_virtual;
    }

    get form_errors(): TFormErrors {
        const errors: TFormErrors = {};
        const stake = parseAmount(this.form.stake);
        if (!Number.isFinite(stake) || stake < AI_SCANNER_MIN_STAKE) {
            errors.stake = `At least ${AI_SCANNER_MIN_STAKE.toFixed(2)} ${AI_SCANNER_CURRENCY}`;
        } else if (decimals(this.form.stake) > 2) {
            errors.stake = 'At most 2 decimal places';
        }
        const martingale = parseAmount(this.form.martingale);
        if (!Number.isFinite(martingale) || martingale < 1) errors.martingale = 'At least 1';
        const take_profit = parseAmount(this.form.take_profit);
        if (!Number.isFinite(take_profit) || take_profit <= 0) errors.take_profit = 'Above 0';
        else if (decimals(this.form.take_profit) > 2) errors.take_profit = 'At most 2 decimal places';
        const stop_loss = parseAmount(this.form.stop_loss);
        if (!Number.isFinite(stop_loss) || stop_loss <= 0) errors.stop_loss = 'Above 0';
        else if (decimals(this.form.stop_loss) > 2) errors.stop_loss = 'At most 2 decimal places';
        return errors;
    }

    /** Why Load & Run can't start right now, other than the form - null when nothing blocks it. */
    get start_blocker(): string | null {
        const { client, run_panel } = this.root_store;
        if (!client.is_logged_in) return 'Log in to use the AI Scanner.';
        if (client.currency !== AI_SCANNER_CURRENCY) return 'The AI Scanner supports USD accounts only for now.';
        if (run_panel.is_stop_button_visible) return 'A bot is already running. Stop it first.';
        if (this.use_test_strategy && !this.can_use_test_strategy)
            return 'The TEST strategy is for demo accounts only.';
        if (this.markets.length === 0) return 'Loading markets...';
        return null;
    }

    get can_start() {
        return !this.is_active && !this.start_blocker && Object.keys(this.form_errors).length === 0;
    }

    togglePanel = () => {
        this.is_panel_open = !this.is_panel_open;
    };

    setPanelOpen = (is_open: boolean) => {
        this.is_panel_open = is_open;
    };

    setActiveTab = (tab: TAiScannerTab) => {
        // Even/Odd is shown but disabled until its strategy is added.
        if (tab === 'even_odd') return;
        this.active_tab = tab;
    };

    setFormField = <K extends keyof TAiScannerForm>(key: K, value: TAiScannerForm[K]) => {
        this.form[key] = value;
        try {
            localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(this.form));
        } catch {
            // Storage unavailable - the form just won't be remembered.
        }
    };

    setUseTestStrategy = (use: boolean) => {
        this.use_test_strategy = use && this.can_use_test_strategy;
    };

    setMarkets = (markets: TAiScannerMarket[]) => {
        this.markets = markets;
    };

    setFeedStatus = (symbol: string, status: TFeedStatus) => {
        this.feed_status[symbol] = status;
    };

    registerFeed = () => {
        this.mounted_feeds += 1;
        return () => {
            this.mounted_feeds -= 1;
        };
    };

    /** Feeds render only while scanning, loading or waiting. */
    get are_feeds_wanted() {
        return this.is_pre_run;
    }

    /** Stopped -> back to the form. */
    dismiss = () => {
        if (this.stage !== 'stopped') return;
        this.stage = 'idle';
        this.target = null;
        this.message = '';
        this.final_profit = null;
    };

    // Resolves once every scanner feed has unmounted - each one's cleanup
    // has sent `forget` for its stream (useDigitAnalysis) - or after 2s.
    private waitForFeedsToStop() {
        return new Promise<void>(resolve => {
            const started = Date.now();
            const check = () => {
                if (this.mounted_feeds <= 0 || Date.now() - started > 2000) resolve();
                else setTimeout(check, 20);
            };
            check();
        });
    }

    /** Load & Run: lock the form and start scanning. */
    start = () => {
        if (!this.can_start) return;
        this.run_token += 1;
        this.locked = {
            strategy: this.form.strategy,
            stake: parseAmount(this.form.stake),
            martingale: parseAmount(this.form.martingale),
            take_profit: parseAmount(this.form.take_profit),
            stop_loss: parseAmount(this.form.stop_loss),
            use_test_strategy: this.use_test_strategy,
            loginid: this.root_store.client.loginid,
        };
        this.target = null;
        this.final_profit = null;
        this.engine_strategy_id = null;
        this.engine_values = null;
        this.feed_status = {};
        this.message = '';
        this.scan_results.clear();
        this.scan_progress = null;
        this.scan_progress_published_at = 0;
        this.stage = 'scanning';

        // Each feed seeds its window from ticks_history (count 600) the
        // moment it mounts, and condition() runs on that history straight
        // away - no warm-up. The limit covers finding a market only.
        const token = this.run_token;
        const limit_ms = AI_SCANNER_SCAN_LIMIT_SECONDS * 1000;
        this.scan_deadline = Date.now() + limit_ms;
        this.clearScanTimer();
        this.scan_timer = setTimeout(
            action(() => {
                this.scan_timer = null;
                // A locked market (loading / waiting) keeps waiting past the
                // limit for as long as its condition holds.
                if (token === this.run_token && this.stage === 'scanning') {
                    this.finish('idle', CONDITIONS_NOT_MET_MESSAGE);
                }
            }),
            limit_ms
        );

        // Saved now, while it is still the trader's: loading the engine
        // replaces it, and nothing else would have put unsaved edits in Recent.
        this.root_store.run_panel.dbot.saveRecentWorkspace();
    };

    /** Cancel at any stage. A running bot is stopped through the Stop button's own path. */
    cancel = () => {
        // Still waiting for the feeds to stop - Run hasn't been pressed.
        if (this.stage === 'starting' && !this.root_store.run_panel.is_stop_button_visible) {
            this.finish('idle', 'Cancelled.');
            return;
        }
        if (this.stage === 'running' || this.stage === 'starting') {
            this.run_token += 1;
            this.stage = 'stopping';
            this.message = 'Cancelled - stopping the bot.';
            this.root_store.run_panel.onStopBotClick();
            if (!this.root_store.run_panel.is_stop_button_visible) this.onBotStopped();
            return;
        }
        if (this.stage === 'stopping') return;
        this.finish('idle', 'Cancelled.');
    };

    private get strategy() {
        const locked = this.locked as TAiScannerLocked;
        return getOverUnderStrategy(locked.strategy, locked.use_test_strategy && this.can_use_test_strategy);
    }

    /** Called by each market's tick feed (components/ai-scanner/market-feed.tsx) on every new tick. */
    onMarketTick = (symbol: string, digits: number[], new_digit: number, is_seed = false) => {
        // No window-length gate here: each strategy decides what it needs
        // (Over requires all 600). A gate here also held back TEST, whose
        // condition must qualify on the very first check.
        if (!this.locked || digits.length === 0) return;
        if (this.locked.use_test_strategy && !this.can_use_test_strategy) {
            this.finish('idle', 'Cancelled: the TEST strategy only runs on a demo account.');
            return;
        }

        if (this.stage === 'scanning') {
            const market = this.markets.find(item => item.symbol === symbol);
            if (!market) return;
            const result = this.strategy.condition(digits);
            this.recordCheck(market, result, result.qualified);
            if (!result.qualified) return;
            this.target = { ...market, reason: result.reason };
            this.stage = 'loading';
            this.loadEngine(this.run_token);
            return;
        }

        if (this.stage === 'waiting' && symbol === this.target?.symbol) {
            const result = this.strategy.condition(digits);
            if (!result.qualified) {
                this.goBackToScanning(`The condition faded on ${this.target.text}.`);
                return;
            }
            this.target = { ...this.target, reason: result.reason };
            // A re-seed (stream re-subscribed) only re-checks the condition: its
            // last digit is history, not a new tick to enter on.
            if (!is_seed && this.strategy.entry(digits, new_digit)) this.pressRun(this.run_token);
        }
    };

    private recordCheck(market: TAiScannerMarket, result: TConditionResult, force_publish: boolean) {
        const now = Date.now();
        this.scan_results.set(market.symbol, {
            text: market.text,
            reason: result.reason,
            shortfall: result.shortfall,
            at: now,
        });
        if (!force_publish && now - this.scan_progress_published_at < 1000) return;
        this.scan_progress_published_at = now;

        // Nearest to qualifying by the strategy's own shortfall; a strategy
        // that reports none just shows the market checked most recently.
        let closest: { text: string; reason: string; shortfall?: number; at: number } | null = null;
        this.scan_results.forEach(entry => {
            if (!closest) closest = entry;
            else if (entry.shortfall !== undefined && closest.shortfall !== undefined) {
                if (entry.shortfall < closest.shortfall) closest = entry;
            } else if (entry.at > closest.at) closest = entry;
        });
        const best = closest as { text: string; reason: string } | null;
        this.scan_progress = {
            checked: this.scan_results.size,
            last_check_at: now,
            closest: best ? { text: best.text, reason: best.reason } : null,
        };
    }

    private clearScanTimer() {
        if (this.scan_timer) {
            clearTimeout(this.scan_timer);
            this.scan_timer = null;
        }
    }

    /** The locked market is let go: scan again while the limit lasts, else stop. */
    private goBackToScanning(message: string) {
        if (this.scan_deadline === null || Date.now() >= this.scan_deadline) {
            this.finish('idle', CONDITIONS_NOT_MET_MESSAGE);
            return;
        }
        this.target = null;
        this.message = message;
        this.stage = 'scanning';
    }

    private finish(stage: 'idle' | 'stopped', message: string) {
        this.run_token += 1;
        this.clearScanTimer();
        this.scan_deadline = null;
        this.stage = stage;
        this.message = message;
        if (stage === 'idle') this.target = null;
    }

    private engineValuesFor(target: TAiScannerTarget): TEngineValues {
        const locked = this.locked as TAiScannerLocked;
        const setup = OVER_UNDER_SETUPS[locked.strategy];
        return {
            market: 'synthetic_index',
            submarket: target.submarket,
            symbol: target.symbol,
            ai_direction: setup.ai_direction,
            first_barrier: setup.first_barrier,
            recovery_barrier: setup.recovery_barrier,
            stake: locked.stake,
            martingale: locked.martingale,
            take_profit: locked.take_profit,
            stop_loss: locked.stop_loss,
        };
    }

    /** Condition met: write the locked values into the engine, load it into Bot Builder, wait for the entry. */
    private async loadEngine(token: number) {
        const target = this.target as TAiScannerTarget;
        const { run_panel, dashboard } = this.root_store;
        if (run_panel.is_stop_button_visible) {
            this.finish('idle', 'Cancelled: a bot is already running.');
            return;
        }

        const values = this.engineValuesFor(target);
        // Same market and values already loaded (the condition came back
        // after fading) - nothing to reload.
        const is_loaded =
            this.engine_strategy_id === getWorkspace()?.current_strategy_id &&
            sameEngineValues(readWorkspaceEngineValues(), values);

        if (!is_loaded) {
            let xml: string;
            try {
                xml = writeEngineValues(AI_ENGINE_OVER_UNDER_XML, values);
            } catch (error) {
                this.finish('idle', `Could not prepare the engine bot: ${(error as Error).message}`);
                return;
            }
            const strategy_id = createAiEngineStrategyId();
            const ok = await loadBotIntoBuilder({ block_string: xml, file_name: AI_ENGINE_BOT_NAME, strategy_id });
            if (token !== this.run_token) return;
            // Checked from the workspace itself, not the XML we sent: a
            // dropdown can refuse a value (e.g. a symbol missing from its
            // options), and then the bot must not run.
            if (!ok || !sameEngineValues(readWorkspaceEngineValues(), values)) {
                runInAction(() => this.finish('idle', 'Could not load the engine bot with these values.'));
                return;
            }
            this.engine_strategy_id = strategy_id;
            this.engine_values = values;
            dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
        }

        runInAction(() => {
            if (token !== this.run_token || this.stage !== 'loading') return;
            this.stage = 'waiting';
            this.message = '';
        });
    }

    /** Entry hit: press Run through the Run button's own path. */
    private async pressRun(token: number) {
        const { run_panel } = this.root_store;
        const values = this.engine_values;

        if (run_panel.is_stop_button_visible) {
            this.finish('idle', 'Cancelled: a bot is already running.');
            return;
        }
        // The trader is in Bot Builder while we wait - if the engine was
        // swapped out or its blocks edited, reload it rather than run
        // something other than the locked values.
        if (
            !values ||
            getWorkspace()?.current_strategy_id !== this.engine_strategy_id ||
            !sameEngineValues(readWorkspaceEngineValues(), values)
        ) {
            this.engine_strategy_id = null;
            this.goBackToScanning('The engine bot was changed in Bot Builder - scanning again.');
            return;
        }

        this.clearScanTimer();
        this.stage = 'starting';
        // 'starting' unmounts the feeds. Run only once their streams are
        // forgotten: the bot subscribes the same symbol on the same socket,
        // and if it got AlreadySubscribed and leaned on our stream, our
        // forget would then starve it of ticks.
        await this.waitForFeedsToStop();
        if (token !== this.run_token) return;
        if (run_panel.is_stop_button_visible) {
            runInAction(() => this.finish('idle', 'Cancelled: a bot is already running.'));
            return;
        }

        // Take profit and stop loss are measured from zero: the engine's
        // total_profit is session-wide (Total.js) and only clearStat resets it.
        run_panel.clearStat();
        await run_panel.onRunButtonClick();
        if (token !== this.run_token) return;

        runInAction(() => {
            if (run_panel.is_running) {
                this.stage = 'running';
                this.message = '';
            } else {
                this.finish('idle', 'The bot did not start - see the Journal.');
            }
        });
    }

    private onBotStopped() {
        const { total_profit } = this.root_store.transactions.statistics;
        const locked = this.locked;
        let message = 'The bot stopped. See the Journal for why.';
        if (locked && total_profit >= locked.take_profit) message = 'Take profit reached - the bot stopped itself.';
        else if (locked && total_profit <= -locked.stop_loss) message = 'Stop loss reached - the bot stopped itself.';
        else if (this.stage === 'stopping') message = 'Cancelled - the bot was stopped.';
        runInAction(() => {
            this.final_profit = total_profit;
            this.finish('stopped', message);
        });
    }
}
