/**
 * Hidden connection log for phones: the last 50 connection / auth events,
 * with timestamps, kept in localStorage under ct_conn_log so it survives a
 * logout, a reload and a closed tab. Recorded whether or not ct_session_v2
 * is on, so the old behaviour can be captured too. The "Connection log"
 * button that shows it appears only when ctdebug is on (session-flags.ts).
 *
 * Never pass a token, an OTP or a full socket URL in `detail`: use
 * describeSocketURL() for URLs.
 */
export const CONN_LOG_KEY = 'ct_conn_log';
export const CONN_LOG_MAX_ENTRIES = 50;

export type TConnLogEntry = {
    /** ISO time */
    t: string;
    /** Event name, e.g. socket_open, logout */
    e: string;
    /** Short, credential-free detail */
    d?: string;
};

type TListener = (entries: TConnLogEntry[]) => void;
const listeners = new Set<TListener>();

// Anything that looks like a credential is masked, in case a caller slips.
const scrub = (text: string) =>
    text.replace(/([?&](otp|token|access_token|code)=)[^&#\s]*/gi, '$1***').replace(/(Bearer\s+)\S+/gi, '$1***');

export const readConnLog = (): TConnLogEntry[] => {
    try {
        const raw = localStorage.getItem(CONN_LOG_KEY);
        const entries = raw ? JSON.parse(raw) : [];
        return Array.isArray(entries) ? entries : [];
    } catch {
        return [];
    }
};

export const logConnEvent = (event: string, detail?: string) => {
    try {
        const entry: TConnLogEntry = { t: new Date().toISOString(), e: event };
        if (detail) entry.d = scrub(detail);
        const entries = [...readConnLog(), entry].slice(-CONN_LOG_MAX_ENTRIES);
        localStorage.setItem(CONN_LOG_KEY, JSON.stringify(entries));
        listeners.forEach(listener => listener(entries));
    } catch {
        // Storage full or blocked: the log is best effort.
    }
};

export const clearConnLog = () => {
    try {
        localStorage.removeItem(CONN_LOG_KEY);
    } catch {
        // Best effort.
    }
    listeners.forEach(listener => listener([]));
};

export const subscribeConnLog = (listener: TListener) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

/** "authenticated host/path" or "public host/path" - never the query (it holds the OTP). */
export const describeSocketURL = (url: string) => {
    const kind = isAuthenticatedSocketURL(url) ? 'authenticated' : 'public';
    try {
        const { host, pathname } = new URL(url);
        return `${kind} ${host}${pathname}`;
    } catch {
        return kind;
    }
};

export const isAuthenticatedSocketURL = (url: string) => /[?&]otp=/i.test(String(url));

/** The log as plain text, oldest first - what the panel shows and Copy copies. */
export const formatConnLog = (entries: TConnLogEntry[]) =>
    entries.map(({ t, e, d }) => `${t}  ${e}${d ? `  ${d}` : ''}`).join('\n');

/** localStorage.clear() that keeps the log (and the ct_session_v2 / ctdebug switches). */
export const clearLocalStorageKeepingConnLog = (keep_keys: string[] = []) => {
    const kept = [CONN_LOG_KEY, 'ct_session_v2', 'ctdebug', ...keep_keys]
        .map(key => [key, localStorage.getItem(key)] as const)
        .filter(([, value]) => value !== null);
    localStorage.clear();
    kept.forEach(([key, value]) => localStorage.setItem(key, value as string));
};
