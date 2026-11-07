/**
 * The idle logout against the real session handling: a tab past its limit must
 * end up on the public socket, without the login round trip a tab with a stored
 * login makes ("session found"), a "Session expired" notice or a stuck
 * "Reconnecting…".
 *
 * Real api_base and idle_logout; fake sockets.
 */
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { idle_logout, LAST_SEEN_KEY } from '@/utils/idle-logout';
import { session_status } from '@/utils/session-status';
import { api_base } from '../api-base';
import { generateDerivApiInstance } from '../appId';

jest.mock('../appId', () => ({
    generateDerivApiInstance: jest.fn(),
    V2GetActiveAccountId: jest.fn(() => 'CR1'),
}));
jest.mock('../chart-api', () => ({ __esModule: true, default: { init: jest.fn() } }));
jest.mock('../api-helpers', () => ({
    __esModule: true,
    default: { disposeInstance: jest.fn(), instance: { contracts_for: { disposeCache: jest.fn() } } },
}));
jest.mock('../../tradeEngine/utils/helpers', () => ({
    doUntilDone: (fn: () => unknown) => Promise.resolve(fn()),
    socket_state: { 0: 'Connecting', 1: 'Connected', 2: 'Closing', 3: 'Closed' },
}));
jest.mock('../../../../../services/active-symbols-processor.service', () => ({
    activeSymbolsProcessorService: { processActiveSymbols: jest.fn() },
}));
jest.mock('@/services/derivws-accounts.service', () => ({
    DerivWSAccountsService: { getStoredAccounts: jest.fn(() => []) },
}));

const mockGenerate = generateDerivApiInstance as jest.Mock;

const makeSocket = (is_authenticated: boolean, ready_state = 1) => ({
    ct_is_authenticated: is_authenticated,
    connection: { readyState: ready_state, addEventListener: jest.fn(), removeEventListener: jest.fn() },
    disconnect: jest.fn(),
    send: jest.fn(() => Promise.resolve({})),
    balance: jest.fn(),
});

const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
};

const logIn = () => {
    sessionStorage.setItem(
        'auth_info',
        // Logged in well before the times each test sets: a fresh login restarts the count.
        JSON.stringify({ access_token: 'token', expires_in: 3600, expires_at: Date.now() - 30 * 60000 + 3600000 })
    );
    localStorage.setItem('active_loginid', 'CR1');
};

const startPage = (logout: () => Promise<void>) =>
    idle_logout.start({
        isBusy: () => false,
        logout,
        onLoggedOut: () => api_base.onIdleLogout(),
    });

/** What client.logout does to the login. */
const clearLogin = async () => {
    sessionStorage.clear();
    localStorage.removeItem('active_loginid');
};

const hiddenFor = (minutes: number) => localStorage.setItem(LAST_SEEN_KEY, String(Date.now() - minutes * 60000));

describe('idle logout and the session handling', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        mockGenerate.mockReset();
        session_status.setReconnecting(false);
        session_status.setNotice(null);
        session_status.setIdleLoggedOut(false);
        Object.assign(api_base, { reconnect_timer: null, is_reconnecting_now: false, is_session_expired: false });
    });

    afterEach(() => {
        idle_logout.stop();
    });

    it('past the limit, on the public socket with the login still stored: no silent login', async () => {
        logIn();
        api_base.api = makeSocket(false) as never;
        const scheduleReconnect = jest.spyOn(api_base, 'scheduleReconnect');
        await startPage(clearLogin);

        // Without the idle rule this is the "session found" login round trip.
        logIn();
        hiddenFor(11);
        api_base.onResume('visible');
        await flush();

        expect(scheduleReconnect).not.toHaveBeenCalledWith('session found', true);
        expect(api_base.hasSession()).toBe(false);
        scheduleReconnect.mockRestore();
    });

    it('within the limit that same round trip still happens (the new-tab start-up fix)', async () => {
        logIn();
        api_base.api = makeSocket(false) as never;
        const scheduleReconnect = jest.spyOn(api_base, 'scheduleReconnect').mockImplementation(() => {});
        await startPage(clearLogin);

        hiddenFor(9);
        api_base.onResume('visible');

        expect(scheduleReconnect).toHaveBeenCalledWith('session found', true);
        scheduleReconnect.mockRestore();
    });

    it('the socket died while away: the public one replaces it, nothing stays on "Reconnecting…"', async () => {
        logIn();
        api_base.api = makeSocket(true, 3) as never;
        await startPage(clearLogin);

        session_status.setReconnecting(true);
        hiddenFor(11);
        const scheduleReconnect = jest.spyOn(api_base, 'scheduleReconnect').mockImplementation(() => {});
        api_base.onResume('visible');
        expect(scheduleReconnect).not.toHaveBeenCalled(); // not with the old login: the logout goes first
        await flush();

        expect(scheduleReconnect).toHaveBeenCalledWith('idle logout', true);
        expect(session_status.is_reconnecting).toBe(false);
        scheduleReconnect.mockRestore();
    });

    it('no "Session expired" notice, then or later', async () => {
        logIn();
        api_base.api = makeSocket(true) as never;
        api_base.had_session = true;
        api_base.session_expires_at = Date.now() + 3600000;
        await startPage(clearLogin);

        hiddenFor(11);
        api_base.onResume('visible');
        await flush();

        // A login made in another tab must not read as this tab's session vanishing.
        localStorage.setItem('active_loginid', 'CR1');
        expect(api_base.checkSessionExpiry()).toBe(false);
        expect(session_status.notice).toBeNull();
        expect(OAuthTokenExchangeService.getAuthInfo()).toBeNull();
    });

    it('a page load logged out by the rules starts with no socket of its own to touch', async () => {
        logIn();
        api_base.api = null;
        const scheduleReconnect = jest.spyOn(api_base, 'scheduleReconnect');
        sessionStorage.setItem('ct_idle_closed_at', String(Date.now() - 6 * 60000));
        hiddenFor(6);
        await startPage(clearLogin);

        expect(api_base.hasSession()).toBe(false);
        expect(scheduleReconnect).not.toHaveBeenCalled(); // app-root opens the one socket itself
        scheduleReconnect.mockRestore();
    });
});
