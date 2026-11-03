import {
    clearLocalStorageKeepingConnLog,
    CONN_LOG_KEY,
    describeSocketURL,
    formatConnLog,
    logConnEvent,
    readConnLog,
} from '../connection-log';
import { applyUrlFlags, isConnDebugEnabled, startSessionDiagnostics } from '../session-flags';

describe('connection log', () => {
    beforeEach(() => localStorage.clear());

    it('keeps the last 200 events with timestamps, oldest first', () => {
        for (let i = 1; i <= 205; i++) logConnEvent('event', String(i));
        const entries = readConnLog();
        expect(entries).toHaveLength(200);
        expect(entries[0].d).toBe('6');
        expect(entries[199].d).toBe('205');
        expect(new Date(entries[0].t).toString()).not.toBe('Invalid Date');
    });

    it('collapses repeated identical events into one line with a count', () => {
        logConnEvent('reconnect_wait', 'socket closed - waiting until online');
        logConnEvent('reconnect_wait', 'socket closed - waiting until online');
        logConnEvent('reconnect_wait', 'socket closed - waiting until online');
        logConnEvent('online');
        logConnEvent('reconnect_wait', 'socket closed - waiting until online');
        const entries = readConnLog();
        expect(entries.map(entry => [entry.e, entry.n])).toEqual([
            ['reconnect_wait', 3],
            ['online', undefined],
            ['reconnect_wait', undefined],
        ]);
        expect(entries[0].tl).toBeDefined();
        expect(formatConnLog(entries).split('\n')[0]).toMatch(
            /reconnect_wait {2}socket closed - waiting until online {2}\(x3, last .+\)$/
        );
    });

    it('a different detail is a different event', () => {
        logConnEvent('authorized', 'connection 1');
        logConnEvent('authorized', 'connection 2');
        expect(readConnLog()).toHaveLength(2);
    });

    it('never stores an OTP or a token, even if a caller passes one', () => {
        logConnEvent('socket_create', 'wss://x.example/ws?otp=SECRET123&app=1 Bearer abc.def');
        const stored = localStorage.getItem(CONN_LOG_KEY) as string;
        expect(stored).not.toContain('SECRET123');
        expect(stored).not.toContain('abc.def');
    });

    it('describes socket URLs as public or authenticated, without the query', () => {
        expect(describeSocketURL('wss://api.example.com/options/ws/public')).toBe(
            'public api.example.com/options/ws/public'
        );
        const authenticated = describeSocketURL('wss://api.example.com/options/ws?otp=SECRET');
        expect(authenticated).toBe('authenticated api.example.com/options/ws');
        expect(authenticated).not.toContain('SECRET');
    });

    it('formats as plain text for the panel and Copy', () => {
        logConnEvent('socket_open', 'authenticated');
        expect(formatConnLog(readConnLog())).toMatch(/^\d{4}-\d\d-\d\dT.+ {2}socket_open {2}authenticated$/);
    });

    it('a full localStorage clear (version check, logout fallback) keeps the log and the ctdebug switch', () => {
        logConnEvent('page_load');
        localStorage.setItem('ctdebug', '1');
        localStorage.setItem('active_loginid', 'VRTC1');
        clearLocalStorageKeepingConnLog(['bot_version']);
        expect(readConnLog()).toHaveLength(1);
        expect(isConnDebugEnabled()).toBe(true);
        expect(localStorage.getItem('active_loginid')).toBeNull();
    });
});

describe('address-bar switch', () => {
    beforeEach(() => {
        localStorage.clear();
        window.history.replaceState({}, '', '/');
    });

    it('?ctdebug=1 / =0 turns the connection log button on / off and removes the parameter', () => {
        window.history.replaceState({}, '', '/?ctdebug=1&account_id=VRTC1#x');
        applyUrlFlags();
        expect(isConnDebugEnabled()).toBe(true);
        expect(window.location.search).toBe('?account_id=VRTC1');
        expect(window.location.hash).toBe('#x');
        window.history.replaceState({}, '', '/?ctdebug=0');
        applyUrlFlags();
        expect(isConnDebugEnabled()).toBe(false);
        expect(window.location.search).toBe('');
    });

    it('the retired ct_session_v2 switch is removed from storage and from the address bar', () => {
        localStorage.setItem('ct_session_v2', '1');
        window.history.replaceState({}, '', '/?ct_session_v2=1&ctdebug=1');
        applyUrlFlags();
        expect(localStorage.getItem('ct_session_v2')).toBeNull();
        expect(window.location.search).toBe('');
        expect(isConnDebugEnabled()).toBe(true);
    });

    it('a plain URL changes nothing', () => {
        const replace = jest.spyOn(window.history, 'replaceState');
        applyUrlFlags();
        expect(replace).not.toHaveBeenCalled();
        replace.mockRestore();
    });

    it('logs the page load, whether auth_info existed, and visibility changes', () => {
        sessionStorage.setItem('auth_info', JSON.stringify({ expires_at: Date.now() + 30 * 60000 }));
        startSessionDiagnostics();
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        const [load, hidden] = readConnLog();
        expect(load.e).toBe('page_load');
        expect(load.d).toMatch(/auth_info, expires in 30 min/);
        expect(load.d).not.toMatch(/ct_session_v2/);
        expect(hidden.e).toBe('page_hidden');
        sessionStorage.clear();
    });
});
