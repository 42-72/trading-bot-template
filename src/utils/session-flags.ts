import { logConnEvent } from './connection-log';

/**
 * Two per-browser switches, both settable from the address bar so they work
 * on a phone:
 *   ?ct_session_v2=1 / =0  - the new session handling (reconnect instead of
 *                            logging out). Off = the site behaves as before.
 *   ?ctdebug=1 / =0        - shows the "Connection log" button.
 * The parameter is saved in localStorage and removed from the address bar.
 */
export const SESSION_V2_KEY = 'ct_session_v2';
export const CONN_DEBUG_KEY = 'ctdebug';

const readFlag = (key: string) => {
    try {
        return localStorage.getItem(key) === '1';
    } catch {
        return false;
    }
};

export const isSessionV2Enabled = () => readFlag(SESSION_V2_KEY);
export const isConnDebugEnabled = () => readFlag(CONN_DEBUG_KEY);

/** Reads ?ct_session_v2= and ?ctdebug=, saves them and strips them from the URL. Call once at start-up. */
export const applyUrlFlags = () => {
    try {
        const url = new URL(window.location.href);
        let changed = false;
        [SESSION_V2_KEY, CONN_DEBUG_KEY].forEach(key => {
            const value = url.searchParams.get(key);
            if (value === null) return;
            changed = true;
            url.searchParams.delete(key);
            if (value === '1') localStorage.setItem(key, '1');
            else if (value === '0') localStorage.removeItem(key);
            else return;
            logConnEvent('flag', `${key}=${value}`);
        });
        if (changed) window.history.replaceState(window.history.state, document.title, url.toString());
    } catch {
        // A blocked localStorage just leaves both switches off.
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

let are_page_events_watched = false;

/**
 * Start-up (main.tsx): apply the URL switches, log the page load and keep
 * logging visibility and online/offline. Runs with ct_session_v2 on or off.
 */
export const startSessionDiagnostics = () => {
    applyUrlFlags();
    logConnEvent(
        'page_load',
        `${describeStoredAuth()}; active_loginid ${localStorage.getItem('active_loginid') ? 'set' : 'none'}; ct_session_v2 ${isSessionV2Enabled() ? 'ON' : 'off'}`
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
