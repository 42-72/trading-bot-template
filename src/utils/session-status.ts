import { action, makeObservable, observable } from 'mobx';

export type TSessionNotice = 'connection_lost' | 'session_expired' | null;

/**
 * What the session notice (components/session-notice) shows. Only ever set
 * with ct_session_v2 on.
 *   is_reconnecting - a logged-in user's socket is down and being retried.
 *   notice          - connection_lost: a running bot / AI Scanner was stopped.
 *                     session_expired: persistent until the trader logs in.
 */
class SessionStatus {
    is_reconnecting = false;
    notice: TSessionNotice = null;

    constructor() {
        makeObservable(this, {
            is_reconnecting: observable,
            notice: observable,
            setReconnecting: action,
            setNotice: action,
            dismissNotice: action,
        });
    }

    setReconnecting = (is_reconnecting: boolean) => {
        this.is_reconnecting = is_reconnecting;
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
