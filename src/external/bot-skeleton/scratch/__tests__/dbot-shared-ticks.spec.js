/**
 * A bot always gets ticks for its symbol, whoever subscribed first. The real
 * DBot, interpreter, trade engine and ticks service run against a fake
 * socket that behaves like Deriv: ONE tick stream per symbol per socket (a
 * second ticks_history subscribe is refused with AlreadySubscribed), and
 * ticks only flow while some subscription for the symbol is open.
 */
import { api_base } from '../../services/api/api-base';
import { EXECUTION_MODES, setExecutionMode } from '../../services/tradeEngine/utils/execution-mode';
import Interpreter from '../../services/tradeEngine/utils/interpreter';
import dbot from '../dbot';

jest.mock('../../services/api/api-base', () => {
    const base = {
        api: null,
        account_info: { loginid: 'VRTC1', balance: 1000, currency: 'USD' },
        token: 'VRTC1',
        pip_sizes: { R_100: 2 },
        is_running: false,
        is_stopping: false,
        connection_generation: 1,
        subscriptions: [],
        setIsRunning(toggle = false) {
            base.is_running = toggle;
        },
        toggleRunButton: () => {},
        pushSubscription(subscription) {
            base.subscriptions.push(subscription);
        },
        clearSubscriptions() {
            base.subscriptions.forEach(s => s.unsubscribe());
            base.subscriptions = [];
        },
        dropSubscriptions() {
            base.subscriptions.forEach(s => s.unsubscribe());
            base.subscriptions = [];
        },
    };
    return { api_base: base };
});
jest.mock('../blockly', () => ({ loadBlockly: jest.fn() }));
jest.mock('../utils', () => ({
    isAllRequiredBlocksEnabled: jest.fn(() => true),
    updateDisabledBlocks: jest.fn(),
    validateErrorOnBlockDelete: jest.fn(),
}));
jest.mock('../../utils/local-storage', () => ({ getSavedWorkspaces: jest.fn(), saveWorkspaceToRecent: jest.fn() }));
jest.mock('../../services/api/api-helpers', () => ({ __esModule: true, default: { instance: null } }));

const BOT_CODE = `
    Bot.init('VRTC1', {
        symbol: 'R_100',
        contractTypes: ['CALL'],
        candleInterval: '60',
        shouldRestartOnError: false,
        timeMachineEnabled: false,
    });
    Bot.start({
        limitations: {},
        duration: 1,
        duration_unit: 't',
        currency: 'USD',
        amount: 1,
        basis: 'stake',
    });
    while (watch('before')) {
        Bot.purchase('CALL');
    }
`;

/** Trades again after every result, the way generated strategies loop (each buy needs new ticks in Normal). */
const LOOPING_BOT_CODE = `
    Bot.init('VRTC1', {
        symbol: 'R_100',
        contractTypes: ['CALL'],
        candleInterval: '60',
        shouldRestartOnError: false,
        timeMachineEnabled: false,
    });
    while (true) {
        Bot.start({
            limitations: {},
            duration: 1,
            duration_unit: 't',
            currency: 'USD',
            amount: 1,
            basis: 'stake',
        });
        while (watch('before')) {
            Bot.purchase('CALL');
            break;
        }
        while (watch('during')) {}
    }
`;

let next_contract_id = 1;

/** Deriv's rule: one tick stream per symbol per socket. */
function makeDerivSocket() {
    const listeners = new Set();
    const streams = new Map(); // symbol -> subscription id
    let next_id = 1;
    let epoch = 1000;
    const api = {
        connection: { readyState: 1, addEventListener: () => {}, removeEventListener: () => {} },
        sent: [],
        onMessage: () => ({
            subscribe: callback => {
                listeners.add(callback);
                return { unsubscribe: () => listeners.delete(callback) };
            },
        }),
        emit(data) {
            listeners.forEach(callback => callback({ data }));
        },
        /** One tick, only if somebody is streaming the symbol. */
        tick(symbol = 'R_100') {
            const id = streams.get(symbol);
            if (!id) return false;
            epoch += 1;
            api.emit({
                msg_type: 'tick',
                tick: { symbol, epoch, quote: 100 + (epoch % 10), id },
                subscription: { id },
            });
            return true;
        },
        streamId: symbol => streams.get(symbol),
        history() {
            const times = Array.from({ length: 5 }, (_, i) => epoch - 5 + i);
            return { times, prices: times.map(() => 100) };
        },
        send: jest.fn(request => {
            api.sent.push(request);
            if (request.ticks_history) {
                const symbol = request.ticks_history;
                if (!request.subscribe) return Promise.resolve({ msg_type: 'history', history: api.history() });
                if (streams.has(symbol)) {
                    const error = { msg_type: 'history', echo_req: request, error: { code: 'AlreadySubscribed' } };
                    api.emit(error);
                    return Promise.reject(error);
                }
                const id = `stream-${next_id++}`;
                streams.set(symbol, id);
                const response = {
                    msg_type: 'history',
                    history: api.history(),
                    subscription: { id },
                    echo_req: request,
                };
                api.emit(response);
                return Promise.resolve(response);
            }
            if (request.forget) {
                streams.forEach((id, symbol) => id === request.forget && streams.delete(symbol));
                const response = { msg_type: 'forget', forget: 1, echo_req: request };
                api.emit(response);
                return Promise.resolve(response);
            }
            if (request.forget_all) {
                const ids = [...streams.values()];
                streams.clear();
                const response = { msg_type: 'forget_all', forget_all: ids, echo_req: request };
                api.emit(response);
                return Promise.resolve(response);
            }
            if (request.buy) {
                const contract_id = next_contract_id++;
                return Promise.resolve({ buy: { contract_id, transaction_id: contract_id * 10, buy_price: 1 } });
            }
            return Promise.resolve({ echo_req: request });
        }),
        forget: jest.fn(id => api.send({ forget: id })),
        forgetAll: jest.fn((...types) => api.send({ forget_all: types })),
        buys: () => api.sent.filter(request => request.buy),
    };
    return api;
}

/** The Market Tool (useDigitAnalysis) opening its own stream for a symbol. */
const openMarketTool = async (socket, symbol = 'R_100') => {
    await socket.send({ ticks_history: symbol, end: 'latest', count: 1000, style: 'ticks', subscribe: 1 });
    return socket.streamId(symbol);
};

const tickUntil = async (socket, condition) => {
    for (let i = 0; i < 60 && !condition(); i++) {
        socket.tick();
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 25));
    }
};

const settle = (_engine, contract_id) => ({
    msg_type: 'proposal_open_contract',
    proposal_open_contract: {
        contract_id,
        is_sold: 1,
        is_expired: 1,
        buy_price: 1,
        sell_price: 1.95,
        currency: 'USD',
        transaction_ids: { buy: contract_id * 10, sell: contract_id * 10 + 1 },
    },
});

describe('Bot ticks on a socket shared with the Market Tool', () => {
    beforeAll(() => {
        window.Blockly = { derivWorkspace: { getAllBlocks: () => [] }, accumulators_request: {} };
    });

    beforeEach(() => {
        localStorage.clear();
        // Normal: every buy needs a NEW tick - the strictest test of the tick stream.
        setExecutionMode(EXECUTION_MODES.NORMAL);
        api_base.is_running = false;
        api_base.is_stopping = false;
        api_base.subscriptions = [];
        dbot.is_bot_running = false;
        jest.spyOn(dbot, 'generateCode').mockReturnValue(BOT_CODE);
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(async () => {
        api_base.setIsRunning(false);
        await dbot.interpreter?.terminateSession?.();
        jest.restoreAllMocks();
    });

    const loadPage = async socket => {
        api_base.api = socket;
        dbot.symbol = 'R_100';
        dbot.interpreter = Interpreter();
        await dbot.interpreter.bot.tradeEngine.watchTicks('R_100');
    };

    it('Market Tool open on the same symbol -> the bot starts, receives ticks and trades', async () => {
        const socket = makeDerivSocket();
        const market_tool_stream = await openMarketTool(socket);
        await loadPage(socket);

        // Deriv refused the bot's own subscription; it shares the Market Tool's stream.
        expect(socket.streamId('R_100')).toBe(market_tool_stream);

        dbot.runBot();
        await tickUntil(socket, () => socket.buys().length > 0);
        expect(socket.buys()).toHaveLength(1);
    });

    it('Market Tool closed during the run -> the bot keeps receiving ticks (and trading)', async () => {
        dbot.generateCode.mockReturnValue(LOOPING_BOT_CODE);
        const socket = makeDerivSocket();
        const market_tool_stream = await openMarketTool(socket);
        await loadPage(socket);
        dbot.runBot();
        await tickUntil(socket, () => socket.buys().length > 0);
        expect(socket.buys()).toHaveLength(1);

        // The trader leaves the Market Tool: it forgets its own stream by id.
        await socket.forget(market_tool_stream);
        await new Promise(resolve => setTimeout(resolve, 0));

        // The bot subscribed in its own right: the symbol streams again, under a new id.
        expect(socket.streamId('R_100')).toBeTruthy();
        expect(socket.streamId('R_100')).not.toBe(market_tool_stream);

        // Ticks reach the engine on the new stream...
        const engine = dbot.interpreter.bot.tradeEngine;
        const tick_before = engine.store.getState().newTick;
        expect(socket.tick()).toBe(true);
        expect(engine.store.getState().newTick).not.toBe(tick_before);

        // ...and it trades on: the next buy (Normal) needs new ticks after the result.
        socket.emit(settle(engine, engine.contractId));
        await tickUntil(socket, () => socket.buys().length > 1);
        expect(socket.buys()).toHaveLength(2);
    });

    it('the bot stopping (its own forget_all) does not bring its stream back', async () => {
        const socket = makeDerivSocket();
        await openMarketTool(socket);
        await loadPage(socket);
        await dbot.interpreter.unsubscribeFromTicksService();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(socket.streamId('R_100')).toBeUndefined();
    });

    it('nobody else streaming the symbol -> the bot owns its stream, as before', async () => {
        const socket = makeDerivSocket();
        await loadPage(socket);
        expect(socket.streamId('R_100')).toBeTruthy();
        dbot.runBot();
        await tickUntil(socket, () => socket.buys().length > 0);
        expect(socket.buys()).toHaveLength(1);
    });
});
