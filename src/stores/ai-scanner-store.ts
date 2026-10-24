import { action, computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import {
    AI_ENGINE_BOT_NAME,
    AI_ENGINE_EVEN_ODD_BOT_NAME,
    AI_ENGINE_EVEN_ODD_XML,
    AI_ENGINE_OVER_UNDER_XML,
    AI_SCANNER_ARM_SECONDS,
    AI_SCANNER_CURRENCY,
    AI_SCANNER_MIN_STAKE,
    AI_SCANNER_SCAN_LIMIT_SECONDS,
    AI_SCANNER_TAB_CONTRACT_TYPES,
    OVER_UNDER_SETUPS,
    TOverUnderStrategyId,
} from '@/constants/ai-engine';
import { DBOT_TABS } from '@/constants/bot-contents';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { readEngineValues, TEngineValues, writeEngineValues } from '@/utils/ai-engine-xml';
import { filterOfferedMarkets } from '@/utils/ai-scanner-offered';
import { installSilenceLog, lastSocketMessageAt, probeSocket, silenceLog } from '@/utils/ai-silence-log';
import { getScannerStrategy, TConditionResult, TSide } from '@/utils/ai-strategies';
import { createAiEngineStrategyId } from '@/utils/library-strategies';
import { loadBotIntoBuilder } from '@/utils/load-bot-into-builder';
import RootStore from './root-store';

// The AI Scanner pipeline (components/ai-scanner):
//
//   idle -> checking   contracts_for for every market: only those offering the
//                      tab's contract types at 1 tick are scanned
//        -> scanning   every offered market's last 600 digits, live, all at once.
//                      A market meeting condition() becomes ARMED for 3 minutes
//                      (any number can be, each with its own clock) and stays
//                      armed even if the condition stops holding; the first
//                      armed market whose entry() is true on a live tick wins.
//                      An armed market reaching 3:00 is disarmed and can arm
//                      again later. Nothing is loaded while scanning: loading
//                      the engine makes the bot engine send forget_all 'ticks',
//                      silencing every feed.
//        -> starting   first entry wins: feeds closed, THEN the engine loaded
//                      with the winner's values and read back, stats cleared, Run
//        -> running    the bot trades until its own TP / SL (an error before
//                      its first contract settles: stopped, 'Run failed on')
//        -> stopped    (or 'stopping' while a cancelled run closes)
//
// The form only ever feeds a run through `locked`, the snapshot taken when
// Scan is pressed - editing the form mid-run changes nothing.

export type TAiScannerStage = 'idle' | 'checking' | 'scanning' | 'starting' | 'running' | 'stopping' | 'stopped';

export type TAiScannerTab = 'over_under' | 'even_odd';

export type TAiScannerForm = {
    strategy: TOverUnderStrategyId;
    stake: string;
    martingale: string;
    take_profit: string;
    stop_loss: string;
};

export type TAiScannerLocked = {
    /** The tab the scan runs: its strategy, contract types and engine. */
    tab: TAiScannerTab;
    /** Over/Under tab: which of the two. */
    strategy: TOverUnderStrategyId;
    stake: number;
    martingale: number;
    take_profit: number;
    stop_loss: number;
    use_test_strategy: boolean;
    loginid: string;
};

export type TAiScannerMarket = { symbol: string; text: string; submarket: string };

/** The winning market. `side`: Even/Odd only - the side it armed with. */
export type TAiScannerTarget = TAiScannerMarket & { reason: string; side?: TSide };

export type TArmedMarket = {
    symbol: string;
    text: string;
    armed_at: number;
    /** When it is disarmed without an entry (ms since epoch). */
    expires_at: number;
    /** The strategy's reason text from the latest check - live, not the one it armed with. */
    reason: string;
    /** Whether the condition still held on the latest check (on Even/Odd: for the armed side). */
    still_met: boolean;
    /** Even/Odd only: the side it armed with, kept until it disarms. */
    side?: TSide;
};

export type TFeedStatus = { status: string; n: number };

/** "<market> dropped — conditions changed", shown for DROP_NOTICE_MS. */
export type TDropNotice = { id: number; text: string };

type TFormErrors = Partial<Record<keyof TAiScannerForm, string>>;

const FORM_STORAGE_KEY = 'ai_scanner_form';
export const SCAN_STOPPED_MESSAGE = 'Scan stopped.';
export const NO_MARKETS_OFFERED_MESSAGE = 'No markets offer this trade right now.';
// No scanner feed with a live tick for this long (they tick about once a
// second) means the streams stopped together - Deriv silently stops them now
// and then, and re-subscribing brings them straight back: re-subscribe every
// feed at once instead of waiting for each one's 3s watchdog. A one-shot timer
// is set for exactly this long after the newest live tick (no polling), and
// every socket message re-checks too: browsers hold back timers in a
// background tab but keep delivering WebSocket messages. At most once per
// RESUBSCRIBE_COOLDOWN_MS, measured from the last all-at-once re-subscribe.
export const ALL_SILENT_MS = 2000;
export const RESUBSCRIBE_COOLDOWN_MS = 5000;
const DROP_NOTICE_MS = 3000;

export const CONDITIONS_NOT_MET_MESSAGE = 'Conditions not met — no entry found.';

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
    /** Armed markets, in the order they armed - each waiting for its own entry. */
    armed: TArmedMarket[] = [];
    /** Markets just dropped because their condition changed (strategies that don't keep them armed). */
    drop_notices: TDropNotice[] = [];
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
    // The all-feeds-silent watch (see ALL_SILENT_MS): each feed's re-subscribe,
    // when any market last had a LIVE tick (seeds don't count), when all were
    // last re-subscribed together, the one-shot check and the socket listener.
    private silence_timer: ReturnType<typeof setTimeout> | null = null;
    private silence_message_subscription: { unsubscribe: () => void } | null = null;
    private feed_retries = new Set<() => void>();
    private newest_live_tick_at: number | null = null;
    private silent_since: number | null = null;
    private resubscribed_all_at: number | null = null;
    // Armed markets by symbol, kept current on every tick, and each one's
    // 3-minute timer. `armed` is published from it at once when a market arms,
    // disarms or its condition flips, and otherwise with scan_progress (at
    // most once a second) for the live reason text.
    private armed_by_symbol = new Map<string, TArmedMarket>();
    private arm_timers = new Map<string, ReturnType<typeof setTimeout>>();
    private drop_notice_timers = new Set<ReturnType<typeof setTimeout>>();
    private drop_notice_id = 0;
    // Tick feeds currently mounted (market-feed.tsx). Run waits for this to
    // reach 0 - see pressRun.
    private mounted_feeds = 0;
    // Latest condition() result per market during a scan, and when
    // scan_progress was last published from it.
    private scan_results = new Map<string, { text: string; reason: string; shortfall?: number; at: number }>();
    private scan_progress_published_at = 0;

    constructor(root_store: RootStore) {
        this.root_store = root_store;
        installSilenceLog(); // [AI-SILENCE] temporary diagnostics

        makeObservable<AiScannerStore, 'finish'>(this, {
            is_panel_open: observable,
            active_tab: observable,
            form: observable,
            use_test_strategy: observable,
            stage: observable,
            locked: observable,
            target: observable,
            armed: observable.ref,
            drop_notices: observable.ref,
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
        // The tab is part of the run - it can't change while one is going.
        if (this.is_active) return;
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

    /** A feed opens: counted (Run waits for 0), and its re-subscribe kept for an all-at-once recovery. */
    registerFeed = (resubscribe?: () => void) => {
        this.mounted_feeds += 1;
        if (resubscribe) this.feed_retries.add(resubscribe);
        return () => {
            this.mounted_feeds -= 1;
            if (resubscribe) this.feed_retries.delete(resubscribe);
        };
    };

    /** Feeds render from Scan until the winning entry. */
    get are_feeds_wanted() {
        return this.stage === 'scanning';
    }

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

    /** Scan: lock the form, check which markets offer the trade, then scan those. */
    start = () => {
        if (!this.can_start) return;
        this.run_token += 1;
        this.locked = {
            tab: this.active_tab,
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
        this.clearArmed();
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
        const tab = (this.locked as TAiScannerLocked).tab;
        const offered = await filterOfferedMarkets(this.markets, AI_SCANNER_TAB_CONTRACT_TYPES[tab]);
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
        this.newest_live_tick_at = null;
        this.silent_since = null;
        this.resubscribed_all_at = null;

        // Each feed seeds its window from ticks_history (count 600) the
        // moment it mounts, and condition() runs on that history straight
        // away - no warm-up. The limit covers finding a market only, and
        // starts once the markets are known.
        const limit_ms = AI_SCANNER_SCAN_LIMIT_SECONDS * 1000;
        this.scan_deadline = Date.now() + limit_ms;
        this.clearScanTimer();
        this.watchSocketForSilence(token);
        this.scan_timer = setTimeout(
            action(() => {
                this.scan_timer = null;
                // While any market is armed the scan keeps going past the
                // limit; it ends the first moment after it that none is
                // (disarm).
                if (token === this.run_token) this.endScanIfNothingArmed();
            }),
            limit_ms
        );
    }

    /**
     * The panel's "Stop scan" (checking / scanning): ends the scan at once -
     * feeds close, timers clear, nothing is loaded or run. Also stops a run
     * through the Stop button's own path if ever called once a bot runs.
     */
    cancel = () => {
        // Nothing to stop: ready, or the last run has already ended.
        if (!this.is_active) return;
        // Entry hit but Run not pressed yet (feeds closing, engine loading).
        if (this.stage === 'starting' && !this.root_store.run_panel.is_stop_button_visible) {
            this.finish('idle', SCAN_STOPPED_MESSAGE);
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
        this.finish('idle', SCAN_STOPPED_MESSAGE);
    };

    private get strategy() {
        const locked = this.locked as TAiScannerLocked;
        return getScannerStrategy(locked.tab, locked.strategy, locked.use_test_strategy && this.can_use_test_strategy);
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
        if (!is_seed) {
            this.newest_live_tick_at = Date.now();
            if (this.silent_since !== null) {
                silenceLog(`live ticks back after ${Date.now() - this.silent_since}ms (first: ${symbol})`);
                this.silent_since = null;
            }
            this.scheduleSilenceCheck(this.run_token);
        }

        const result = this.strategy.condition(digits);
        let armed = this.armed_by_symbol.get(symbol);
        let changed = false;
        let dropped = false;
        // Even/Odd arms with the side it qualified on (TEST: Even).
        const side = this.locked.tab === 'even_odd' ? (result.side ?? 'even') : undefined;
        if (armed) {
            // Met for the ARMED side: on Even/Odd, qualifying for the other
            // side is a changed condition too.
            const still_met = result.qualified && (armed.side === undefined || result.side === armed.side);
            if (!still_met && this.strategy.keepArmedWhenConditionFades === false && !is_seed) {
                // Dropped at once (Even/Odd). Only on a live tick: a
                // re-subscribe's seed never disarms - the next live tick
                // re-checks within about a second.
                this.dropArmed(armed);
                armed = undefined;
                changed = true;
                dropped = true;
            } else {
                // Otherwise it stays armed whatever the condition does now
                // (Over/Under); the panel shows it.
                if (armed.still_met !== still_met) changed = true;
                armed.reason = result.reason;
                armed.still_met = still_met;
            }
        }
        // Not armed (or just dropped - back to normal scanning): arms when
        // it qualifies, with a fresh 3 minutes and whatever side it has now.
        if (!armed && result.qualified) {
            armed = this.arm(market, result.reason, side);
            changed = true;
        }
        this.recordCheck(market, result, changed);
        // The scan rule is unchanged: past 5:00 with nothing armed, it ends.
        if (dropped) {
            this.endScanIfNothingArmed();
            if (this.stage !== 'scanning') return;
        }

        // An armed market waits for its own entry on every live tick. A
        // re-seed (stream re-subscribed) is history, never an entry. A
        // strategy that drops faded markets only enters while the condition
        // still holds for the armed side on this very tick.
        const can_enter = armed && (this.strategy.keepArmedWhenConditionFades !== false || armed.still_met);
        if (armed && can_enter && !is_seed && this.strategy.entry(digits, new_digit, { side: armed.side })) {
            this.pressRun({ ...market, reason: armed.reason, side: armed.side }, this.run_token);
        }
    };

    /** Arm `market` for AI_SCANNER_ARM_SECONDS, on its own clock. */
    private arm(market: TAiScannerMarket, reason: string, side?: TSide): TArmedMarket {
        const now = Date.now();
        const arm_ms = AI_SCANNER_ARM_SECONDS * 1000;
        const armed: TArmedMarket = {
            symbol: market.symbol,
            text: market.text,
            armed_at: now,
            expires_at: now + arm_ms,
            reason,
            still_met: true,
            ...(side ? { side } : {}),
        };
        this.armed_by_symbol.set(market.symbol, armed);
        const token = this.run_token;
        this.arm_timers.set(
            market.symbol,
            setTimeout(
                action(() => this.disarm(market.symbol, token)),
                arm_ms
            )
        );
        return armed;
    }

    /** 3:00 without an entry. It can arm again later, with a fresh 3 minutes. */
    private disarm(symbol: string, token: number) {
        this.arm_timers.delete(symbol);
        if (token !== this.run_token || this.stage !== 'scanning') return;
        this.armed_by_symbol.delete(symbol);
        this.publishArmed();
        this.endScanIfNothingArmed();
    }

    /** Condition changed on a strategy that doesn't keep faded markets armed: drop it now. */
    private dropArmed(armed: TArmedMarket) {
        const timer = this.arm_timers.get(armed.symbol);
        if (timer) clearTimeout(timer);
        this.arm_timers.delete(armed.symbol);
        this.armed_by_symbol.delete(armed.symbol);

        const notice: TDropNotice = { id: ++this.drop_notice_id, text: `${armed.text} dropped — conditions changed` };
        this.drop_notices = [...this.drop_notices, notice];
        const notice_timer = setTimeout(
            action(() => {
                this.drop_notice_timers.delete(notice_timer);
                this.drop_notices = this.drop_notices.filter(item => item.id !== notice.id);
            }),
            DROP_NOTICE_MS
        );
        this.drop_notice_timers.add(notice_timer);
    }

    /** The scan ends only once 5:00 have passed since Scan AND nothing is armed. */
    private endScanIfNothingArmed() {
        if (
            this.stage === 'scanning' &&
            this.armed_by_symbol.size === 0 &&
            this.scan_deadline !== null &&
            Date.now() >= this.scan_deadline
        ) {
            this.finish('idle', CONDITIONS_NOT_MET_MESSAGE);
        }
    }

    private publishArmed() {
        this.armed = Array.from(this.armed_by_symbol.values()).map(armed => ({ ...armed }));
    }

    private clearArmed() {
        this.arm_timers.forEach(timer => clearTimeout(timer));
        this.arm_timers.clear();
        this.armed_by_symbol.clear();
        this.armed = [];
        this.drop_notice_timers.forEach(timer => clearTimeout(timer));
        this.drop_notice_timers.clear();
        this.drop_notices = [];
    }

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
        this.publishArmed();

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
        if (this.silence_timer) {
            clearTimeout(this.silence_timer);
            this.silence_timer = null;
        }
        this.silence_message_subscription?.unsubscribe();
        this.silence_message_subscription = null;
    }

    /** Every message on the app's socket re-checks for silence (timers may be held back; messages aren't). */
    private watchSocketForSilence(token: number) {
        const api = api_base.api as unknown as {
            onMessage?: () => { subscribe: (listener: () => void) => { unsubscribe: () => void } };
        } | null;
        if (typeof api?.onMessage !== 'function') return;
        this.silence_message_subscription = api.onMessage().subscribe(() => this.checkSilence(token));
    }

    /**
     * One timer, due when the silence would reach ALL_SILENT_MS - or, inside
     * the throttle, when RESUBSCRIBE_COOLDOWN_MS since the last all-at-once
     * re-subscribe has passed. Re-set on every live tick.
     */
    private scheduleSilenceCheck(token: number) {
        if (this.silence_timer) clearTimeout(this.silence_timer);
        this.silence_timer = null;
        if (this.newest_live_tick_at === null) return;
        const due = Math.max(
            this.newest_live_tick_at + ALL_SILENT_MS,
            this.resubscribed_all_at === null ? 0 : this.resubscribed_all_at + RESUBSCRIBE_COOLDOWN_MS
        );
        this.silence_timer = setTimeout(
            () => {
                this.silence_timer = null;
                this.checkSilence(token);
            },
            Math.max(0, due - Date.now())
        );
    }

    /**
     * All scanner feeds silent together (none had a live tick for
     * ALL_SILENT_MS) - Deriv pausing every stream, or the connection stalling:
     * log it, ping the socket to tell which, and re-subscribe every feed in
     * one go. A re-subscribe only re-seeds the windows: a seed is never an
     * entry and nothing disarms (disarming is the 3-minute clock alone).
     */
    private checkSilence(token: number) {
        if (token !== this.run_token || this.stage !== 'scanning') return;
        // Measured from the newest live tick of ANY market - a feed that never
        // loads must not switch the watch off.
        if (this.newest_live_tick_at === null || this.scan_markets.length === 0) return;
        const now = Date.now();
        const newest = this.newest_live_tick_at;
        const silent_for = now - newest;
        if (silent_for < ALL_SILENT_MS) return;

        if (this.silent_since === null) {
            this.silent_since = newest;
            const last_message = lastSocketMessageAt();
            silenceLog(
                `all ${this.scan_markets.length} feeds silent for ${silent_for}ms (last live tick ${new Date(newest)
                    .toISOString()
                    .slice(11, 23)}; last socket message of any kind ${
                    last_message ? `${now - last_message}ms ago` : 'never'
                })`
            );
            probeSocket('all feeds silent');
        }
        if (this.resubscribed_all_at !== null && now - this.resubscribed_all_at < RESUBSCRIBE_COOLDOWN_MS) {
            // Inside the throttle: the timer comes back when it ends.
            if (!this.silence_timer) this.scheduleSilenceCheck(token);
            return;
        }
        this.resubscribed_all_at = now;
        silenceLog(`re-subscribing all ${this.feed_retries.size} feeds at once (silent for ${silent_for}ms)`);
        this.feed_retries.forEach(resubscribe => resubscribe());
        // Still silent 5s from now? Again then.
        this.scheduleSilenceCheck(token);
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
        this.clearArmed();
        if (stage === 'idle') this.target = null;
    }

    private engineValuesFor(target: TAiScannerTarget): TEngineValues {
        const locked = this.locked as TAiScannerLocked;
        if (locked.tab === 'even_odd') {
            // Even -> AI DIRECTION 1 (DIGITEVEN), Odd -> 0 (DIGITODD). No barriers.
            return {
                market: 'synthetic_index',
                submarket: target.submarket,
                symbol: target.symbol,
                ai_direction: target.side === 'odd' ? 0 : 1,
                stake: locked.stake,
                martingale: locked.martingale,
                take_profit: locked.take_profit,
                stop_loss: locked.stop_loss,
            };
        }
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
    private async writeAndLoadEngine(market: TAiScannerTarget, token: number): Promise<boolean> {
        const is_even_odd = (this.locked as TAiScannerLocked).tab === 'even_odd';
        let xml: string;
        try {
            xml = writeEngineValues(
                is_even_odd ? AI_ENGINE_EVEN_ODD_XML : AI_ENGINE_OVER_UNDER_XML,
                this.engineValuesFor(market)
            );
        } catch (error) {
            runInAction(() => this.finish('idle', `Could not prepare the engine bot: ${(error as Error).message}`));
            return false;
        }
        const ok = await loadBotIntoBuilder({
            block_string: xml,
            file_name: is_even_odd ? AI_ENGINE_EVEN_ODD_BOT_NAME : AI_ENGINE_BOT_NAME,
            strategy_id: createAiEngineStrategyId(),
        });
        if (token !== this.run_token) return false;
        if (!ok) {
            runInAction(() => this.finish('idle', 'Could not load the engine bot.'));
            return false;
        }
        return true;
    }

    /**
     * The first entry wins: close every feed, THEN load the engine with the
     * winner's values, check them from the workspace, and press Run through
     * the Run button's own path. In that order because loading the engine
     * makes the bot engine send forget_all 'ticks' - nothing of the scan may
     * still be listening when it does.
     */
    private async pressRun(winner: TAiScannerTarget, token: number) {
        if (this.stage !== 'scanning' || token !== this.run_token) return;
        const { run_panel, dashboard } = this.root_store;
        if (run_panel.is_stop_button_visible) {
            this.finish('idle', 'Cancelled: a bot is already running.');
            return;
        }

        this.clearScanTimer();
        this.target = winner;
        this.clearArmed();
        // 'starting' closes every feed; onMarketTick ignores everything from
        // here, so no other entry can count - not even one on this tick.
        this.stage = 'starting';

        // 1. Every feed has let go of its stream (each one's forget sent).
        await this.waitForFeedsToStop();
        if (token !== this.run_token) return;

        // 2. The engine, with the winner's market and the locked values.
        if (!(await this.writeAndLoadEngine(winner, token))) return;
        if (token !== this.run_token) return;
        dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);

        // 3. Read back from the workspace itself, not the XML sent: a dropdown
        //    can refuse a value (a symbol missing from its options, say).
        //    Never Run on anything but the winning market and the locked values.
        const values = this.engineValuesFor(winner);
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
        if (run_panel.is_stop_button_visible) {
            runInAction(() => this.finish('idle', 'Cancelled: a bot is already running.'));
            return;
        }

        // 4. Run. Take profit and stop loss are measured from zero: the
        //    engine's total_profit is session-wide (Total.js) and only
        //    clearStat resets it.
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
