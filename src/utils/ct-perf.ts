/**
 * [CT perf] - execution timing and main-thread health, console only.
 *
 * Measures, for every trade, how long Deriv takes (proposal, buy) and how
 * long OUR side takes between "the previous result is in" and "the next buy
 * is sent", split into what the trading rules make it wait for (ticks in
 * Normal, Fast's minimum gap) and what is our own overhead (listeners,
 * storage, the strategy's blocks, main-thread stalls).
 *
 * Also: the keep-alive ping's round trip, long tasks / long animation
 * frames while a bot or the AI Scanner is busy, the time each socket message
 * takes to handle, the live WebSocket subscriptions, the loaders shown at
 * start-up and on an account switch, and nav-tab switches during a run.
 *
 * Never logs a token, an OTP or a URL with query parameters. Never touches
 * the UI. window.__ctPerf() prints a summary and returns it.
 */

type TSeriesName =
    | 'proposal'
    | 'buy'
    | 'result_to_buy'
    | 'ours'
    | 'tick_to_buy'
    | 'ping'
    | 'result_handling'
    | 'pre_send';

type TSection = { count: number; total: number; max: number };

type TLongTask = {
    at: number;
    duration: number;
    busy: boolean;
    reason: string;
};

type TDelayedTrade = {
    trade: number;
    mode: string;
    ours_ms: number;
    reasons: string[];
};

type TSub = { type: string; key: string; since: number; msgs: number };

type TLoader = { name: string; shown_at: number; hidden_at: number | null };

const PREFIX = '[CT perf]';
const MAX_SAMPLES = 2000;
const MAX_LONG_TASKS = 500;
const MAX_DELAYED = 200;
/** A trade is "delayed on our side" when our own overhead is above this. */
export const OUR_DELAY_THRESHOLD_MS = 300;
const CONTEXT_WINDOW_MS = 2000;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const round = (ms: number) => Math.round(ms);

export const summarise = (values: number[]) => {
    if (!values.length) return { count: 0, avg: 0, p95: 0, max: 0 };
    const sorted = values.slice().sort((a, b) => a - b);
    const sum = sorted.reduce((total, v) => total + v, 0);
    const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
    return {
        count: sorted.length,
        avg: round(sum / sorted.length),
        p95: round(p95),
        max: round(sorted[sorted.length - 1]),
    };
};

const keyOf = (data: Record<string, any>): string => {
    const echo = data.echo_req ?? {};
    if (echo.ticks_history || echo.ticks) return String(echo.ticks_history ?? echo.ticks);
    if (data.tick?.symbol) return String(data.tick.symbol);
    if (data.ohlc?.symbol) return `${data.ohlc.symbol}/${data.ohlc.granularity}`;
    if (echo.proposal) return `${echo.underlying_symbol ?? echo.symbol ?? ''} ${echo.contract_type ?? ''}`.trim();
    if (echo.proposal_open_contract) return echo.contract_id ? String(echo.contract_id) : 'all contracts';
    return '';
};

/** Stream type, with a ticks_history seed and its later ticks counted as one "ticks" stream. */
const typeOf = (msg_type: string) => {
    if (msg_type === 'history' || msg_type === 'tick') return 'ticks';
    if (msg_type === 'candles' || msg_type === 'ohlc') return 'candles';
    return msg_type;
};

class CtPerf {
    series: Record<TSeriesName, number[]> = {
        proposal: [],
        buy: [],
        result_to_buy: [],
        ours: [],
        tick_to_buy: [],
        ping: [],
        result_handling: [],
        pre_send: [],
    };

    trade_no = 0;
    delayed: TDelayedTrade[] = [];
    long_tasks: TLongTask[] = [];
    sections: Record<string, TSection> = {};
    message_handling: Record<string, TSection> = {};
    subs = new Map<string, TSub>();
    counters = { already_subscribed: 0, rate_limit: 0, forget_all_ticks_while_busy: 0, buy_retries: 0 };
    loaders: TLoader[] = [];
    marks: { name: string; at: number }[] = [];
    gauges: Record<string, number> = {};
    heap_first: number | null = null;
    heap_last: number | null = null;
    busy = new Set<string>();
    enabled = true;

    // One trade cycle: result in -> next buy sent.
    private result_in_at: number | null = null;
    private watch_wait_ms = 0;
    private design_wait_ms = 0;
    private released_by_tick = false;
    private last_bot_tick_at: number | null = null;
    private buy_called_at: number | null = null;
    private buy_sent_at: number | null = null;
    private buy_mode = 'normal';
    private open_sections: { name: string; start: number }[] = [];
    private recent_sections: { name: string; start: number; end: number }[] = [];
    private context: { label: string; at: number } | null = null;
    private last_msg_type = '';
    private is_observing = false;
    private watched_apis = new WeakSet<object>();
    private current_api: object | null = null;

    // ---- trade timeline -------------------------------------------------

    /** A watch('before' | 'during') promise settled after waiting `waited_ms`. */
    watchSettled(watch_name: string, waited_ms: number, was_fast_pass: boolean) {
        if (this.result_in_at !== null) this.watch_wait_ms += waited_ms;
        if (watch_name === 'before') this.released_by_tick = !was_fast_pass;
    }

    /** Fast's minimum gap between two buys held the buy back for `ms`. */
    designWait(ms: number) {
        if (ms > 0) this.design_wait_ms += ms;
    }

    /** The bot's own tick stream delivered a tick (ticks_service). */
    botTick() {
        this.last_bot_tick_at = now();
    }

    /** Purchase.sendPurchase entered. */
    buyCalled(mode: string) {
        this.buy_called_at = now();
        this.buy_sent_at = null;
        this.buy_mode = mode;
    }

    /** The buy request is handed to the socket (first attempt only). */
    buySent() {
        if (this.buy_sent_at !== null) {
            this.counters.buy_retries += 1;
            return;
        }
        const sent_at = now();
        this.buy_sent_at = sent_at;
        this.trade_no += 1;
        if (this.buy_called_at !== null) this.add('pre_send', sent_at - this.buy_called_at);
        if (this.released_by_tick && this.last_bot_tick_at !== null) {
            this.add('tick_to_buy', sent_at - this.last_bot_tick_at);
        }
        if (this.result_in_at !== null) {
            const gap = sent_at - this.result_in_at;
            const waits = this.watch_wait_ms + this.design_wait_ms;
            const ours = Math.max(0, gap - waits);
            this.add('result_to_buy', gap);
            this.add('ours', ours);
            if (ours > OUR_DELAY_THRESHOLD_MS) this.recordDelayed(ours, this.result_in_at, sent_at);
        }
        this.result_in_at = null;
        this.watch_wait_ms = 0;
        this.design_wait_ms = 0;
        this.released_by_tick = false;
        this.sampleHeap();
    }

    /** Deriv confirmed the buy. */
    buyConfirmed() {
        if (this.buy_sent_at === null) return;
        const ms = now() - this.buy_sent_at;
        this.add('buy', ms);
        this.log(
            `#${this.trade_no} ${this.buy_mode} | buy ${round(ms)} ms` +
                this.lastValueText('result_to_buy', ' | result→buy sent ') +
                this.lastValueText('ours', ' (ours ') +
                (this.lastSample('ours') !== null ? ')' : '') +
                this.lastValueText('pre_send', ' | pre-send ')
        );
    }

    /** The sold contract's update reached OpenContract (before any listener ran). */
    resultIn() {
        this.result_in_at = now();
        this.watch_wait_ms = 0;
        this.design_wait_ms = 0;
    }

    /** OpenContract finished recording the result (totals, Journal, Transactions) - right before sell(). */
    resultRecorded() {
        if (this.result_in_at === null) return;
        this.add('result_handling', now() - this.result_in_at);
    }

    /** Times one proposal request until Deriv's first answer. Returns the same promise. */
    timeProposal<T>(request: T): T {
        const start = now();
        Promise.resolve(request)
            .then(() => this.add('proposal', now() - start))
            .catch(() => undefined);
        return request;
    }

    /** Keep-alive ping round trip. */
    timePing(request: unknown) {
        const start = now();
        Promise.resolve(request)
            .then(() => this.add('ping', now() - start))
            .catch(() => undefined);
    }

    // ---- sections, contexts, loaders --------------------------------------

    /** Runs fn as a named section: its time is counted, and a long task inside it is blamed on it. */
    time<T>(name: string, fn: () => T): T {
        const start = now();
        const entry = { name, start };
        this.open_sections.push(entry);
        try {
            return fn();
        } finally {
            const end = now();
            this.open_sections = this.open_sections.filter(s => s !== entry);
            const section = (this.sections[name] ??= { count: 0, total: 0, max: 0 });
            section.count += 1;
            section.total += end - start;
            section.max = Math.max(section.max, end - start);
            if (end - start > 16) {
                this.recent_sections.push({ name, start, end });
                if (this.recent_sections.length > 50) this.recent_sections.shift();
            }
        }
    }

    /** What the app is doing now (a tab switch, an account switch): long tasks soon after are blamed on it. */
    setContext(label: string) {
        this.context = { label, at: now() };
        this.mark(label);
        if (this.busy.size) this.log(`${label} while ${[...this.busy].join(' + ')} running`);
    }

    mark(name: string) {
        this.marks.push({ name, at: round(now()) });
        if (this.marks.length > 200) this.marks.shift();
    }

    /** A loader became visible; call the returned function when it goes. */
    loaderShown(name: string) {
        const loader: TLoader = { name, shown_at: round(now()), hidden_at: null };
        this.loaders.push(loader);
        if (this.loaders.length > 100) this.loaders.shift();
        return () => {
            loader.hidden_at = round(now());
        };
    }

    gauge(name: string, value: number) {
        this.gauges[name] = value;
    }

    // ---- busy state, long tasks -------------------------------------------

    /** A bot (`bot`) or the AI Scanner (`ai_scanner`) started or stopped being busy. */
    setBusy(reason: string, is_busy: boolean) {
        const was_busy = this.busy.size > 0;
        if (is_busy) this.busy.add(reason);
        else this.busy.delete(reason);
        if (!was_busy && this.busy.size) this.mark(`busy: ${reason}`);
        if (was_busy && !this.busy.size) this.mark('idle');
    }

    /** Starts the long-task observer (long-animation-frame where supported - it names the script). */
    observeLongTasks() {
        if (this.is_observing || typeof PerformanceObserver === 'undefined') return;
        const supported: readonly string[] = PerformanceObserver.supportedEntryTypes ?? [];
        const type = supported.includes('long-animation-frame')
            ? 'long-animation-frame'
            : supported.includes('longtask')
              ? 'longtask'
              : null;
        if (!type) return;
        try {
            const observer = new PerformanceObserver(list => {
                list.getEntries().forEach(entry => this.onLongTask(entry));
            });
            observer.observe({ type, buffered: true });
            this.is_observing = true;
        } catch {
            // Not supported here: nothing to measure.
        }
    }

    private onLongTask(entry: PerformanceEntry) {
        // A long animation frame that never blocked (it only waited) is not a stall.
        const blocking = (entry as unknown as { blockingDuration?: number }).blockingDuration;
        if (blocking === 0) return;
        const duration = entry.duration;
        if (duration < 50) return;
        const task: TLongTask = {
            at: round(entry.startTime),
            duration: round(duration),
            busy: this.busy.size > 0,
            reason: this.blame(entry),
        };
        this.long_tasks.push(task);
        if (this.long_tasks.length > MAX_LONG_TASKS) this.long_tasks.shift();
        if (task.busy && task.duration >= 100) {
            this.log(`main thread blocked ${task.duration} ms during a run - ${task.reason}`);
        }
    }

    /** Best guess at what a long task was: our own named section, the script (LoAF), or a recent context. */
    private blame(entry: PerformanceEntry) {
        const start = entry.startTime;
        const end = start + entry.duration;
        const sections = [
            ...this.recent_sections.filter(s => s.start < end && s.end > start).map(s => s.name),
            ...this.open_sections.map(s => s.name),
        ];
        if (sections.length) return [...new Set(sections)].join(', ');
        const scripts = (entry as unknown as { scripts?: Record<string, any>[] }).scripts ?? [];
        if (scripts.length) {
            const top = scripts.slice().sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))[0];
            const file = String(top.sourceURL ?? '')
                .split('?')[0]
                .split('/')
                .pop();
            const fn = top.sourceFunctionName ? ` ${top.sourceFunctionName}` : '';
            return `${top.invoker ?? top.invokerType ?? 'script'}${fn}${file ? ` (${file})` : ''}`;
        }
        if (this.context && start - this.context.at < CONTEXT_WINDOW_MS && start >= this.context.at) {
            return `after ${this.context.label}`;
        }
        return 'unknown (rendering, layout or a browser task)';
    }

    private recordDelayed(ours: number, from: number, to: number) {
        const reasons: string[] = [];
        const handling = this.lastSample('result_handling');
        if (handling !== null && handling > 50) reasons.push(`recording the result took ${round(handling)} ms`);
        const tasks = this.long_tasks.filter(t => t.at >= from - 50 && t.at <= to);
        tasks.forEach(t => reasons.push(`main thread blocked ${t.duration} ms: ${t.reason}`));
        if (!reasons.length) reasons.push("the strategy's blocks / engine between the result and the buy");
        this.delayed.push({ trade: this.trade_no, mode: this.buy_mode, ours_ms: round(ours), reasons });
        if (this.delayed.length > MAX_DELAYED) this.delayed.shift();
        this.warn(`#${this.trade_no} delayed ${round(ours)} ms on our side - ${reasons.join('; ')}`);
    }

    // ---- socket: subscriptions and message handling -----------------------

    /** Tracks one socket's subscriptions and per-message handling time. */
    watchApi(api: { onMessage?: () => any; connection?: any } | null) {
        if (!api || this.watched_apis.has(api)) return;
        this.watched_apis.add(api);
        if (this.current_api !== api) this.subs.clear();
        try {
            api.onMessage?.()?.subscribe(({ data }: { data: Record<string, any> }) => this.onMessage(data));
            const socket = api.connection;
            // Added after deriv-api's own onmessage, so it runs last: the time since the
            // event was dispatched is everything our listeners did with this message.
            socket?.addEventListener?.('message', (event: Event) => {
                const handled_ms = now() - event.timeStamp;
                if (handled_ms < 0 || handled_ms > 60000) return;
                const name = this.last_msg_type || 'unknown';
                const section = (this.message_handling[name] ??= { count: 0, total: 0, max: 0 });
                section.count += 1;
                section.total += handled_ms;
                section.max = Math.max(section.max, handled_ms);
            });
            this.current_api = api;
            // Its subscriptions died with it (only the current socket's are listed).
            socket?.addEventListener?.('close', () => {
                if (this.current_api === api) this.subs.clear();
            });
        } catch {
            // Measuring must never break the socket.
        }
    }

    private onMessage(data: Record<string, any>) {
        if (!data) return;
        const msg_type = String(data.msg_type ?? '');
        this.last_msg_type = msg_type;
        const code = data.error?.code;
        if (code === 'AlreadySubscribed') {
            this.counters.already_subscribed += 1;
            this.log(`AlreadySubscribed: ${typeOf(msg_type)} ${keyOf(data)} is already streamed on this socket`);
        } else if (code === 'RateLimit') {
            this.counters.rate_limit += 1;
            this.warn(`RateLimit from Deriv on ${msg_type}`);
        }
        const id = data.subscription?.id;
        if (id) {
            const sub = this.subs.get(id);
            if (sub) sub.msgs += 1;
            else this.subs.set(id, { type: typeOf(msg_type), key: keyOf(data), since: round(now()), msgs: 1 });
        }
        if (msg_type === 'forget' && data.forget === 1 && data.echo_req?.forget) {
            this.subs.delete(String(data.echo_req.forget));
        }
        if (msg_type === 'forget_all' && Array.isArray(data.forget_all)) {
            data.forget_all.forEach((forgotten: string) => this.subs.delete(String(forgotten)));
        }
    }

    /** A request is about to be sent (api-middleware): flags a forget_all of ticks during a run. */
    requestSent(request: Record<string, any> | undefined) {
        const forget_all = request?.forget_all;
        if (!forget_all || !this.busy.size) return;
        const types = Array.isArray(forget_all) ? forget_all : [forget_all];
        if (!types.includes('ticks') && !types.includes('candles')) return;
        this.counters.forget_all_ticks_while_busy += 1;
        const stack = (new Error().stack ?? '').split('\n').slice(2, 7).join(' <- ');
        this.warn(`forget_all ${types.join(',')} sent while a run is busy - it ends EVERY tick stream. From: ${stack}`);
    }

    /** Active subscriptions, grouped by type and key, with duplicates flagged. */
    subscriptions() {
        const groups = new Map<string, { type: string; key: string; count: number; msgs: number }>();
        this.subs.forEach(sub => {
            const name = `${sub.type}|${sub.key}`;
            const group = groups.get(name) ?? { type: sub.type, key: sub.key, count: 0, msgs: 0 };
            group.count += 1;
            group.msgs += sub.msgs;
            groups.set(name, group);
        });
        return [...groups.values()].map(g => ({ ...g, duplicate: g.count > 1 && g.type !== 'proposal' }));
    }

    // ---- page lifecycle -----------------------------------------------------

    private sampleHeap() {
        const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        if (!memory) return;
        const mb = Math.round(memory.usedJSHeapSize / 1048576);
        if (this.heap_first === null) this.heap_first = mb;
        this.heap_last = mb;
    }

    /** Logs a reload that followed a run or an account switch (the cause is otherwise invisible). */
    watchPageLifecycle() {
        if (typeof window === 'undefined') return;
        try {
            const previous = sessionStorage.getItem('ct_perf_unload');
            sessionStorage.removeItem('ct_perf_unload');
            const navigation = performance.getEntriesByType?.('navigation')?.[0] as
                | PerformanceNavigationTiming
                | undefined;
            if (previous && navigation?.type === 'reload') {
                this.warn(`this page was RELOADED. Just before: ${previous}`);
            }
        } catch {
            // Storage unavailable.
        }
        window.addEventListener('pagehide', () => {
            const recent = this.marks.slice(-3).map(m => `${m.name} @${m.at} ms`);
            const busy = this.busy.size ? `busy: ${[...this.busy].join(' + ')}` : 'idle';
            try {
                sessionStorage.setItem('ct_perf_unload', `${busy}; last events: ${recent.join(', ') || 'none'}`);
            } catch {
                // Storage unavailable.
            }
            if (this.busy.size) this.warn('the page is unloading while a run is busy');
        });
    }

    // ---- output -----------------------------------------------------------

    private add(name: TSeriesName, ms: number) {
        if (!this.enabled || !Number.isFinite(ms)) return;
        const list = this.series[name];
        list.push(ms);
        if (list.length > MAX_SAMPLES) list.shift();
    }

    private lastSample(name: TSeriesName) {
        const list = this.series[name];
        return list.length ? list[list.length - 1] : null;
    }

    private lastValueText(name: TSeriesName, label: string) {
        const value = this.lastSample(name);
        return value === null ? '' : `${label}${round(value)} ms`;
    }

    log(message: string) {
        // eslint-disable-next-line no-console
        if (this.enabled) console.log(`${PREFIX} ${message}`);
    }

    warn(message: string) {
        // eslint-disable-next-line no-console
        if (this.enabled) console.warn(`${PREFIX} ${message}`);
    }

    report() {
        const labels: Record<TSeriesName, string> = {
            proposal: 'a) proposal request → response',
            buy: 'b) buy request → Deriv confirmation',
            result_to_buy: 'c) previous result in → next buy sent (total)',
            ours: 'c) … of which OUR side (minus tick/Fast-gap waits)',
            result_handling: 'c) … recording the result (listeners, Journal, Transactions)',
            pre_send: 'c) … work in the buy call before the request leaves',
            tick_to_buy: 'd) tick received → buy sent',
            ping: 'e) keep-alive ping round trip',
        };
        const timings = (Object.keys(labels) as TSeriesName[]).map(name => ({
            measure: labels[name],
            ...summarise(this.series[name]),
        }));
        const busy_tasks = this.long_tasks.filter(t => t.busy);
        const by_reason = new Map<string, { count: number; total: number; max: number }>();
        busy_tasks.forEach(t => {
            const r = by_reason.get(t.reason) ?? { count: 0, total: 0, max: 0 };
            r.count += 1;
            r.total += t.duration;
            r.max = Math.max(r.max, t.duration);
            by_reason.set(t.reason, r);
        });
        const long_tasks = [...by_reason.entries()]
            .map(([reason, r]) => ({ reason, count: r.count, total_ms: r.total, max_ms: r.max }))
            .sort((a, b) => b.total_ms - a.total_ms);
        const sections = Object.entries(this.sections).map(([name, s]) => ({
            section: name,
            count: s.count,
            avg_ms: Math.round((s.total / s.count) * 10) / 10,
            max_ms: round(s.max),
        }));
        const messages = Object.entries(this.message_handling)
            .map(([msg_type, s]) => ({
                msg_type,
                count: s.count,
                avg_ms: Math.round((s.total / s.count) * 10) / 10,
                max_ms: round(s.max),
            }))
            .sort((a, b) => b.avg_ms * b.count - a.avg_ms * a.count);
        const startup = this.loaders.map(l => ({
            loader: l.name,
            shown_at_ms: l.shown_at,
            hidden_at_ms: l.hidden_at,
            visible_ms: l.hidden_at === null ? 'still showing' : l.hidden_at - l.shown_at,
        }));
        const summary = {
            trades: this.trade_no,
            delayed_over_300ms_on_our_side: this.delayed.length,
            delayed: this.delayed.slice(-20),
            timings,
            long_tasks_during_runs: long_tasks,
            sections,
            socket_message_handling: messages,
            subscriptions: this.subscriptions(),
            counters: this.counters,
            loaders: startup,
            gauges: this.gauges,
            heap_mb: { first_trade: this.heap_first, latest: this.heap_last },
            marks: this.marks.slice(-30),
        };
        /* eslint-disable no-console */
        console.log(
            `${PREFIX} ${summary.trades} trades, ${summary.delayed_over_300ms_on_our_side} delayed > ${OUR_DELAY_THRESHOLD_MS} ms on our side`
        );
        console.table(timings);
        if (summary.delayed.length) console.table(summary.delayed.map(d => ({ ...d, reasons: d.reasons.join('; ') })));
        if (long_tasks.length) console.table(long_tasks);
        if (sections.length) console.table(sections);
        if (messages.length) console.table(messages);
        console.table(summary.subscriptions);
        console.table([summary.counters]);
        if (startup.length) console.table(startup);
        console.log(`${PREFIX} gauges`, JSON.stringify(summary.gauges), 'heap MB', JSON.stringify(summary.heap_mb));
        /* eslint-enable no-console */
        return summary;
    }

    /** Forgets everything measured so far (keeps the live subscriptions). */
    reset() {
        (Object.keys(this.series) as TSeriesName[]).forEach(name => {
            this.series[name] = [];
        });
        this.trade_no = 0;
        this.delayed = [];
        this.long_tasks = [];
        this.sections = {};
        this.message_handling = {};
        this.counters = { already_subscribed: 0, rate_limit: 0, forget_all_ticks_while_busy: 0, buy_retries: 0 };
        this.heap_first = null;
        this.heap_last = null;
    }
}

export const ct_perf = new CtPerf();

declare global {
    interface Window {
        __ctPerf?: (() => ReturnType<CtPerf['report']>) & { reset?: () => void };
    }
}

/** Installs window.__ctPerf() and starts the observers. Called once from main.tsx. */
export const installCtPerf = () => {
    if (typeof window === 'undefined') return;
    const report = () => ct_perf.report();
    (report as Window['__ctPerf'] & object).reset = () => ct_perf.reset();
    window.__ctPerf = report;
    ct_perf.observeLongTasks();
    ct_perf.watchPageLifecycle();
};
