import { logConnEvent } from './connection-log';

/**
 * The connection log's switch, settable from the address bar so it works on
 * a phone:
 *   ?ctdebug=1 / =0  - shows / hides the "Connection log" button.
 * The parameter is saved in localStorage and removed from the address bar.
 *
 * ct_session_v2 (the old switch for the session handling, now always on) is
 * removed from storage and from the address bar if it is still there.
 */
export const CONN_DEBUG_KEY = 'ctdebug';
const RETIRED_KEYS = ['ct_session_v2'];

export const isConnDebugEnabled = () => {
    try {
        return localStorage.getItem(CONN_DEBUG_KEY) === '1';
    } catch {
        return false;
    }
};

/** Reads ?ctdebug=, saves it and strips it (and retired switches) from the URL. Call once at start-up. */
export const applyUrlFlags = () => {
    try {
        RETIRED_KEYS.forEach(key => localStorage.removeItem(key));
        const url = new URL(window.location.href);
        let changed = false;
        RETIRED_KEYS.forEach(key => {
            if (!url.searchParams.has(key)) return;
            url.searchParams.delete(key);
            changed = true;
        });
        const value = url.searchParams.get(CONN_DEBUG_KEY);
        if (value !== null) {
            changed = true;
            url.searchParams.delete(CONN_DEBUG_KEY);
            if (value === '1') localStorage.setItem(CONN_DEBUG_KEY, '1');
            else if (value === '0') localStorage.removeItem(CONN_DEBUG_KEY);
            if (value === '1' || value === '0') logConnEvent('flag', `${CONN_DEBUG_KEY}=${value}`);
        }
        if (changed) window.history.replaceState(window.history.state, document.title, url.toString());
    } catch {
        // A blocked localStorage just leaves the switch off.
    }
};

const describeStoredAuth = () => {
    try {
        const raw = sessionStorage.getItem('auth_info');
        if (!raw) return 'no auth_info';
        const { expires_at } = JSON.parse(raw) as { expires_at?: number };
        if (!expires_at) return 'auth_info (no expires_at)';
        const minutes = Math.round((expires_at - Date.now()) / 60000);
        return minutes > 0 ? `auth_info, expires in ${minutes} min` : `auth_info EXPIRED ${-minutes} min ago`;
    } catch {
        return 'auth_info unreadable';
    }
};

/** Chrome may load a page typed in the address bar before Enter is pressed (prerendering). */
export const isPrerendering = () =>
    typeof document !== 'undefined' && !!(document as Document & { prerendering?: boolean }).prerendering;

/**
 * Resolves once the page is really shown to the trader. A prerendered page
 * runs without the tab's sessionStorage (so without its login): the app must
 * not open its socket or decide who is logged in until then.
 */
export const whenPageActivated = (): Promise<void> =>
    new Promise(resolve => {
        if (!isPrerendering()) {
            resolve();
            return;
        }
        document.addEventListener(
            'prerenderingchange',
            () => {
                logConnEvent(
                    'page_activated',
                    `prerendered page shown; ${describeStoredAuth()}; active_loginid ${
                        localStorage.getItem('active_loginid') ? 'set' : 'none'
                    }`
                );
                resolve();
            },
            { once: true }
        );
    });

let are_page_events_watched = false;

/**
 * Start-up (main.tsx): apply the URL switch, log the page load and keep
 * logging visibility and online/offline.
 */
export const startSessionDiagnostics = () => {
    applyUrlFlags();
    logConnEvent(
        'page_load',
        `${describeStoredAuth()}; active_loginid ${localStorage.getItem('active_loginid') ? 'set' : 'none'}${
            isPrerendering() ? '; prerendering - start-up waits until shown' : ''
        }`
    );
    if (are_page_events_watched) return;
    are_page_events_watched = true;
    document.addEventListener('visibilitychange', () => logConnEvent(`page_${document.visibilityState}`));
    window.addEventListener('online', () => logConnEvent('online'));
    window.addEventListener('offline', () => logConnEvent('offline'));
    window.addEventListener('pageshow', event => {
        if ((event as PageTransitionEvent).persisted) logConnEvent('page_restored', 'from back/forward cache');
    });
};
