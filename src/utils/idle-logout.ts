import { reaction } from 'mobx';
import { ErrorLogger } from './error-logger';
import { isOAuthCallbackURL } from './oauth-start';
import { session_status } from './session-status';
import { startLog } from './start-log';

/**
 * Inactivity logout.
 *
 *   Tab closed:  back within IDLE_LOGOUT_MINUTES.tab_closed - nothing changes.
 *   Tab hidden:  back within IDLE_LOGOUT_MINUTES.tab_hidden - nothing changes.
 *   Later than that: logged out (client.logout, as the Log out button), on the
 *   same page. The landing page stays away (session_status.is_idle_logged_out)
 *   and nothing logs back in by itself.
 *   On screen, or a bot / the AI Scanner running: the minutes don't count.
 *
 * Phones freeze background pages, so nothing here waits on a timer. Timestamps
 * are written, and compared on page load and on page show / visible / focus.
 * The beat only records that the site is on screen or running; it is what lets
 * every other tab see that, because the timestamp is shared.
 *
 * Login stays per tab (sessionStorage). A tab with no login of its own has
 * nothing to log out and only keeps the trader on their page.
 */

/** Change the limits here. */
export const IDLE_LOGOUT_MINUTES = { tab_closed: 5, tab_hidden: 10 };

const TAB_CLOSED_LIMIT_MS = IDLE_LOGOUT_MINUTES.tab_closed * 60000;
const TAB_HIDDEN_LIMIT_MS = IDLE_LOGOUT_MINUTES.tab_hidden * 60000;

/** Far below both limits, even for a hidden tab throttled to one beat a minute. */
export const LAST_SEEN_BEAT_MS = 15000;

/** localStorage, shared by all tabs: when the site was last on screen or running. */
export const LAST_SEEN_KEY = 'ct_idle_last_seen';
/** localStorage: when a tab was logged out for being away, so older logins in other tabs follow. */
export const LOGGED_OUT_AT_KEY = 'ct_idle_logged_out_at';
/** sessionStorage, this tab only (it survives reopening a closed tab): when the page went away. */
export const CLOSED_AT_KEY = 'ct_idle_closed_at';

type TIdleLogoutDeps = {
    isBusy: () => boolean;
    logout: () => Promise<void>;
    onLoggedOut: () => void;
    /** A new tab has no page in its URL: back to the one the trader was on. */
    restorePage: () => void;
};

type TAwayTimes = {
    now: number;
    last_seen: number | null;
    closed_at: number | null;
    login_at: number;
};

/** Exactly on a limit is still in time: the rules say "more than". */
export const isAwayTooLong = ({ now, last_seen, closed_at, login_at }: TAwayTimes) => {
    if (last_seen === null) return false; // nothing recorded yet, e.g. the first visit with this feature
    const seen = Math.max(last_seen, login_at);
    if (now - seen > TAB_HIDDEN_LIMIT_MS) return true;
    return closed_at !== null && now - Math.max(closed_at, seen) > TAB_CLOSED_LIMIT_MS;
};

const readTime = (storage: Storage, key: string) => {
    try {
        const time = Number(storage.getItem(key));
        return time > 0 ? time : null;
    } catch {
        return null;
    }
};

const writeTime = (storage: Storage, key: string, time: number) => {
    try {
        storage.setItem(key, String(time));
    } catch {
        // Blocked or full storage: the next write tries again.
    }
};

/** When this tab logged in, or null without a login. Read raw: getAuthInfo deletes an expired one. */
const readLoginTime = () => {
    try {
        const auth_info = sessionStorage.getItem('auth_info');
        if (!auth_info) return null;
        const { expires_at, expires_in } = JSON.parse(auth_info);
        const login_at = expires_at - expires_in * 1000;
        return Number.isFinite(login_at) ? login_at : 0;
    } catch {
        return 0;
    }
};

const hadLogin = () => {
    try {
        return !!localStorage.getItem('active_loginid');
    } catch {
        return false;
    }
};

/** A focused page counts as on screen: Windows can report a covered window as hidden (see api-base.ts). */
const isOnScreen = () => document.visibilityState === 'visible' || document.hasFocus();

class IdleLogout {
    private deps: TIdleLogoutDeps | null = null;
    private is_logging_out = false;
    private logged_out: Promise<void> = Promise.resolve();
    private beat: ReturnType<typeof setInterval> | null = null;
    private disposeBusyWatch: (() => void) | null = null;

    /**
     * Page start, after the page is really shown (a prerendered page can't see
     * the tab's login) and before the socket opens: resolves once a logout that
     * was due has finished, so the page starts on the public socket.
     */
    start(deps: TIdleLogoutDeps) {
        if (this.deps) return this.logged_out;
        this.deps = deps;

        window.addEventListener('pageshow', this.onPageBack);
        window.addEventListener('focus', this.onPageBack);
        window.addEventListener('pagehide', this.onPageHide);
        document.addEventListener('visibilitychange', this.onVisibilityChange);
        this.beat = setInterval(this.onBeat, LAST_SEEN_BEAT_MS);
        // Counting starts the moment a run stops, however it stopped.
        this.disposeBusyWatch = reaction(deps.isBusy, this.stampLastSeen);

        // A login return: the exchange is logging in, whatever the old times say.
        if (isOAuthCallbackURL()) this.markBack();
        else this.check(true);
        return this.logged_out;
    }

    /** Tests only. */
    stop() {
        window.removeEventListener('pageshow', this.onPageBack);
        window.removeEventListener('focus', this.onPageBack);
        window.removeEventListener('pagehide', this.onPageHide);
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
        if (this.beat) clearInterval(this.beat);
        this.disposeBusyWatch?.();
        this.beat = null;
        this.disposeBusyWatch = null;
        this.deps = null;
        this.is_logging_out = false;
        this.logged_out = Promise.resolve();
    }

    /** Applies the rules now. True while this tab is being logged out, so callers must not reconnect. */
    check = (is_page_load = false) => {
        if (this.is_logging_out) return true;
        if (!this.deps) return false;
        if (this.deps.isBusy()) {
            this.stampLastSeen();
            return false;
        }

        const now = Date.now();
        const last_seen = readTime(localStorage, LAST_SEEN_KEY);
        const login_at = readLoginTime();

        if (login_at === null) {
            this.onNoLoginInThisTab(now, last_seen, is_page_load);
        } else {
            const closed_at = readTime(sessionStorage, CLOSED_AT_KEY);
            const logged_out_at = readTime(localStorage, LOGGED_OUT_AT_KEY);
            const was_logged_out_elsewhere = logged_out_at !== null && logged_out_at > login_at;
            if (was_logged_out_elsewhere || isAwayTooLong({ now, last_seen, closed_at, login_at })) {
                this.logOut(now);
                return true;
            }
            session_status.setIdleLoggedOut(false);
        }

        if (isOnScreen()) this.markBack();
        return false;
    };

    private onNoLoginInThisTab(now: number, last_seen: number | null, is_page_load: boolean) {
        if (last_seen === null) return;
        const away_ms = now - last_seen;
        // This tab is about to record "on screen": a hidden tab past its limit must still go.
        if (away_ms > TAB_HIDDEN_LIMIT_MS) writeTime(localStorage, LOGGED_OUT_AT_KEY, now);
        if (is_page_load && hadLogin() && away_ms > TAB_CLOSED_LIMIT_MS) {
            startLog('away too long - logged-out page, same page');
            session_status.setIdleLoggedOut(true);
            this.deps?.restorePage();
        }
    }

    private logOut(now: number) {
        this.is_logging_out = true;
        startLog('away too long - logging out');
        writeTime(localStorage, LOGGED_OUT_AT_KEY, now);
        session_status.setIdleLoggedOut(true);
        this.logged_out = this.runLogout();
    }

    private async runLogout() {
        try {
            await this.deps?.logout();
        } catch (error) {
            ErrorLogger.error('IdleLogout', 'Logout failed', error);
        }
        // Whatever happened above, no login may be left for a reconnect to find.
        sessionStorage.removeItem('auth_info');
        sessionStorage.removeItem('deriv_accounts');
        sessionStorage.removeItem(CLOSED_AT_KEY);
        session_status.setIdleLoggedOut(true); // client.logout clears sessionStorage, its copy included
        if (isOnScreen()) this.stampLastSeen();
        this.is_logging_out = false;
        this.deps?.onLoggedOut();
    }

    private stampLastSeen = () => writeTime(localStorage, LAST_SEEN_KEY, Date.now());

    private markBack() {
        this.stampLastSeen();
        try {
            sessionStorage.removeItem(CLOSED_AT_KEY);
        } catch {
            // Blocked storage: nothing was written either.
        }
    }

    private onPageBack = () => {
        this.check();
    };

    private onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') this.stampLastSeen();
        else this.check();
    };

    /** Closing, reloading or leaving the site. A tab that was already hidden keeps its older last-seen time. */
    private onPageHide = () => {
        writeTime(sessionStorage, CLOSED_AT_KEY, Date.now());
        if (isOnScreen() || this.deps?.isBusy()) this.stampLastSeen();
    };

    private onBeat = () => {
        if (isOnScreen() || this.deps?.isBusy()) this.check();
    };
}

export const idle_logout = new IdleLogout();

/**
 * After an idle logout only the trader's own press logs in. DTrader's frame also
 * asks for a login by itself when a page needs one, and Deriv's own session
 * would then bring the trader straight back in. A press inside the frame counts
 * here too: it activates the parent page as well.
 */
export const isLoginRequestAllowed = () => !session_status.is_idle_logged_out || !!navigator.userActivation?.isActive;
