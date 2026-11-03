/**
 * Keep-alive for the app's socket (api_base starts it once a
 * socket is logged in).
 *
 * Deriv closes a socket that sends nothing for a while. The only regular
 * request used to be chart-api's 30 s `time` call, run by a main-thread
 * setInterval - which Chrome throttles in a hidden tab (and, on a laptop
 * with Energy Saver, sooner and harder), so a hidden tab could go quiet long
 * enough to be closed.
 *
 * - The beat comes from a dedicated Worker: worker timers are not throttled
 *   like a hidden page's. Without Worker support it falls back to setInterval.
 * - A ping is also sent the moment the page is hidden.
 * - While a bot or the AI Scanner is busy, a Web Lock is held: Chrome does not
 *   freeze a page that holds one, so its timers and socket keep running.
 */
export const KEEP_ALIVE_INTERVAL_MS = 20000;
const RUN_LOCK_NAME = 'ct-bot-running';

type TTimer = { stop: () => void };

const startWorkerTimer = (interval_ms: number, on_beat: () => void): TTimer | null => {
    try {
        if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function')
            return null;
        const source = `setInterval(function () { postMessage(0); }, ${interval_ms});`;
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const worker = new Worker(url);
        worker.onmessage = () => on_beat();
        return {
            stop: () => {
                worker.terminate();
                URL.revokeObjectURL(url);
            },
        };
    } catch {
        return null;
    }
};

const startIntervalTimer = (interval_ms: number, on_beat: () => void): TTimer => {
    const id = setInterval(on_beat, interval_ms);
    return { stop: () => clearInterval(id) };
};

class SocketKeepAlive {
    private timer: TTimer | null = null;
    private ping: (() => void) | null = null;
    private busy = new Set<string>();
    private release_lock: (() => void) | null = null;
    private is_page_listener_on = false;

    get is_running() {
        return !!this.timer;
    }

    get is_lock_held() {
        return !!this.release_lock;
    }

    /** Starts (or keeps) the beat; `ping` sends one keep-alive request on the current socket. */
    start(ping: () => void) {
        this.ping = ping;
        this.watchPage();
        if (this.timer) return;
        this.timer =
            startWorkerTimer(KEEP_ALIVE_INTERVAL_MS, this.beat) ??
            startIntervalTimer(KEEP_ALIVE_INTERVAL_MS, this.beat);
    }

    stop() {
        this.timer?.stop();
        this.timer = null;
        this.ping = null;
    }

    beat = () => {
        this.ping?.();
    };

    /** A bot (`bot`) or the AI Scanner (`ai_scanner`) is busy or not: the lock is held while any is. */
    setBusy(reason: string, is_busy: boolean) {
        if (is_busy) this.busy.add(reason);
        else this.busy.delete(reason);
        if (this.busy.size > 0) this.holdLock();
        else this.releaseLock();
    }

    private holdLock() {
        if (this.release_lock) return;
        const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
        if (!locks?.request) return;
        let release: () => void = () => {};
        const held = new Promise<void>(resolve => {
            release = resolve;
        });
        this.release_lock = release;
        locks
            .request(RUN_LOCK_NAME, { mode: 'shared' }, () => held)
            .catch(() => {
                if (this.release_lock === release) this.release_lock = null;
            });
    }

    private releaseLock() {
        this.release_lock?.();
        this.release_lock = null;
    }

    private onVisibilityChange = () => {
        if (document.visibilityState === 'hidden' && this.timer) this.ping?.();
    };

    private watchPage() {
        if (this.is_page_listener_on || typeof document === 'undefined') return;
        this.is_page_listener_on = true;
        document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
}

export const keep_alive = new SocketKeepAlive();
