/**
 * The owner's rules, one by one. Real timestamps through a fake clock; the page
 * events are the browser's own names. A page load is modelled as a new start()
 * on what storage kept, exactly what a reopened tab has.
 */
import { observable, runInAction } from 'mobx';
import {
    CLOSED_AT_KEY,
    idle_logout,
    IDLE_LOGOUT_MINUTES,
    isAwayTooLong,
    isLoginRequestAllowed,
    LAST_SEEN_BEAT_MS,
    LAST_SEEN_KEY,
    LOGGED_OUT_AT_KEY,
} from '../idle-logout';
import { session_status } from '../session-status';

const MIN = 60000;
const START = new Date('2026-11-04T12:00:00Z').getTime();
const LOGIN_EXPIRES_IN = 3600;

let visibility: DocumentVisibilityState = 'visible';
let has_focus = true;
const busy = observable.box(false);

const logout = jest.fn(async () => {
    // What client.logout does to storage.
    sessionStorage.clear();
    localStorage.removeItem('active_loginid');
});
const onLoggedOut = jest.fn();
const restorePage = jest.fn();

const startPage = () => idle_logout.start({ isBusy: () => busy.get(), logout, onLoggedOut, restorePage });

const logIn = (at = Date.now()) => {
    sessionStorage.setItem(
        'auth_info',
        JSON.stringify({
            access_token: 'token',
            expires_in: LOGIN_EXPIRES_IN,
            expires_at: at + LOGIN_EXPIRES_IN * 1000,
        })
    );
    localStorage.setItem('active_loginid', 'CR1');
};

const wait = (ms: number) => jest.setSystemTime(Date.now() + ms);

const setVisibility = (state: DocumentVisibilityState) => {
    visibility = state;
    has_focus = state === 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
};

const leaveTab = () => setVisibility('hidden');
const comeBack = async () => {
    setVisibility('visible');
    await flush();
};

/** The tab closes: storage stays, the page's listeners go. */
const closeTab = () => {
    window.dispatchEvent(new Event('pagehide'));
    visibility = 'hidden';
    has_focus = false;
    document.dispatchEvent(new Event('visibilitychange'));
    idle_logout.stop();
};

const reopenTab = async () => {
    visibility = 'visible';
    has_focus = true;
    await startPage();
};

const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};

const isLoggedIn = () => !!sessionStorage.getItem('auth_info');

describe('idle logout', () => {
    beforeAll(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
        document.hasFocus = () => has_focus;
    });

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(START);
        localStorage.clear();
        sessionStorage.clear();
        visibility = 'visible';
        has_focus = true;
        runInAction(() => busy.set(false));
        session_status.setIdleLoggedOut(false);
        window.history.replaceState({}, '', '/#market_tool');
    });

    afterEach(() => {
        idle_logout.stop();
        jest.useRealTimers();
    });

    it('the limits are 5 and 10 minutes, in one place', () => {
        expect(IDLE_LOGOUT_MINUTES).toEqual({ tab_closed: 5, tab_hidden: 10 });
    });

    describe('A: tab closed', () => {
        beforeEach(async () => {
            logIn();
            await startPage();
        });

        it('reopened within 5 minutes: still logged in', async () => {
            closeTab();
            wait(5 * MIN);
            await reopenTab();
            expect(logout).not.toHaveBeenCalled();
            expect(isLoggedIn()).toBe(true);
            expect(sessionStorage.getItem(CLOSED_AT_KEY)).toBeNull();
        });

        it('reopened after more than 5 minutes: logged out before the page goes on, on the same page', async () => {
            closeTab();
            wait(5 * MIN + 1);
            await reopenTab();
            expect(logout).toHaveBeenCalledTimes(1);
            expect(isLoggedIn()).toBe(false);
            expect(session_status.is_idle_logged_out).toBe(true);
            expect(window.location.hash).toBe('#market_tool');
        });

        it('a reload is not a close', async () => {
            wait(30 * 1000);
            closeTab();
            await reopenTab();
            expect(logout).not.toHaveBeenCalled();
        });

        it('hidden first, then closed: each limit counts from its own moment', async () => {
            leaveTab();
            wait(3 * MIN);
            window.dispatchEvent(new Event('pagehide'));
            idle_logout.stop();
            wait(4 * MIN); // hidden 7, closed 4: neither limit passed
            await reopenTab();
            expect(logout).not.toHaveBeenCalled();
        });

        it('hidden first, then closed: reopened over the closed limit', async () => {
            leaveTab();
            wait(3 * MIN);
            window.dispatchEvent(new Event('pagehide'));
            idle_logout.stop();
            wait(6 * MIN); // hidden 9, closed 6
            await reopenTab();
            expect(logout).toHaveBeenCalledTimes(1);
        });

        it('a tab restored in the background is judged when it loads, and again when shown', async () => {
            closeTab();
            wait(2 * MIN);
            visibility = 'hidden';
            has_focus = false;
            await startPage();
            expect(logout).not.toHaveBeenCalled();
            wait(4 * MIN); // closed for 6 by now
            await comeBack();
            expect(logout).toHaveBeenCalledTimes(1);
        });
    });

    describe('no silent re-login after more than 5 minutes', () => {
        it('nothing is left for the socket or a reconnect to log in with', async () => {
            logIn();
            sessionStorage.setItem('deriv_accounts', '[{"account_id":"CR1"}]');
            await startPage();
            closeTab();
            wait(6 * MIN);
            logout.mockImplementationOnce(async () => {
                throw new Error('logout failed');
            });
            await reopenTab();
            expect(sessionStorage.getItem('auth_info')).toBeNull();
            expect(sessionStorage.getItem('deriv_accounts')).toBeNull();
        });

        it("DTrader's own login request is refused; a press in the frame is not", () => {
            const setActive = (isActive: boolean) =>
                Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive } });

            expect(isLoginRequestAllowed()).toBe(true);
            session_status.setIdleLoggedOut(true);
            setActive(false);
            expect(isLoginRequestAllowed()).toBe(false);
            setActive(true);
            expect(isLoginRequestAllowed()).toBe(true);
        });

        it('a login return is never logged out, however old the times are', async () => {
            logIn();
            await startPage();
            closeTab();
            wait(60 * MIN);
            window.history.replaceState({}, '', '/?code=abc&state=xyz');
            await reopenTab();
            expect(logout).not.toHaveBeenCalled();
            expect(sessionStorage.getItem(CLOSED_AT_KEY)).toBeNull();
        });

        it('after logging in again the old times no longer count, even with the page hidden', async () => {
            logIn();
            await startPage();
            leaveTab();
            wait(20 * MIN);
            logIn(Date.now());
            await comeBack();
            expect(logout).not.toHaveBeenCalled();
        });
    });

    describe('B: tab left open', () => {
        beforeEach(async () => {
            logIn();
            await startPage();
        });

        it('back within 10 minutes: nothing changes', async () => {
            leaveTab();
            wait(10 * MIN);
            await comeBack();
            expect(logout).not.toHaveBeenCalled();
            expect(isLoggedIn()).toBe(true);
        });

        it('back after more than 10 minutes: logged out, same page, the socket is told', async () => {
            leaveTab();
            wait(10 * MIN + 1);
            await comeBack();
            expect(logout).toHaveBeenCalledTimes(1);
            expect(onLoggedOut).toHaveBeenCalledTimes(1);
            expect(window.location.hash).toBe('#market_tool');
        });

        it.each(['focus', 'pageshow'])('a return seen first through %s counts too', async event => {
            leaveTab();
            wait(11 * MIN);
            visibility = 'visible';
            has_focus = true;
            window.dispatchEvent(new Event(event));
            await flush();
            expect(logout).toHaveBeenCalledTimes(1);
        });

        it('the page is frozen meanwhile: no timer is needed, the return decides', async () => {
            leaveTab();
            wait(60 * MIN); // the clock moved, no timer ran
            expect(logout).not.toHaveBeenCalled();
            await comeBack();
            expect(logout).toHaveBeenCalledTimes(1);
        });

        it('while the logout runs a resume is told not to reconnect', async () => {
            leaveTab();
            wait(11 * MIN);
            visibility = 'visible';
            expect(idle_logout.check()).toBe(true);
            expect(idle_logout.check()).toBe(true);
            await flush();
            expect(idle_logout.check()).toBe(false);
            expect(logout).toHaveBeenCalledTimes(1);
        });

        it('a reload after the logout keeps the landing page away', async () => {
            leaveTab();
            wait(11 * MIN);
            await comeBack();
            expect(sessionStorage.getItem('ct_idle_logged_out')).toBe('1');
        });
    });

    describe('C: on screen', () => {
        it('the minutes do not count, however long nothing is touched', async () => {
            logIn();
            await startPage();
            jest.advanceTimersByTime(60 * MIN);
            expect(logout).not.toHaveBeenCalled();
            leaveTab();
            wait(9 * MIN);
            await comeBack();
            expect(logout).not.toHaveBeenCalled();
        });

        it('a covered window that keeps focus counts as on screen', async () => {
            logIn();
            await startPage();
            visibility = 'hidden';
            has_focus = true;
            jest.advanceTimersByTime(30 * MIN);
            expect(logout).not.toHaveBeenCalled();
        });

        it('a laptop asleep with the page showing was not on screen', async () => {
            logIn();
            await startPage();
            wait(30 * MIN); // no timer ran while asleep
            jest.advanceTimersByTime(LAST_SEEN_BEAT_MS);
            await flush();
            expect(logout).toHaveBeenCalledTimes(1);
        });
    });

    describe('a bot or the AI Scanner running', () => {
        beforeEach(async () => {
            logIn();
            await startPage();
            runInAction(() => busy.set(true));
        });

        it('hidden for hours: nothing counts, and no logout', async () => {
            leaveTab();
            jest.advanceTimersByTime(180 * MIN);
            await comeBack();
            expect(logout).not.toHaveBeenCalled();
        });

        it('frozen while running: back during the run, still no logout', async () => {
            leaveTab();
            wait(180 * MIN);
            await comeBack();
            expect(logout).not.toHaveBeenCalled();
        });

        it('counting starts when it stops: 10 minutes after the stop is in time', async () => {
            leaveTab();
            jest.advanceTimersByTime(60 * MIN);
            runInAction(() => busy.set(false));
            wait(10 * MIN);
            await comeBack();
            expect(logout).not.toHaveBeenCalled();
        });

        it('counting starts when it stops: more than 10 minutes after the stop logs out', async () => {
            leaveTab();
            jest.advanceTimersByTime(60 * MIN);
            runInAction(() => busy.set(false));
            wait(10 * MIN + 1);
            await comeBack();
            expect(logout).toHaveBeenCalledTimes(1);
        });

        it('frozen, then stopped on the return (connection lost): the count starts there', async () => {
            leaveTab();
            wait(60 * MIN);
            await comeBack();
            runInAction(() => busy.set(false));
            leaveTab();
            wait(9 * MIN);
            await comeBack();
            expect(logout).not.toHaveBeenCalled();
        });

        it('a tab closed during a run is judged from the close', async () => {
            jest.advanceTimersByTime(60 * MIN);
            closeTab();
            runInAction(() => busy.set(false));
            wait(4 * MIN);
            await reopenTab();
            expect(logout).not.toHaveBeenCalled();
        });
    });

    describe('several tabs', () => {
        beforeEach(async () => {
            logIn();
            await startPage();
        });

        const otherTabIsSeen = () => localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));

        it('this tab hidden long past the limit, another tab on screen: no logout', async () => {
            leaveTab();
            wait(30 * MIN);
            otherTabIsSeen();
            await comeBack();
            expect(logout).not.toHaveBeenCalled();
        });

        it('a closed tab reopened while another tab was on screen: no logout', async () => {
            closeTab();
            wait(30 * MIN);
            otherTabIsSeen();
            await reopenTab();
            expect(logout).not.toHaveBeenCalled();
        });

        it('a run in another tab keeps the time from counting here too', async () => {
            leaveTab();
            wait(30 * MIN);
            otherTabIsSeen(); // a busy tab beats the same shared time
            await comeBack();
            expect(logout).not.toHaveBeenCalled();
        });

        it('another tab was logged out for being away: this older login follows', async () => {
            leaveTab();
            wait(2 * MIN);
            localStorage.setItem(LOGGED_OUT_AT_KEY, String(Date.now()));
            otherTabIsSeen();
            await comeBack();
            expect(logout).toHaveBeenCalledTimes(1);
        });

        it('but never during a run here', async () => {
            runInAction(() => busy.set(true));
            localStorage.setItem(LOGGED_OUT_AT_KEY, String(Date.now() + 1));
            jest.advanceTimersByTime(LAST_SEEN_BEAT_MS);
            await flush();
            expect(logout).not.toHaveBeenCalled();
        });

        it('a login made after that logout is left alone', async () => {
            localStorage.setItem(LOGGED_OUT_AT_KEY, String(Date.now() - MIN));
            await comeBack();
            expect(logout).not.toHaveBeenCalled();
        });
    });

    describe('a new tab, without a login of its own', () => {
        const leftAgo = (ms: number) => {
            localStorage.setItem('active_loginid', 'CR1');
            localStorage.setItem(LAST_SEEN_KEY, String(Date.now() - ms));
        };

        it('more than 5 minutes: same page and no landing page, nothing shared is touched', async () => {
            leftAgo(6 * MIN);
            await startPage();
            expect(session_status.is_idle_logged_out).toBe(true);
            expect(restorePage).toHaveBeenCalledTimes(1);
            expect(logout).not.toHaveBeenCalled();
            expect(localStorage.getItem('active_loginid')).toBe('CR1');
            expect(localStorage.getItem(LOGGED_OUT_AT_KEY)).toBeNull();
        });

        it('more than 10 minutes: a hidden tab past its limit must still go when it comes back', async () => {
            leftAgo(11 * MIN);
            await startPage();
            expect(localStorage.getItem(LOGGED_OUT_AT_KEY)).toBe(String(Date.now()));
        });

        it('within 5 minutes: nothing changes', async () => {
            leftAgo(4 * MIN);
            await startPage();
            expect(session_status.is_idle_logged_out).toBe(false);
            expect(restorePage).not.toHaveBeenCalled();
        });

        it('a visitor who never logged in keeps the normal start', async () => {
            localStorage.setItem(LAST_SEEN_KEY, String(Date.now() - 60 * MIN));
            await startPage();
            expect(session_status.is_idle_logged_out).toBe(false);
        });
    });

    it('the first visit with this feature logs nobody out', async () => {
        logIn(START - 60 * MIN);
        await startPage();
        expect(logout).not.toHaveBeenCalled();
    });

    it('isAwayTooLong: exactly on a limit is in time', () => {
        const times = { now: START, closed_at: null, login_at: 0 };
        expect(isAwayTooLong({ ...times, last_seen: START - 10 * MIN })).toBe(false);
        expect(isAwayTooLong({ ...times, last_seen: START - 10 * MIN - 1 })).toBe(true);
        expect(isAwayTooLong({ ...times, last_seen: START - 5 * MIN, closed_at: START - 5 * MIN })).toBe(false);
        expect(isAwayTooLong({ ...times, last_seen: START - 6 * MIN, closed_at: START - 5 * MIN - 1 })).toBe(true);
    });
});
