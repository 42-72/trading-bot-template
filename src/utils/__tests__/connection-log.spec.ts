import {
    clearLocalStorageKeepingConnLog,
    CONN_LOG_KEY,
    describeSocketURL,
    formatConnLog,
    logConnEvent,
    readConnLog,
} from '../connection-log';
import { applyUrlFlags, isConnDebugEnabled, isSessionV2Enabled, startSessionDiagnostics } from '../session-flags';

describe('connection log', () => {
    beforeEach(() => localStorage.clear());

    it('keeps the last 50 events with timestamps, oldest first', () => {
        for (let i = 1; i <= 55; i++) logConnEvent('event', String(i));
        const entries = readConnLog();
        expect(entries).toHaveLength(50);
        expect(entries[0].d).toBe('6');
        expect(entries[49].d).toBe('55');
        expect(new Date(entries[0].t).toString()).not.toBe('Invalid Date');
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

    it('a full localStorage clear (version check, logout fallback) keeps the log and the switches', () => {
        logConnEvent('page_load');
        localStorage.setItem('ct_session_v2', '1');
        localStorage.setItem('ctdebug', '1');
        localStorage.setItem('active_loginid', 'VRTC1');
        clearLocalStorageKeepingConnLog(['bot_version']);
        expect(readConnLog()).toHaveLength(1);
        expect(isSessionV2Enabled()).toBe(true);
        expect(isConnDebugEnabled()).toBe(true);
        expect(localStorage.getItem('active_loginid')).toBeNull();
    });
});

describe('address-bar switches', () => {
    beforeEach(() => {
        localStorage.clear();
        window.history.replaceState({}, '', '/');
    });

    it('?ct_session_v2=1 turns the flag on, saves it, and removes the parameter', () => {
        window.history.replaceState({}, '', '/?ct_session_v2=1&account_id=VRTC1#x');
        applyUrlFlags();
        expect(isSessionV2Enabled()).toBe(true);
        expect(localStorage.getItem('ct_session_v2')).toBe('1');
        expect(window.location.search).toBe('?account_id=VRTC1');
        expect(window.location.hash).toBe('#x');
    });

    it('?ct_session_v2=0 turns it off', () => {
        localStorage.setItem('ct_session_v2', '1');
        window.history.replaceState({}, '', '/?ct_session_v2=0');
        applyUrlFlags();
        expect(isSessionV2Enabled()).toBe(false);
        expect(window.location.search).toBe('');
    });

    it('?ctdebug=1 / =0 turns the connection log button on / off', () => {
        window.history.replaceState({}, '', '/?ctdebug=1');
        applyUrlFlags();
        expect(isConnDebugEnabled()).toBe(true);
        window.history.replaceState({}, '', '/?ctdebug=0');
        applyUrlFlags();
        expect(isConnDebugEnabled()).toBe(false);
    });

    it('flag off by default - the site behaves as before', () => {
        expect(isSessionV2Enabled()).toBe(false);
    });

    it('logs the page load, whether auth_info existed, and visibility changes - with the flag off', () => {
        sessionStorage.setItem('auth_info', JSON.stringify({ expires_at: Date.now() + 30 * 60000 }));
        startSessionDiagnostics();
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        const [load, hidden] = readConnLog();
        expect(load.e).toBe('page_load');
        expect(load.d).toMatch(/auth_info, expires in 30 min/);
        expect(load.d).toMatch(/ct_session_v2 off/);
        expect(hidden.e).toBe('page_hidden');
        sessionStorage.clear();
    });
});
