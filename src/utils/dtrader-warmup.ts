import { DTRADER_EMBED_URL, DTRADER_ORIGIN } from '@/utils/dtrader-embed';

/**
 * Quietly puts DTrader's start-up files (the JS / CSS its page lists) into the
 * browser cache while the site is idle, so the FIRST open of the DTrader tab
 * doesn't have to download them. Later opens are fast anyway (DTrader's
 * service worker and the browser cache).
 *
 * Gentle on purpose:
 * - starts only well after start-up, when the browser is idle;
 * - never while a bot or the AI Scanner is running: checked before every
 *   file, and a run that starts mid-way stops it (at most the one file
 *   already on its way finishes); it resumes once the run has ended;
 * - one file at a time, as low-priority prefetches;
 * - skipped on Data Saver / 2G, and once DTrader has been opened (the frame
 *   loads the files itself), and once done in this browser tab session;
 * - on a phone (under 768px wide), only on Wi-Fi or another unmetered
 *   connection: the trader's data is not spent on a tab they may never open.
 *   Checked before every file too, so leaving Wi-Fi stops it. If the browser
 *   can't tell (iPhones and Firefox never can), it counts as mobile data.
 *
 * Nothing runs: the files are only downloaded. Only DTrader's own HTML is
 * read (it allows any origin), to learn the current hashed file names.
 */

export const WARMUP_START_DELAY_MS = 20000;
const WARMUP_DONE_KEY = 'ct_dtrader_warmed';
const FILE_TIMEOUT_MS = 20000;
const RETRY_AFTER_BUSY_MS = 30000;

type TWarmupOptions = {
    /** A bot or the AI Scanner is running - don't download anything now. */
    isBusy: () => boolean;
    /** DTrader's frame has been opened - it loads its files itself. */
    isOpened: () => boolean;
};

type TConnection = { saveData?: boolean; effectiveType?: string; type?: string };

const PHONE_MAX_WIDTH = 767;
const UNMETERED_CONNECTIONS = ['wifi', 'ethernet'];

const isConstrainedNetwork = () => {
    const connection = (navigator as Navigator & { connection?: TConnection }).connection;
    if (window.innerWidth <= PHONE_MAX_WIDTH && !UNMETERED_CONNECTIONS.includes(connection?.type ?? '')) return true;
    if (!connection) return false;
    return !!connection.saveData || ['slow-2g', '2g'].includes(connection.effectiveType ?? '');
};

const wasWarmedThisSession = () => {
    try {
        return sessionStorage.getItem(WARMUP_DONE_KEY) === '1';
    } catch {
        return false;
    }
};

const markWarmed = () => {
    try {
        sessionStorage.setItem(WARMUP_DONE_KEY, '1');
    } catch {
        // storage blocked - it just runs again next load (cache hits, cheap)
    }
};

/**
 * The JS / CSS files DTrader's page lists (scripts, stylesheets, preload /
 * prefetch hints), as absolute URLs on its origin.
 */
export const getDTraderStartupFiles = (html: string): string[] => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const urls = new Set<string>();
    const add = (value: string | null) => {
        if (!value) return;
        try {
            const url = new URL(value, DTRADER_ORIGIN);
            if (
                url.origin === DTRADER_ORIGIN &&
                /^\/((trader|reports)\/)?(js|css)\/[^?#]+\.(js|css)$/.test(url.pathname)
            ) {
                urls.add(url.toString());
            }
        } catch {
            // not a URL - ignore
        }
    };
    doc.querySelectorAll('script[src]').forEach(el => add(el.getAttribute('src')));
    // preload / prefetch too: lazy chunks DTrader may list there are picked up as well
    doc.querySelectorAll(
        'link[rel~="stylesheet"][href], link[rel~="preload"][href], link[rel~="prefetch"][href], link[rel~="modulepreload"][href]'
    ).forEach(el => add(el.getAttribute('href')));
    return [...urls];
};

const prefetch = (url: string) =>
    new Promise<void>(resolve => {
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = url;
        const done = () => {
            clearTimeout(timer);
            link.remove();
            resolve();
        };
        const timer = setTimeout(done, FILE_TIMEOUT_MS);
        link.onload = done;
        link.onerror = done;
        document.head.appendChild(link);
    });

const whenIdle = (callback: () => void) => {
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
        .requestIdleCallback;
    if (typeof ric === 'function') ric(callback, { timeout: 5000 });
    else setTimeout(callback, 0);
};

/**
 * Schedules the warm-up; returns a function that cancels it. Call once the app
 * has started (not during start-up).
 */
export const scheduleDTraderWarmup = ({ isBusy, isOpened }: TWarmupOptions) => {
    let is_cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const shouldSkip = () => is_cancelled || isOpened() || wasWarmedThisSession() || isConstrainedNetwork();

    const later = (ms: number) => {
        clearTimeout(timer);
        timer = setTimeout(() => whenIdle(run), ms);
    };

    const run = async () => {
        if (shouldSkip()) return;
        if (isBusy()) {
            later(RETRY_AFTER_BUSY_MS);
            return;
        }

        let files: string[];
        try {
            const response = await fetch(DTRADER_EMBED_URL, { credentials: 'omit' });
            if (!response.ok) return;
            files = getDTraderStartupFiles(await response.text());
        } catch {
            return; // offline / blocked - the tab still loads normally when opened
        }

        for (const url of files) {
            if (shouldSkip()) return;
            if (isBusy()) {
                later(RETRY_AFTER_BUSY_MS);
                return;
            }
            await prefetch(url); // eslint-disable-line no-await-in-loop
        }
        if (!is_cancelled && files.length) markWarmed();
    };

    later(WARMUP_START_DELAY_MS);

    return () => {
        is_cancelled = true;
        clearTimeout(timer);
    };
};
