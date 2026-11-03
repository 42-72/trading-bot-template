/**
 * Hidden connection log for phones: the last 200 connection / auth events,
 * with timestamps, kept in localStorage under ct_conn_log so it survives a
 * logout, a reload, a closed tab and a version reset. The "Connection log"
 * button that shows it appears only when ctdebug is on (session-flags.ts).
 *
 * An event identical to the one before it (same name and detail) is not
 * added again: that line's count goes up and its last time is updated.
 *
 * Never pass a token, an OTP or a full socket URL in `detail`: use
 * describeSocketURL() for URLs.
 */
export const CONN_LOG_KEY = 'ct_conn_log';
export const CONN_LOG_MAX_ENTRIES = 200;

export type TConnLogEntry = {
    /** ISO time */
    t: string;
    /** Event name, e.g. socket_open, logout */
    e: string;
    /** Short, credential-free detail */
    d?: string;
    /** How many times in a row this exact event happened (absent = once) */
    n?: number;
    /** ISO time of the last repeat (only when n > 1) */
    tl?: string;
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
        const now = new Date().toISOString();
        const entry: TConnLogEntry = { t: now, e: event };
        if (detail) entry.d = scrub(detail);
        const previous_entries = readConnLog();
        const last = previous_entries[previous_entries.length - 1];
        let entries: TConnLogEntry[];
        if (last && last.e === entry.e && (last.d ?? '') === (entry.d ?? '')) {
            entries = [...previous_entries.slice(0, -1), { ...last, n: (last.n ?? 1) + 1, tl: now }];
        } else {
            entries = [...previous_entries, entry].slice(-CONN_LOG_MAX_ENTRIES);
        }
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
    entries
        .map(({ t, e, d, n, tl }) => `${t}  ${e}${d ? `  ${d}` : ''}${n && n > 1 ? `  (x${n}, last ${tl})` : ''}`)
        .join('\n');

/** localStorage.clear() that keeps the log (and the ctdebug switch). */
export const clearLocalStorageKeepingConnLog = (keep_keys: string[] = []) => {
    const kept = [CONN_LOG_KEY, 'ctdebug', ...keep_keys]
        .map(key => [key, localStorage.getItem(key)] as const)
        .filter(([, value]) => value !== null);
    localStorage.clear();
    kept.forEach(([key, value]) => localStorage.setItem(key, value as string));
};
