import { action, makeObservable, observable } from 'mobx';

export type TSessionNotice = 'connection_lost' | 'session_expired' | null;

const IDLE_LOGGED_OUT_KEY = 'ct_idle_logged_out';
const SAME_PAGE = '1';
const FRESH_START = 'fresh_start';

const readIdleLogout = () => {
    try {
        return sessionStorage.getItem(IDLE_LOGGED_OUT_KEY);
    } catch {
        return null;
    }
};

/**
 * What the session notice (components/session-notice) shows. Only ever set
 * by the session handling in api-base.ts.
 *   is_reconnecting - a logged-in user's socket is down and being retried.
 *   notice          - connection_lost: a running bot / AI Scanner was stopped.
 *                     session_expired: persistent until the trader logs in.
 *   is_idle_logged_out - this tab was logged out for being away (utils/idle-logout.ts):
 *                     only the trader's own press logs in again.
 *   is_fresh_start  - and it is a new visit, not a page left open: the landing page shows
 *                     as for any logged-out visitor. Without this the tab stays on its page.
 *   is_landing_shown - the landing page is on screen: the visitor isn't in the app yet,
 *                     so the app's own loaders keep out of sight.
 */
class SessionStatus {
    is_reconnecting = false;
    notice: TSessionNotice = null;
    is_idle_logged_out = [SAME_PAGE, FRESH_START].includes(readIdleLogout() ?? '');
    is_fresh_start = readIdleLogout() === FRESH_START;
    is_landing_shown = false;

    constructor() {
        makeObservable(this, {
            is_reconnecting: observable,
            notice: observable,
            is_idle_logged_out: observable,
            is_fresh_start: observable,
            is_landing_shown: observable,
            setReconnecting: action,
            setLandingShown: action,
            setIdleLoggedOut: action,
            setNotice: action,
            dismissNotice: action,
        });
    }

    setReconnecting = (is_reconnecting: boolean) => {
        this.is_reconnecting = is_reconnecting;
    };

    setLandingShown = (is_landing_shown: boolean) => {
        this.is_landing_shown = is_landing_shown;
    };

    /** Kept in sessionStorage too: a reload must not change what this tab shows. */
    setIdleLoggedOut = (is_idle_logged_out: boolean, is_fresh_start = false) => {
        this.is_idle_logged_out = is_idle_logged_out;
        this.is_fresh_start = is_idle_logged_out && is_fresh_start;
        try {
            if (is_idle_logged_out)
                sessionStorage.setItem(IDLE_LOGGED_OUT_KEY, is_fresh_start ? FRESH_START : SAME_PAGE);
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
