import { action, computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import {
    AI_ENGINE_BOT_NAME,
    AI_ENGINE_OVER_UNDER_XML,
    AI_SCANNER_CURRENCY,
    AI_SCANNER_MIN_STAKE,
    AI_SCANNER_SCAN_LIMIT_SECONDS,
    AI_SCANNER_TAB_CONTRACT_TYPES,
    OVER_UNDER_SETUPS,
    TOverUnderStrategyId,
} from '@/constants/ai-engine';
import { DBOT_TABS } from '@/constants/bot-contents';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { readEngineValues, TEngineValues, writeEngineValues } from '@/utils/ai-engine-xml';
import { filterOfferedMarkets } from '@/utils/ai-scanner-offered';
import { getOverUnderStrategy, TConditionResult } from '@/utils/ai-strategies';
import { createAiEngineStrategyId } from '@/utils/library-strategies';
import { loadBotIntoBuilder } from '@/utils/load-bot-into-builder';
import RootStore from './root-store';

// The AI Scanner pipeline (components/ai-scanner):
//
//   idle -> checking   contracts_for for every market: only those offering the
//                      tab's contract types at 1 tick are scanned
//        -> scanning   every offered market's last 600 digits, live, all at once. On
//                      each tick: condition() decides whether that market is
//                      qualified (any number can be); a qualified market whose
//                      entry() is true on that tick wins. The engine is loaded
//                      in the background when the first market qualifies.
//        -> starting   first entry wins: feeds closed, the engine pointed at
//                      the winning market and read back, stats cleared, Run
//        -> running    the bot trades until its own TP / SL (an error before
//                      its first contract settles: stopped, 'Run failed on')
//        -> stopped    (or 'stopping' while a cancelled run closes)
//
// The form only ever feeds a run through `locked`, the snapshot taken when
// Scan & Run is pressed - editing the form mid-run changes nothing.

export type TAiScannerStage = 'idle' | 'checking' | 'scanning' | 'starting' | 'running' | 'stopping' | 'stopped';

/** Where the background engine load stands during a scan. */
export type TEngineState = 'none' | 'loading' | 'loaded';

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

export type TQualifiedMarket = { symbol: string; text: string; reason: string };

export type TFeedStatus = { status: string; n: number };

type TFormErrors = Partial<Record<keyof TAiScannerForm, string>>;

const FORM_STORAGE_KEY = 'ai_scanner_form';
export const NO_MARKETS_OFFERED_MESSAGE = 'No markets offer this trade right now.';
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
    /** The winning market, from the moment its entry hits. */
    target: TAiScannerTarget | null = null;
    /** Markets whose condition holds right now, in the order they qualified. */
    qualified: TQualifiedMarket[] = [];
    engine_state: TEngineState = 'none';
    markets: TAiScannerMarket[] = [];
    /** This scan's markets: those of `markets` whose contracts_for offers the trade (checking stage). */
    scan_markets: TAiScannerMarket[] = [];
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
    // Set when the engine errors before its first contract settles; the stop
    // that follows ends the run with it (onBotStopped).
    private run_failure: string | null = null;
    private stopRunErrorListeners: (() => void) | null = null;
    private scan_timer: ReturnType<typeof setTimeout> | null = null;
    private engine_strategy_id: string | null = null;
    private engine_load: Promise<boolean> | null = null;
    // Qualified markets by symbol, kept current on every tick; `qualified`
    // is published from it when the set changes, and with scan_progress for
    // reason-text updates (at most once a second).
    private qualified_by_symbol = new Map<string, TQualifiedMarket>();
    // Tick feeds currently mounted (market-feed.tsx). Run waits for this to
    // reach 0 - see pressRun.
    private mounted_feeds = 0;
    // Latest condition() result per market during a scan, and when
    // scan_progress was last published from it.
    private scan_results = new Map<string, { text: string; reason: string; shortfall?: number; at: number }>();
    private scan_progress_published_at = 0;

    constructor(root_store: RootStore) {
        this.root_store = root_store;

        makeObservable<AiScannerStore, 'finish'>(this, {
            is_panel_open: observable,
            active_tab: observable,
            form: observable,
            use_test_strategy: observable,
            stage: observable,
            locked: observable,
            target: observable,
            qualified: observable.ref,
            engine_state: observable,
            markets: observable.ref,
            scan_markets: observable.ref,
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
            finish: action,
        });

        // A bot started some other way while scanning or waiting: the
        // workspace and the Run button are no longer ours - stand down.
        // While running, the bot stopping (TP / SL / Stop) ends the run.
        reaction(
            () => this.root_store.run_panel.is_stop_button_visible,
            is_live => {
                if (is_live && this.is_pre_run) {
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

    /** Checking or scanning, before any entry hit - Cancel ends it without touching a bot. */
    get is_pre_run() {
        return this.stage === 'checking' || this.stage === 'scanning';
    }

    /**
     * The engine is (being) loaded and is the scanner's: the Market Tool ->
     * Bot Builder sync must leave the market block alone (market-tool-sync.ts).
     */
    get owns_workspace() {
        if (this.stage === 'scanning') return this.engine_state !== 'none';
        return ['starting', 'running', 'stopping'].includes(this.stage);
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

    /** Feeds render from Scan & Run until the winning entry. */
    get are_feeds_wanted() {
        return this.stage === 'scanning';
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

    /** Scan & Run: lock the form, check which markets offer the trade, then scan those. */
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
        this.run_failure = null;
        this.engine_strategy_id = null;
        this.engine_load = null;
        this.engine_state = 'none';
        this.qualified_by_symbol.clear();
        this.qualified = [];
        this.scan_markets = [];
        this.feed_status = {};
        this.message = '';
        this.scan_results.clear();
        this.scan_progress = null;
        this.scan_progress_published_at = 0;
        this.stage = 'checking';

        // Saved now, while it is still the trader's: loading the engine
        // replaces it, and nothing else would have put unsaved edits in Recent.
        this.root_store.run_panel.dbot.saveRecentWorkspace();

        this.checkOfferedMarkets(this.run_token);
    };

    /** Fresh contracts_for for every market; scan only those offering this tab's trade. */
    private async checkOfferedMarkets(token: number) {
        const offered = await filterOfferedMarkets(this.markets, AI_SCANNER_TAB_CONTRACT_TYPES[this.active_tab]);
        if (token !== this.run_token || this.stage !== 'checking') return;
        runInAction(() => {
            if (offered.length === 0) {
                this.finish('idle', NO_MARKETS_OFFERED_MESSAGE);
                return;
            }
            this.scan_markets = offered;
            this.startScanning(token);
        });
    }

    private startScanning(token: number) {
        this.stage = 'scanning';

        // Each feed seeds its window from ticks_history (count 600) the
        // moment it mounts, and condition() runs on that history straight
        // away - no warm-up. The limit covers finding a market only, and
        // starts once the markets are known.
        const limit_ms = AI_SCANNER_SCAN_LIMIT_SECONDS * 1000;
        this.scan_deadline = Date.now() + limit_ms;
        this.clearScanTimer();
        this.scan_timer = setTimeout(
            action(() => {
                this.scan_timer = null;
                // While any market is qualified the scan keeps going past the
                // limit; it stops the first moment after it that none is
                // (onMarketTick).
                if (token === this.run_token && this.stage === 'scanning' && this.qualified_by_symbol.size === 0) {
                    this.finish('idle', CONDITIONS_NOT_MET_MESSAGE);
                }
            }),
            limit_ms
        );
    }

    /** Cancel at any stage. A running bot is stopped through the Stop button's own path. */
    cancel = () => {
        // Entry hit but Run not pressed yet (engine being pointed at the
        // winner, feeds closing).
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
        // Only while scanning: once a winner is picked every later entry -
        // even another market's on the same tick - is ignored.
        // No window-length gate here: each strategy decides what it needs
        // (Over requires all 600); TEST must qualify on the first check.
        if (this.stage !== 'scanning' || !this.locked || digits.length === 0) return;
        if (this.locked.use_test_strategy && !this.can_use_test_strategy) {
            this.finish('idle', 'Cancelled: the TEST strategy only runs on a demo account.');
            return;
        }
        const market = this.scan_markets.find(item => item.symbol === symbol);
        if (!market) return;

        const result = this.strategy.condition(digits);
        const was_qualified = this.qualified_by_symbol.has(symbol);
        if (result.qualified) {
            this.qualified_by_symbol.set(symbol, { symbol, text: market.text, reason: result.reason });
        } else {
            this.qualified_by_symbol.delete(symbol);
        }
        this.recordCheck(market, result, was_qualified !== result.qualified);

        if (result.qualified) {
            // Loaded once, at the first qualify, so Run is quick; pointed at
            // whichever market wins when the entry hits (pressRun).
            if (this.engine_state === 'none') this.loadEngine(market, this.run_token);
            // A re-seed (stream re-subscribed) only re-checks the condition:
            // its last digit is history, not a new tick to enter on.
            if (!is_seed && this.strategy.entry(digits, new_digit)) {
                this.pressRun({ ...market, reason: result.reason }, this.run_token);
            }
            return;
        }

        // Past the limit, the scan ends the first moment no market is qualified.
        if (this.qualified_by_symbol.size === 0 && this.scan_deadline !== null && Date.now() >= this.scan_deadline) {
            this.finish('idle', CONDITIONS_NOT_MET_MESSAGE);
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
        this.qualified = Array.from(this.qualified_by_symbol.values());

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
            checked: this.scan_markets.length,
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

    private finish(stage: 'idle' | 'stopped', message: string) {
        this.run_token += 1;
        this.clearScanTimer();
        const stopRunErrorListeners = this.stopRunErrorListeners;
        this.stopRunErrorListeners = null;
        stopRunErrorListeners?.();
        this.scan_deadline = null;
        this.stage = stage;
        this.message = message;
        this.qualified_by_symbol.clear();
        this.qualified = [];
        if (stage === 'idle') this.target = null;
    }

    private engineValuesFor(target: TAiScannerMarket): TEngineValues {
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

    /**
     * Write the locked values for `market` into a copy of the engine and load
     * it into Bot Builder (the Tbots load path). False when it couldn't - the
     * scan has then already been stopped with the reason.
     */
    private async writeAndLoadEngine(market: TAiScannerMarket, token: number): Promise<boolean> {
        let xml: string;
        try {
            xml = writeEngineValues(AI_ENGINE_OVER_UNDER_XML, this.engineValuesFor(market));
        } catch (error) {
            runInAction(() => this.finish('idle', `Could not prepare the engine bot: ${(error as Error).message}`));
            return false;
        }
        const strategy_id = createAiEngineStrategyId();
        const ok = await loadBotIntoBuilder({ block_string: xml, file_name: AI_ENGINE_BOT_NAME, strategy_id });
        if (token !== this.run_token) return false;
        if (!ok) {
            runInAction(() => this.finish('idle', 'Could not load the engine bot.'));
            return false;
        }
        this.engine_strategy_id = strategy_id;
        return true;
    }

    /** First market qualified: load the engine in the background while every market keeps scanning. */
    private loadEngine(market: TAiScannerMarket, token: number) {
        const { run_panel, dashboard } = this.root_store;
        if (run_panel.is_stop_button_visible) {
            this.finish('idle', 'Cancelled: a bot is already running.');
            return;
        }
        this.engine_state = 'loading';
        this.engine_load = this.writeAndLoadEngine(market, token).then(ok => {
            if (!ok || token !== this.run_token) return false;
            // Checked from the workspace itself, not the XML we sent: a
            // dropdown can refuse a value (e.g. a symbol missing from its
            // options).
            if (!sameEngineValues(readWorkspaceEngineValues(), this.engineValuesFor(market))) {
                runInAction(() => this.finish('idle', 'Could not load the engine bot with these values.'));
                return false;
            }
            runInAction(() => (this.engine_state = 'loaded'));
            dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
            return true;
        });
    }

    /**
     * The first entry wins: close every feed, point the engine at `winner`,
     * check it from the workspace, then press Run through the Run button's
     * own path.
     */
    private async pressRun(winner: TAiScannerTarget, token: number) {
        // Only from a live scan: the engine load started on this same tick
        // may already have stopped it (e.g. the engine couldn't be prepared).
        if (this.stage !== 'scanning' || token !== this.run_token) return;
        const { run_panel } = this.root_store;
        if (run_panel.is_stop_button_visible) {
            this.finish('idle', 'Cancelled: a bot is already running.');
            return;
        }

        this.clearScanTimer();
        this.target = winner;
        this.qualified_by_symbol.clear();
        this.qualified = [];
        // 'starting' unmounts every feed; onMarketTick ignores everything
        // from here, so no other entry can count - not even one on this tick.
        this.stage = 'starting';

        // The background load, if it's still going.
        if (!(await this.engine_load)) return;
        if (token !== this.run_token) return;

        // Point the engine at the winner. If it was loaded for another market,
        // or swapped out / edited in Bot Builder during the scan, it is
        // reloaded with the winner's values rather than edited in place: a
        // reload writes every value by name, and is read back the same way.
        const values = this.engineValuesFor(winner);
        const is_ready =
            getWorkspace()?.current_strategy_id === this.engine_strategy_id &&
            sameEngineValues(readWorkspaceEngineValues(), values);
        if (!is_ready && !(await this.writeAndLoadEngine(winner, token))) return;
        if (token !== this.run_token) return;

        // Never Run on anything but the winning market and the locked values.
        const actual = readWorkspaceEngineValues();
        if (actual?.symbol !== winner.symbol) {
            runInAction(() =>
                this.finish(
                    'idle',
                    `Run not pressed: the engine's market is ${actual?.symbol || 'unknown'}, not the winning market ${
                        winner.symbol
                    }.`
                )
            );
            return;
        }
        if (!sameEngineValues(actual, values)) {
            runInAction(() => this.finish('idle', 'Run not pressed: the engine bot does not hold the locked values.'));
            return;
        }

        // Run only once the feeds' streams are forgotten: the bot subscribes
        // the same symbol on the same socket, and if it leaned on our stream,
        // our forget would then starve it of ticks.
        await this.waitForFeedsToStop();
        if (token !== this.run_token) return;
        if (run_panel.is_stop_button_visible) {
            runInAction(() => this.finish('idle', 'Cancelled: a bot is already running.'));
            return;
        }

        // Take profit and stop loss are measured from zero: the engine's
        // total_profit is session-wide (Total.js) and only clearStat resets it.
        run_panel.clearStat();
        this.listenForRunErrors(winner);
        await run_panel.onRunButtonClick();
        if (token !== this.run_token) return;

        runInAction(() => {
            if (run_panel.is_running) {
                this.stage = 'running';
                this.message = '';
            } else {
                this.finish('idle', this.run_failure ?? 'The bot did not start - see the Journal.');
            }
        });
    }

    /**
     * An engine error before its first contract settles (Deriv refusing the
     * buy, say) ends the run: the bot is stopped through the Stop button's
     * own path and the panel goes back to its start state with the reason.
     * Without this, an error the engine counts as recoverable makes it
     * restart over and over (restart-on-error is on), with the run panel
     * showing "Buying contract" and the scanner never seeing the bot stop.
     * Errors after the first contract are the engine's to handle as usual.
     */
    private listenForRunErrors(winner: TAiScannerTarget) {
        this.stopRunErrorListeners?.();
        const onError = (data: unknown) => {
            if (this.run_failure || !['starting', 'running'].includes(this.stage)) return;
            const statistics = this.root_store.transactions.statistics as { number_of_runs?: number };
            if ((statistics.number_of_runs ?? 0) > 0) return;

            const error = data as { message?: string; error?: { message?: string } } | string | undefined;
            const message =
                (typeof error === 'string' ? error : (error?.error?.message ?? error?.message)) || 'Unknown error';
            this.run_failure = `Run failed on ${winner.text}: ${message}`;

            // After the engine's own handling of this error has run (the emit
            // is synchronous): the same as the trader pressing Stop now.
            setTimeout(() => {
                if (!this.run_failure) return;
                if (this.root_store.run_panel.is_stop_button_visible) this.root_store.run_panel.onStopBotClick();
                else this.onBotStopped();
            }, 0);
        };
        const events = ['Error', 'ui.log.error'];
        events.forEach(event => globalObserver.register(event, onError));
        // Safe in every case: the run panel drops ALL 'Error' listeners
        // (observer.unregisterAll) when a bot stops, and the observer's own
        // unregister throws on an event with no listener list left - so only
        // unregister what is still registered, never throw, and only once.
        let is_registered = true;
        this.stopRunErrorListeners = () => {
            if (!is_registered) return;
            is_registered = false;
            events.forEach(event => {
                try {
                    if (globalObserver.isRegistered(event)) globalObserver.unregister(event, onError);
                } catch {
                    // Nothing left to remove.
                }
            });
        };
    }

    private onBotStopped() {
        if (this.run_failure) {
            const failure = this.run_failure;
            this.run_failure = null;
            runInAction(() => this.finish('idle', failure));
            return;
        }
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
