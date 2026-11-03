/**
 * Every additional fresh tab (Android Chrome): the tab starts without its
 * login (no auth_info yet) on the public socket and the bot area sends its
 * first request (trading_times) there. When the login becomes visible (page
 * shown / focused) api_base logs in on a new socket and closes the public
 * one - which never answers that request. The header showed the account
 * (authorized on the new socket) while the bot area waited forever. Reload
 * worked because it started logged in, with no socket swap.
 *
 * Real api_base and TradingTimes; fake sockets that behave like deriv-api.
 */
import moment from 'moment';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { api_base } from '../api-base';
import { generateDerivApiInstance } from '../appId';
import TradingTimes from '../trading-times';

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

const mockGenerate = generateDerivApiInstance as jest.Mock;
const mockGetAuthInfo = OAuthTokenExchangeService.getAuthInfo as jest.Mock;

/** deriv-api: a request on a socket that closes before answering is never answered. */
function makeSocket(is_authenticated: boolean, { answers_trading_times = true } = {}) {
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
        send: jest.fn((request: Record<string, unknown>) => {
            if (connection.readyState !== 1) return new Promise(() => {});
            if (request.trading_times && !answers_trading_times) return new Promise(() => {});
            if (request.trading_times) return Promise.resolve({ trading_times: { markets: [] } });
            return Promise.resolve({ echo_req: request });
        }),
        balance: jest.fn(() => Promise.resolve({ balance: { balance: 0.1, currency: 'USD', loginid: 'CR1' } })),
        onMessage: () => ({ subscribe: () => ({ unsubscribe: jest.fn() }) }),
        open() {
            connection.readyState = 1;
            listeners.open?.forEach(cb => cb());
        },
    };
}

const flush = () => jest.advanceTimersByTimeAsync(0);

describe('an additional fresh tab', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.spyOn(console, 'info').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
        localStorage.clear();
        localStorage.setItem('active_loginid', 'CR1');
        api_base.has_active_symbols = true;
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('starts public, logs in on a new socket when its login appears - and the bot area still finishes', async () => {
        // 1. New tab: no login in this tab yet -> public socket.
        mockGetAuthInfo.mockReturnValue(null);
        const public_socket = makeSocket(false, { answers_trading_times: false });
        mockGenerate.mockResolvedValueOnce(public_socket);
        await api_base.init();
        public_socket.open();
        await flush();

        // 2. The bot area starts: its first request goes out on the public socket.
        const trading_times = new TradingTimes({ ws: null, server_time: moment.utc() });
        let is_ready = false;
        trading_times.initialise().then(() => {
            is_ready = true;
        });
        await flush();
        expect(public_socket.send).toHaveBeenCalledWith({ trading_times: expect.any(String) });

        // 3. The login appears; the tab is focused -> a new, logged-in socket replaces the public one.
        mockGetAuthInfo.mockReturnValue({ access_token: 'token', expires_at: Date.now() + 3600 * 1000 });
        const logged_in_socket = makeSocket(true);
        mockGenerate.mockResolvedValueOnce(logged_in_socket);
        window.dispatchEvent(new Event('focus'));
        await flush();
        logged_in_socket.open();
        await flush();
        expect(api_base.api).toBe(logged_in_socket);
        expect(public_socket.connection.readyState).toBe(3);

        // Before the fix the bot area waited here for ever. Now: asked again on the new socket.
        await jest.advanceTimersByTimeAsync(10000);
        expect(is_ready).toBe(true);
        expect(logged_in_socket.send).toHaveBeenCalledWith({ trading_times: expect.any(String) });
    });
});
