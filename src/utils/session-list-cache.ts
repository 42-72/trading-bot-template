import { getStoredItemsByKey } from './session-storage';

type TOptions = {
    /** sessionStorage key: an object of per-account lists. */
    storage_key: string;
    /** Newest items kept per account. */
    max_items: number;
    /** Wait this long after the latest change before writing (more changes in between: one write). */
    delay_ms?: number;
};

type TIdleWindow = Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
};

/**
 * A per-account list kept in sessionStorage (e.g. the Journal), written OFF
 * the trade path: never inside the change that caused it, at most once per
 * `delay_ms`, in the browser's idle time, as plain JSON (a few ms - the old
 * LZString write of the whole list took ~140 ms at 1,000 Journal lines and
 * ~640 ms at 5,000, on every line). Written at once when the page is hidden
 * or left, so a reload still finds it. Reads the old compressed format too.
 */
export class SessionListCache<T> {
    private stored: Record<string, T[]> | null = null;
    private pending = new Map<string, T[]>();
    private timer: ReturnType<typeof setTimeout> | null = null;
    private readonly delay_ms: number;

    constructor(private readonly options: TOptions) {
        this.delay_ms = options.delay_ms ?? 2000;
        if (typeof window !== 'undefined') {
            window.addEventListener('pagehide', this.flush);
            document.addEventListener('visibilitychange', this.onVisibilityChange);
        }
    }

    /** The stored list for an account (read once per page, then from memory; pending writes included). */
    read(loginid?: string): T[] | undefined {
        if (!loginid) return undefined;
        this.flush();
        return this.load()[loginid];
    }

    /** Remembers the account's latest list; it is written a little later. */
    write(loginid: string | undefined, items: T[] | undefined) {
        if (!loginid) return;
        this.pending.set(loginid, items ?? []);
        if (this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            const idle_window = typeof window !== 'undefined' ? (window as TIdleWindow) : undefined;
            if (idle_window?.requestIdleCallback) idle_window.requestIdleCallback(this.flush, { timeout: 1000 });
            else this.flush();
        }, this.delay_ms);
    }

    /** Writes everything pending now. */
    flush = () => {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (!this.pending.size) return;
        const stored = this.load();
        this.pending.forEach((items, loginid) => {
            stored[loginid] = items.slice(0, this.options.max_items);
        });
        this.pending.clear();
        this.save(stored);
    };

    private onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') this.flush();
    };

    private load() {
        if (!this.stored) this.stored = getStoredItemsByKey(this.options.storage_key, {}) ?? {};
        return this.stored as Record<string, T[]>;
    }

    /** Plain JSON; over the storage quota, the oldest halves are dropped until it fits. */
    private save(stored: Record<string, T[]>) {
        for (let attempt = 0; attempt < 6; attempt++) {
            try {
                sessionStorage.setItem(this.options.storage_key, JSON.stringify(stored));
                return;
            } catch {
                Object.keys(stored).forEach(loginid => {
                    stored[loginid] = stored[loginid].slice(0, Math.floor(stored[loginid].length / 2));
                });
            }
        }
    }
}
