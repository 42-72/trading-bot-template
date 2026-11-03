import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { readConnLog } from '@/utils/connection-log';
import { session_status, SessionExpiredError } from '@/utils/session-status';
import { keep_alive, KEEP_ALIVE_INTERVAL_MS } from '@/utils/socket-keep-alive';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base, RECONNECT_BACKOFF_MS } from '../api-base';
import { generateDerivApiInstance } from '../appId';
import ApiHelpers from '../api-helpers';
import chart_api from '../chart-api';

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

const events = (name: string) => readConnLog().filter(entry => entry.e === name);

const setVisibility = (state: 'visible' | 'hidden') =>
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });

describe('api_base session handling (ct_session_v2 on)', () => {
    let emitted: string[];
    const recordEmit = (name: string) => () => emitted.push(name);
    const onLost = recordEmit('session.connection_lost');
    const onExpired = recordEmit('session.expired');

    beforeEach(() => {
        jest.useFakeTimers();
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('ct_session_v2', '1');
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
        expect(events('authorized')).toHaveLength(1);
    });

    describe('auth errors during a handshake or a socket swap (the v1 mistake)', () => {
        it('an auth error answering the handshake never logs out or wipes auth', async () => {
            const api = makeApi(true, () => Promise.reject({ error: { code: 'AuthorizationRequired' } }));
            await loggedIn(api);

            expect(client_store.logout).not.toHaveBeenCalled();
            expect(localStorage.getItem('active_loginid')).toBe('VRTC1');
            expect(events('auth_error_ignored')).toHaveLength(1);
            expect(events('auth_wipe')).toHaveLength(0);
        });

        it('an auth error on a message before the handshake finished is ignored', async () => {
            const base = createApiBase();
            const api = makeApi();
            mockGenerate.mockResolvedValueOnce(api);
            await base.init();
            // Not open / not authorized yet.
            base.reportAuthError('AuthorizationRequired', 'test', base.api);

            expect(client_store.logout).not.toHaveBeenCalled();
            expect(base.auth_error_check).toBeNull();
            expect(events('auth_error_ignored')).toHaveLength(1);
        });

        it('an auth error from the old socket after a swap is ignored', async () => {
            const old_api = makeApi();
            const base = await loggedIn(old_api);
            mockGenerate.mockResolvedValueOnce(makeApi());
            await base.init(true);
            old_api.close();
            base.reportAuthError('InvalidToken', 'test', old_api as never);

            expect(client_store.logout).not.toHaveBeenCalled();
            expect(emitted).toEqual([]);
            expect(events('socket_close_ignored')).toHaveLength(1);
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
            expect(events('authorize_skipped')).toHaveLength(1);
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
            for (const delay of [1000, 2000, 5000, 10000, 30000, 30000]) {
                await jest.advanceTimersByTimeAsync(delay);
            }

            const delays = events('reconnect_scheduled').map(entry => entry.d?.match(/in (\d+)s/)?.[1]);
            // The first try is immediate; each failure schedules the next.
            expect(delays).toEqual(['0', '1', '2', '5', '10', '30', '30', '30']);
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
            expect(events('reconnect_wait')).toHaveLength(1);

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
            base.reportAuthError('InvalidToken', 'test', base.api);
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
            base.reportAuthError('InvalidToken', 'test', base.api);
            await flush();
            fresh_api.open();
            await flush();
            base.reportAuthError('InvalidToken', 'test', base.api);

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
            expect(client_store.logout).toHaveBeenCalledWith(
                'session expired: expires_at passed',
                'api-base.ts onSessionExpired'
            );
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
            expect(events('session_expired')[0].d).toContain('otp_401');
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

        it('logs the first buy after a reconnect, once per connection, and not before any reconnect', async () => {
            const base = await loggedIn();
            base.noteBuy();
            expect(events('first_buy_after_reconnect')).toHaveLength(0);

            await reconnectTo(base, makeApi());
            base.noteBuy();
            base.noteBuy();
            expect(events('first_buy_after_reconnect')).toHaveLength(1);
            expect(events('first_buy_after_reconnect')[0].d).toBe(`connection ${base.connection_generation}`);
        });

        it('"waiting until visible" records what the page actually reported', async () => {
            const base = await loggedIn();
            setVisibility('hidden');
            (base.api as unknown as TFakeApi).close();
            await flush();
            expect(events('reconnect_wait')[0].d).toMatch(
                /waiting until visible \(visibility=hidden online=(true|false) focus=(true|false)\)/
            );
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
            expect(events('reconnect_wait')).toHaveLength(0);
            expect(mockGenerate).toHaveBeenCalledTimes(2);
            has_focus.mockRestore();
        });

        it('an old-path listener left from flag-off is removed and handed to the v2 path - no "not connected" wait', async () => {
            const base = await loggedIn();
            base.api = makeApi() as never;
            (base.api as unknown as TFakeApi).connection.readyState = 3;
            mockGenerate.mockResolvedValueOnce(makeApi());
            base.reconnectIfNotConnected(new Event('online'));
            await flush();
            expect(events('legacy_listener')[0].d).toBe(
                'old online listener removed (api-base.ts reconnectIfNotConnected)'
            );
            expect(events('reconnect_wait')).toHaveLength(0);
            expect(events('reconnect_scheduled')[0].d).toMatch(/^not connected \(old online listener\)/);
        });

        it('listeners attached while the flag was off are removed, so only one reconnect runs', async () => {
            const base = createApiBase();
            localStorage.removeItem('ct_session_v2');
            base.initEventListeners(); // legacy: online / focus -> reconnectIfNotConnected
            localStorage.setItem('ct_session_v2', '1');
            const spy = jest.spyOn(base, 'scheduleReconnect');
            mockGenerate.mockResolvedValueOnce(makeApi());
            await base.init();
            base.api = makeApi() as never;
            (base.api as unknown as TFakeApi).connection.readyState = 3;
            window.dispatchEvent(new Event('online'));
            await flush();
            expect(spy.mock.calls.map(([reason]) => reason)).toEqual(['online']);
            window.removeEventListener('online', base.reconnectIfNotConnected);
            window.removeEventListener('focus', base.reconnectIfNotConnected);
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

        it('a late beat (the timer was held back) is logged', () => {
            keep_alive.start(jest.fn());
            jest.setSystemTime(Date.now() + 70000);
            keep_alive.beat();
            expect(events('keepalive_late')[0].d).toMatch(/^70s since the last ping/);
        });
    });
});

describe('api_base with ct_session_v2 off (behaviour as before)', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('active_loginid', 'VRTC1');
        mockGenerate.mockReset();
        globalObserver.setState({ 'client.store': null });
    });

    it('an exception during authorize still wipes the stored login, as before', async () => {
        const base = createApiBase();
        const api = makeApi(true, () => Promise.reject({ error: { code: 'AuthorizationRequired' } }));
        mockGenerate.mockResolvedValueOnce(api);
        globalObserver.register('Error', jest.fn());
        await base.init();
        await base.authorizeAndSubscribe();

        expect(localStorage.getItem('active_loginid')).toBeNull();
        expect(events('auth_wipe')[0].d).toContain('api-base.ts authorizeAndSubscribe catch');
        globalObserver.unregisterAll('Error');
    });

    it('a public socket is still asked for the balance, as before', async () => {
        const base = createApiBase();
        const api = makeApi(false);
        mockGenerate.mockResolvedValueOnce(api);
        await base.init();
        await base.authorizeAndSubscribe();
        expect(api.balance).toHaveBeenCalled();
    });

    it('5 failed reconnects still clear active_loginid, as before', () => {
        const base = createApiBase();
        base.init = jest.fn() as never;
        base.api = makeApi() as never;
        (base.api as unknown as TFakeApi).connection.readyState = 3;
        for (let i = 0; i < 5; i++) base.reconnectIfNotConnected();
        expect(localStorage.getItem('active_loginid')).toBeNull();
        expect(base.init).toHaveBeenCalledTimes(5);
    });

    it('no keep-alive pings, no reconnect event and no Web Lock with the flag off', async () => {
        jest.useFakeTimers();
        const reconnected = jest.fn();
        globalObserver.register('session.reconnected', reconnected);
        const base = createApiBase();
        const api = makeApi();
        mockGenerate.mockResolvedValueOnce(api);
        await base.init();
        api.open();
        await jest.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS * 3);
        base.setIsRunning(true);
        expect(api.send.mock.calls.filter(([request]) => 'ping' in request)).toHaveLength(0);
        expect(keep_alive.is_running).toBe(false);
        expect(keep_alive.is_lock_held).toBe(false);
        expect(reconnected).not.toHaveBeenCalled();
        base.setIsRunning(false);
        globalObserver.unregisterAll('session.reconnected');
        jest.useRealTimers();
    });

    it('the market-data helpers are still disposed when the socket is replaced, as before', async () => {
        const base = createApiBase();
        const api = makeApi();
        mockGenerate.mockResolvedValueOnce(api);
        await base.init();
        api.connection.readyState = 1;
        mockGenerate.mockResolvedValueOnce(makeApi());
        await base.init(true);
        expect(ApiHelpers.disposeInstance).toHaveBeenCalledTimes(1);
    });

    it('the chart is re-initialised with the connection, as before', async () => {
        const base = createApiBase();
        mockGenerate.mockResolvedValueOnce(makeApi());
        await base.init(true);
        expect(chart_api.init).toHaveBeenCalledWith(true);
    });
});
