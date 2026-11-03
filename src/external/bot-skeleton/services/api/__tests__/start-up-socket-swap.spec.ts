/**
 * The bot area's start-up ("Initializing Deriv Bot account...") waits for
 * ActiveSymbols.retrieveActiveSymbols, which first waits for TradingTimes.
 *
 * On a login return in a fresh tab (?code=...), the page opens the public
 * socket first; the token exchange then opens the logged-in socket and closes
 * the public one. A request still waiting on the public socket is never
 * answered (deriv-api never settles a request on a closed socket).
 */
import moment from 'moment';
import ActiveSymbols from '../active-symbols';
import { api_base } from '../api-base';
import TradingTimes, { TRADING_TIMES_TIMEOUT_MS } from '../trading-times';

jest.mock('../api-base', () => ({
    api_base: { api: null, has_active_symbols: true, active_symbols: [{ symbol: 'R_100' }] },
}));
jest.mock('../../../../../services/active-symbol-categorization.service', () => ({
    activeSymbolCategorizationService: { categorizeActiveSymbols: jest.fn(() => ({})) },
}));

type TSocket = { send: jest.Mock; connection: { readyState: number }; close: () => void };

/** deriv-api: once closed, a request is never answered. */
const makeSocket = (answers: boolean): TSocket => {
    const socket: TSocket = {
        connection: { readyState: 1 },
        send: jest.fn(request => {
            if (!answers || socket.connection.readyState !== 1) return new Promise(() => {});
            if ((request as { trading_times?: string }).trading_times) {
                return Promise.resolve({ trading_times: { markets: [] } });
            }
            return Promise.resolve({});
        }),
        close: () => {
            socket.connection.readyState = 3;
        },
    };
    return socket;
};

const startBotArea = () => {
    const trading_times = new TradingTimes({ ws: null, server_time: moment.utc() });
    const active_symbols = new ActiveSymbols(trading_times);
    let settled = false;
    active_symbols.retrieveActiveSymbols(true).then(
        () => {
            settled = true;
        },
        () => {
            settled = true;
        }
    );
    return () => settled;
};

describe('bot area start-up across the login-return socket swap', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('finishes when the request goes out on the socket that answers (normal same-tab load)', async () => {
        (api_base as unknown as { api: TSocket }).api = makeSocket(true);
        const isSettled = startBotArea();
        await jest.advanceTimersByTimeAsync(100);
        expect(isSettled()).toBe(true);
    });

    it('login return in a fresh tab: the public socket is swapped out mid-request - start-up must still finish', async () => {
        const public_socket = makeSocket(true);
        // The public socket is replaced before it answers (the token exchange's api_base.init(true)).
        public_socket.send.mockImplementation(() => new Promise(() => {}));
        (api_base as unknown as { api: TSocket }).api = public_socket;
        const isSettled = startBotArea();
        await jest.advanceTimersByTimeAsync(10);

        public_socket.close();
        (api_base as unknown as { api: TSocket }).api = makeSocket(true);

        await jest.advanceTimersByTimeAsync(30000);
        expect(isSettled()).toBe(true);
    });

    it('the new socket is asked once, within the time limit', async () => {
        const public_socket = makeSocket(false);
        (api_base as unknown as { api: TSocket }).api = public_socket;
        const isSettled = startBotArea();
        public_socket.close();
        const logged_in_socket = makeSocket(true);
        (api_base as unknown as { api: TSocket }).api = logged_in_socket;

        await jest.advanceTimersByTimeAsync(TRADING_TIMES_TIMEOUT_MS - 1);
        expect(logged_in_socket.send).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        expect(logged_in_socket.send).toHaveBeenCalledWith({ trading_times: expect.any(String) });
        await jest.advanceTimersByTimeAsync(10);
        expect(isSettled()).toBe(true);
    });

    it('a socket that never answers and is not replaced: built-in market hours, start-up still finishes', async () => {
        (api_base as unknown as { api: TSocket }).api = makeSocket(false);
        const isSettled = startBotArea();
        await jest.advanceTimersByTimeAsync(TRADING_TIMES_TIMEOUT_MS + 10);
        expect(isSettled()).toBe(true);
    });
});
