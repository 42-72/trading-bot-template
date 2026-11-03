import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { session_status, SessionExpiredError } from '@/utils/session-status';
import { keep_alive, KEEP_ALIVE_INTERVAL_MS } from '@/utils/socket-keep-alive';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base, RECONNECT_BACKOFF_MS } from '../api-base';
import { generateDerivApiInstance } from '../appId';
import ApiHelpers from '../api-helpers';

jest.mock('../appId', () => ({
    generateDerivApiInstance: jest.fn(),
    V2GetActiveAccountId: jest.fn(() => 'VRTC1'),
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
jest.mock('@/services/oauth-token-exchange.service', () => ({
    OAuthTokenExchangeService: { getAuthInfo: jest.fn() },
}));
jest.mock('@/services/derivws-accounts.service', () => ({
    DerivWSAccountsService: { getStoredAccounts: jest.fn(() => []) },
}));

type TFakeApi = ReturnType<typeof makeApi>;

const balanceOk = () => Promise.resolve({ balance: { balance: 100, currency: 'USD', loginid: 'VRTC1' } });

function makeApi(is_authenticated = true, balance: () => Promise<unknown> = balanceOk) {
    const listeners: Record<string, ((event?: unknown) => void)[]> = {};
    const connection = {
        readyState: 0,
        addEventListener: (event: string, cb: (event?: unknown) => void) => {
            (listeners[event] ||= []).push(cb);
        },
        removeEventListener: jest.fn(),
    };
    return {
        ct_is_authenticated: is_authenticated,
        connection,
        disconnect: jest.fn(() => {
            connection.readyState = 3;
        }),
        send: jest.fn((request: Record<string, unknown>) => Promise.resolve({ echo_req: request })),
        balance: jest.fn(balance),
        onMessage: () => ({ subscribe: () => ({ unsubscribe: jest.fn() }) }),
        open() {
            connection.readyState = 1;
            listeners.open?.forEach(cb => cb());
        },
        close(code = 1006) {
            connection.readyState = 3;
            listeners.close?.forEach(cb => cb({ code }));
        },
    };
}

const mockGenerate = generateDerivApiInstance as jest.Mock;
const mockGetAuthInfo = OAuthTokenExchangeService.getAuthInfo as jest.Mock;

let client_store: { logout: jest.Mock; setWebSocketLoginId: jest.Mock; setIsAccountRegenerating: jest.Mock };
let instances: (typeof api_base)[] = [];

const createApiBase = () => {
    const instance = new (api_base.constructor as new () => typeof api_base)();
    instance.has_active_symbols = true;
    instances.push(instance);
    return instance;
};

const flush = () => jest.advanceTimersByTimeAsync(0);

/** A fresh api_base on a logged-in socket that has finished its handshake. */
const loggedIn = async (api: TFakeApi = makeApi()) => {
    const base = createApiBase();
    mockGenerate.mockResolvedValueOnce(api);
    await base.init();
    api.open();
    await flush();
    return base;
};

const setVisibility = (state: 'visible' | 'hidden') =>
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });

describe('api_base session handling', () => {
    let emitted: string[];
    const recordEmit = (name: string) => () => emitted.push(name);
    const onLost = recordEmit('session.connection_lost');
    const onExpired = recordEmit('session.expired');

    beforeEach(() => {
        jest.useFakeTimers();
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('active_loginid', 'VRTC1');
        mockGenerate.mockReset();
        mockGetAuthInfo.mockReturnValue({ access_token: 'token', expires_at: Date.now() + 3600 * 1000 });
        setVisibility('visible');
        client_store = {
            logout: jest.fn(() => Promise.resolve()),
            setWebSocketLoginId: jest.fn(),
            setIsAccountRegenerating: jest.fn(),
        };
        globalObserver.setState({ 'client.store': client_store });
        emitted = [];
        globalObserver.register('session.connection_lost', onLost);
        globalObserver.register('session.expired', onExpired);
        session_status.setReconnecting(false);
        session_status.notice = null;
    });

    afterEach(() => {
        instances.forEach(instance => {
            window.removeEventListener('online', instance.onWindowOnline);
            window.removeEventListener('focus', instance.onWindowFocus);
            document.removeEventListener('visibilitychange', instance.onVisibilityChange);
            if (instance.reconnect_timer) clearTimeout(instance.reconnect_timer);
            if (instance.expiry_timer) clearTimeout(instance.expiry_timer);
        });
        instances = [];
        keep_alive.stop();
        globalObserver.unregisterAll('session.connection_lost');
        globalObserver.unregisterAll('session.expired');
        jest.useRealTimers();
    });

    it('a logged-in socket that finished its handshake counts as fully logged in', async () => {
        const base = await loggedIn();
        expect(base.isFullyLoggedIn()).toBe(true);
    });

    describe('auth errors during a handshake or a socket swap (the v1 mistake)', () => {
        it('an auth error answering the handshake never logs out or wipes auth', async () => {
            const api = makeApi(true, () => Promise.reject({ error: { code: 'AuthorizationRequired' } }));
            await loggedIn(api);

            expect(client_store.logout).not.toHaveBeenCalled();
            expect(localStorage.getItem('active_loginid')).toBe('VRTC1');
        });

        it('an auth error on a message before the handshake finished is ignored', async () => {
            const base = createApiBase();
            const api = makeApi();
            mockGenerate.mockResolvedValueOnce(api);
            await base.init();
            // Not open / not authorized yet.
            base.reportAuthError('AuthorizationRequired', base.api);

            expect(client_store.logout).not.toHaveBeenCalled();
            expect(base.auth_error_check).toBeNull();
        });

        it('an auth error from the old socket after a swap is ignored', async () => {
            const old_api = makeApi();
            const base = await loggedIn(old_api);
            mockGenerate.mockResolvedValueOnce(makeApi());
            await base.init(true);
            old_api.close();
            base.reportAuthError('InvalidToken', old_api as never);

            expect(client_store.logout).not.toHaveBeenCalled();
            expect(emitted).toEqual([]);
        });

        it('the public socket is never asked to authorize - no balance call, no logout', async () => {
            const base = createApiBase();
            const api = makeApi(false);
            mockGenerate.mockResolvedValueOnce(api);
            await base.init();
            api.open();
            await flush();

            expect(api.balance).not.toHaveBeenCalled();
            expect(client_store.logout).not.toHaveBeenCalled();
        });
    });

    describe('a page that starts without a session (new tab, or prerendered from the address bar)', () => {
        const startOnPublicSocket = async () => {
            mockGetAuthInfo.mockReturnValue(null); // no auth_info in this tab's sessionStorage
            const base = createApiBase();
            base.has_active_symbols = false;
            const api = makeApi(false);
            mockGenerate.mockResolvedValueOnce(api);
            await base.init();
            api.open();
            await flush();
            return { base, api };
        };

        it('loads the logged-out app instead of waiting forever - the market list is asked for', async () => {
            const { api } = await startOnPublicSocket();
            expect(api.balance).not.toHaveBeenCalled();
            expect(client_store.logout).not.toHaveBeenCalled();
            expect(api.send).toHaveBeenCalledWith(expect.objectContaining({ active_symbols: 'brief' }));
            expect(localStorage.getItem('active_loginid')).toBe('VRTC1');
        });

        it('logs in on a new socket as soon as a session appears (page shown / focused)', async () => {
            const { base } = await startOnPublicSocket();
            mockGetAuthInfo.mockReturnValue({ access_token: 'token', expires_at: Date.now() + 3600 * 1000 });
            const logged_in_api = makeApi(true);
            mockGenerate.mockResolvedValueOnce(logged_in_api);
            base.initEventListeners();
            window.dispatchEvent(new Event('focus'));
            await flush();
            logged_in_api.open();
            await flush();

            expect(base.api).toBe(logged_in_api);
            expect(base.isFullyLoggedIn()).toBe(true);
        });

        it('stays on the public socket while there is still no session', async () => {
            const { base, api } = await startOnPublicSocket();
            base.initEventListeners();
            window.dispatchEvent(new Event('focus'));
            await flush();
            expect(base.api).toBe(api);
        });
    });

    describe('reconnecting', () => {
        it('OTP fails, then succeeds: still logged in, with "Reconnecting…" shown meanwhile', async () => {
            const base = await loggedIn();
            mockGenerate.mockRejectedValueOnce(new Error('Failed to fetch'));
            const next_api = makeApi();
            mockGenerate.mockResolvedValueOnce(next_api);

            (base.api as unknown as TFakeApi).close();
            await flush(); // first attempt: OTP fails
            expect(session_status.is_reconnecting).toBe(true);
            expect(mockGenerate).toHaveBeenCalledTimes(2);

            await jest.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS[0]); // second attempt: OTP ok
            next_api.open();
            await flush();

            expect(base.api).toBe(next_api);
            expect(base.isFullyLoggedIn()).toBe(true);
            expect(session_status.is_reconnecting).toBe(false);
            expect(client_store.logout).not.toHaveBeenCalled();
            expect(localStorage.getItem('active_loginid')).toBe('VRTC1');
            // Balance, transactions and contracts are subscribed again on the new socket.
            const subscribed = next_api.send.mock.calls.map(([request]) => Object.keys(request)[0]);
            expect(subscribed).toEqual(expect.arrayContaining(['balance', 'transaction', 'proposal_open_contract']));
        });

        it('OTP fails at page load: retried until it works, no logout', async () => {
            const base = createApiBase();
            mockGenerate.mockRejectedValueOnce(new Error('Failed to fetch'));
            await expect(base.init()).rejects.toThrow('Failed to fetch');
            const api = makeApi();
            mockGenerate.mockResolvedValueOnce(api);
            await flush();
            api.open();
            await flush();

            expect(base.isFullyLoggedIn()).toBe(true);
            expect(client_store.logout).not.toHaveBeenCalled();
        });

        it('retries with backoff 1, 2, 5, 10, 30 s, then every 30 s, never wiping auth', async () => {
            const base = await loggedIn();
            mockGenerate.mockRejectedValue(new Error('Failed to fetch'));
            (base.api as unknown as TFakeApi).close();
            await flush();
            // Page load + the first try, at once.
            expect(mockGenerate).toHaveBeenCalledTimes(2);
            // Each failure schedules the next try after the backoff gap.
            let tries = 2;
            for (const delay of [1000, 2000, 5000, 10000, 30000, 30000]) {
                await jest.advanceTimersByTimeAsync(delay - 1);
                expect(mockGenerate).toHaveBeenCalledTimes(tries);
                await jest.advanceTimersByTimeAsync(1);
                tries += 1;
                expect(mockGenerate).toHaveBeenCalledTimes(tries);
            }
            expect(client_store.logout).not.toHaveBeenCalled();
            expect(localStorage.getItem('active_loginid')).toBe('VRTC1');
        });

        it('waits while the tab is hidden, then reconnects at once when it is visible again', async () => {
            const base = await loggedIn();
            base.initEventListeners();
            setVisibility('hidden');
            (base.api as unknown as TFakeApi).close();
            await jest.advanceTimersByTimeAsync(60000);
            expect(mockGenerate).toHaveBeenCalledTimes(1);

            const next_api = makeApi();
            mockGenerate.mockResolvedValueOnce(next_api);
            setVisibility('visible');
            document.dispatchEvent(new Event('visibilitychange'));
            await flush();
            expect(mockGenerate).toHaveBeenCalledTimes(2);
        });

        it('a closed logged-in socket reports the lost connection (so a running bot is stopped)', async () => {
            const base = await loggedIn();
            mockGenerate.mockResolvedValueOnce(makeApi());
            (base.api as unknown as TFakeApi).close();
            await flush();
            expect(emitted).toEqual(['session.connection_lost']);
            expect(client_store.logout).not.toHaveBeenCalled();
        });
    });

    describe('a real auth error', () => {
        it('one auth error that does not repeat after a fresh reconnect keeps the user logged in', async () => {
            const base = await loggedIn();
            const fresh_api = makeApi();
            mockGenerate.mockResolvedValueOnce(fresh_api);
            base.reportAuthError('InvalidToken', base.api);
            await flush();
            fresh_api.open();
            await flush();

            expect(base.api).toBe(fresh_api);
            expect(base.isFullyLoggedIn()).toBe(true);
            expect(client_store.logout).not.toHaveBeenCalled();
        });

        it('the same error again on the fresh, logged-in connection ends the session', async () => {
            const base = await loggedIn();
            const fresh_api = makeApi();
            mockGenerate.mockResolvedValueOnce(fresh_api);
            base.reportAuthError('InvalidToken', base.api);
            await flush();
            fresh_api.open();
            await flush();
            base.reportAuthError('InvalidToken', base.api);

            expect(emitted).toContain('session.expired');
            expect(session_status.notice).toBe('session_expired');
            expect(client_store.logout).toHaveBeenCalledTimes(1);
        });
    });

    describe('genuine expiry', () => {
        it('expires_at passing stops runs, shows "Session expired" and logs out', async () => {
            mockGetAuthInfo.mockReturnValue({ access_token: 'token', expires_at: Date.now() + 5000 });
            await loggedIn();
            await jest.advanceTimersByTimeAsync(5000);

            expect(emitted).toEqual(['session.expired']);
            expect(session_status.notice).toBe('session_expired');
            expect(client_store.logout).toHaveBeenCalledTimes(1);
        });

        it('auth_info expired in storage (e.g. edited in DevTools): caught when the tab is visible again', async () => {
            const base = await loggedIn();
            base.initEventListeners();
            mockGetAuthInfo.mockReturnValue(null); // getAuthInfo drops an expired auth_info
            document.dispatchEvent(new Event('visibilitychange'));

            expect(emitted).toEqual(['session.expired']);
            expect(session_status.notice).toBe('session_expired');
            expect(client_store.logout).toHaveBeenCalledTimes(1);
        });

        it('a deliberate logout is not an expiry', async () => {
            const base = await loggedIn();
            base.initEventListeners();
            localStorage.removeItem('active_loginid');
            mockGetAuthInfo.mockReturnValue(null);
            document.dispatchEvent(new Event('visibilitychange'));

            expect(emitted).toEqual([]);
            expect(session_status.notice).toBeNull();
        });

        it('a 401 on the OTP request is a genuine expiry', async () => {
            const base = await loggedIn();
            mockGenerate.mockRejectedValueOnce(new SessionExpiredError('otp_401'));
            (base.api as unknown as TFakeApi).close();
            await flush();

            expect(emitted).toEqual(['session.connection_lost', 'session.expired']);
            expect(session_status.notice).toBe('session_expired');
            expect(client_store.logout).toHaveBeenCalledTimes(1);
        });

        it('nothing is re-run or resumed afterwards', async () => {
            const base = await loggedIn();
            mockGenerate.mockRejectedValueOnce(new SessionExpiredError('otp_401'));
            (base.api as unknown as TFakeApi).close();
            await flush();
            emitted = [];
            await jest.advanceTimersByTimeAsync(120000);
            expect(emitted).toEqual([]);
        });
    });

    describe('after a reconnect (Run must work as after a page load)', () => {
        const reconnectTo = async (base: typeof api_base, next_api: TFakeApi) => {
            mockGenerate.mockResolvedValueOnce(next_api);
            (base.api as unknown as TFakeApi).close();
            await flush();
            next_api.open();
            await flush();
        };

        it('tells the bot engine about a reconnected socket - but not about the first one', async () => {
            const reconnected = jest.fn();
            globalObserver.register('session.reconnected', reconnected);
            const base = await loggedIn();
            expect(reconnected).not.toHaveBeenCalled();

            await reconnectTo(base, makeApi());
            expect(reconnected).toHaveBeenCalledTimes(1);
            expect(reconnected).toHaveBeenCalledWith({ generation: base.connection_generation });
            globalObserver.unregisterAll('session.reconnected');
        });

        it('keeps the market-data helpers through a reconnect (rebuilt only by a reload before) and refreshes offerings', async () => {
            const base = await loggedIn();
            await reconnectTo(base, makeApi());
            expect(ApiHelpers.disposeInstance).not.toHaveBeenCalled();
            expect(ApiHelpers.instance).not.toBeNull();
            expect(
                (ApiHelpers.instance as unknown as { contracts_for: { disposeCache: jest.Mock } }).contracts_for
                    .disposeCache
            ).toHaveBeenCalledTimes(1);
        });

        it('a page reported hidden but focused (Windows covering the window) still reconnects at once', async () => {
            const base = await loggedIn();
            setVisibility('hidden');
            const has_focus = jest.spyOn(document, 'hasFocus').mockReturnValue(true);
            mockGenerate.mockResolvedValueOnce(makeApi());
            (base.api as unknown as TFakeApi).close();
            await flush();
            expect(mockGenerate).toHaveBeenCalledTimes(2);
            has_focus.mockRestore();
        });
    });

    describe('keep-alive', () => {
        afterEach(() => {
            keep_alive.stop();
            keep_alive.setBusy('bot', false);
            keep_alive.setBusy('ai_scanner', false);
        });

        const pings = (api: TFakeApi) => api.send.mock.calls.filter(([request]) => 'ping' in request).length;

        it('pings the current socket every 20 s once logged in', async () => {
            const api = makeApi();
            await loggedIn(api);
            await jest.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS * 3);
            expect(pings(api)).toBe(3);
        });

        it('keeps pinging while the tab is hidden and a bot is running, and pings at once on hide', async () => {
            const api = makeApi();
            const base = await loggedIn(api);
            base.setIsRunning(true);
            setVisibility('hidden');
            document.dispatchEvent(new Event('visibilitychange'));
            expect(pings(api)).toBe(1);
            await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
            expect(pings(api)).toBe(1 + 15);
            expect(api.disconnect).not.toHaveBeenCalled();
            expect(emitted).toEqual([]);
            base.setIsRunning(false);
        });

        it('moves to the new socket after a reconnect and never pings a closed one', async () => {
            const old_api = makeApi();
            const base = await loggedIn(old_api);
            const next_api = makeApi();
            mockGenerate.mockResolvedValueOnce(next_api);
            old_api.close();
            await flush();
            next_api.open();
            await flush();
            const old_pings = pings(old_api);
            await jest.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS * 2);
            expect(pings(old_api)).toBe(old_pings);
            expect(pings(next_api)).toBe(2);
            expect(base.api).toBe(next_api);
        });

        it('holds a Web Lock (no tab freezing) while a bot runs, and lets it go when it stops', async () => {
            const release = jest.fn();
            const request = jest.fn((_name: string, _options: unknown, callback: () => Promise<void>) =>
                callback().then(release)
            );
            Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
            const base = await loggedIn();
            base.setIsRunning(true);
            expect(request).toHaveBeenCalledWith('ct-bot-running', { mode: 'shared' }, expect.any(Function));
            expect(keep_alive.is_lock_held).toBe(true);
            base.setIsRunning(false);
            await flush();
            expect(keep_alive.is_lock_held).toBe(false);
            expect(release).toHaveBeenCalled();
            delete (navigator as unknown as { locks?: unknown }).locks;
        });
    });
});
