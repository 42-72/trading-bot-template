import { action, makeObservable, observable } from 'mobx';

export type TSessionNotice = 'connection_lost' | 'session_expired' | null;

const IDLE_LOGGED_OUT_KEY = 'ct_idle_logged_out';

const readIdleLoggedOut = () => {
    try {
        return sessionStorage.getItem(IDLE_LOGGED_OUT_KEY) === '1';
    } catch {
        return false;
    }
};

/**
 * What the session notice (components/session-notice) shows. Only ever set
 * by the session handling in api-base.ts.
 *   is_reconnecting - a logged-in user's socket is down and being retried.
 *   notice          - connection_lost: a running bot / AI Scanner was stopped.
 *                     session_expired: persistent until the trader logs in.
 *   is_idle_logged_out - this tab was logged out for being away (utils/idle-logout.ts):
 *                     it stays on its page, not the landing page, until the next login.
 */
class SessionStatus {
    is_reconnecting = false;
    notice: TSessionNotice = null;
    is_idle_logged_out = readIdleLoggedOut();

    constructor() {
        makeObservable(this, {
            is_reconnecting: observable,
            notice: observable,
            is_idle_logged_out: observable,
            setReconnecting: action,
            setIdleLoggedOut: action,
            setNotice: action,
            dismissNotice: action,
        });
    }

    setReconnecting = (is_reconnecting: boolean) => {
        this.is_reconnecting = is_reconnecting;
    };

    /** Kept in sessionStorage too: a reload must not bring the landing page back. */
    setIdleLoggedOut = (is_idle_logged_out: boolean) => {
        this.is_idle_logged_out = is_idle_logged_out;
        try {
            if (is_idle_logged_out) sessionStorage.setItem(IDLE_LOGGED_OUT_KEY, '1');
            else sessionStorage.removeItem(IDLE_LOGGED_OUT_KEY);
        } catch {
            // Blocked storage: this page still knows.
        }
    };

    setNotice = (notice: TSessionNotice) => {
        // "Session expired" is never replaced by a lesser notice.
        if (this.notice === 'session_expired' && notice !== null) return;
        this.notice = notice;
    };

    /** Only "Connection lost" can be dismissed; "Session expired" stays until login. */
    dismissNotice = () => {
        if (this.notice === 'connection_lost') this.notice = null;
    };
}

export const session_status = new SessionStatus();

/** The access token was refused (401 on the OTP / accounts request) or has passed expires_at. */
export class SessionExpiredError extends Error {
    reason: string;

    constructor(reason: string) {
        super(`Session expired: ${reason}`);
        this.name = 'SessionExpiredError';
        this.reason = reason;
    }
}
