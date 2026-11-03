/**
 * Run after a reconnect. The real DBot, interpreter, trade
 * engine and ticks service run against fake sockets that behave like
 * @deriv/deriv-api: a request sent on a closed socket is never answered
 * (its promise neither resolves nor rejects), and onMessage() only ever
 * carries that socket's own messages.
 */
import { observer as globalObserver } from '../../utils/observer';
import { api_base } from '../../services/api/api-base';
import { EXECUTION_MODES, setExecutionMode } from '../../services/tradeEngine/utils/execution-mode';
import Interpreter from '../../services/tradeEngine/utils/interpreter';
import dbot from '../dbot';

jest.mock('../../services/api/api-base', () => {
    const base = {
        api: null,
        account_info: { loginid: 'VRTC1', balance: 1000, currency: 'USD' },
        token: 'VRTC1',
        pip_sizes: { R_100: 2, R_50: 4 },
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

let next_contract_id = 1;

/** A socket the way deriv-api behaves: closed = requests hang, no messages. */
function makeSocket(name) {
    const listeners = new Set();
    const connection = { readyState: 1, addEventListener: () => {}, removeEventListener: () => {} };
    let epoch = 1000;
    const api = {
        name,
        connection,
        sent: [],
        onMessage: () => ({
            subscribe: callback => {
                listeners.add(callback);
                return { unsubscribe: () => listeners.delete(callback) };
            },
        }),
        emit(data) {
            if (connection.readyState === 1) listeners.forEach(callback => callback({ data }));
        },
        tick(symbol = 'R_100') {
            epoch += 1;
            api.emit({ msg_type: 'tick', tick: { symbol, epoch, quote: 100 + (epoch % 10), id: `t-${name}` } });
        },
        send: jest.fn(request => {
            if (connection.readyState !== 1) return new Promise(() => {});
            api.sent.push(request);
            if (request.ticks_history) {
                const times = Array.from({ length: 5 }, (_, i) => epoch - 5 + i);
                return Promise.resolve({ history: { times, prices: times.map(() => 100) } });
            }
            if (request.buy) {
                const contract_id = next_contract_id++;
                return Promise.resolve({
                    buy: { contract_id, transaction_id: contract_id * 10, buy_price: 1 },
                });
            }
            return Promise.resolve({ echo_req: request });
        }),
        forget: jest.fn(id => api.send({ forget: id })),
        forgetAll: jest.fn((...types) => api.send({ forget_all: types })),
        close() {
            connection.readyState = 3;
        },
        buys: () => api.sent.filter(request => request.buy),
    };
    return api;
}

const flush = async (rounds = 20) => {
    for (let i = 0; i < rounds; i++) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 0));
    }
};

/** Ticks on `socket` until `condition()` holds or ~1.5 s pass. */
const tickUntil = async (socket, condition, symbol = 'R_100') => {
    for (let i = 0; i < 60 && !condition(); i++) {
        socket.tick(symbol);
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 25));
    }
};

/** Page load: the socket, the engine watching the market's ticks. */
const loadPage = async socket => {
    api_base.api = socket;
    dbot.symbol = 'R_100';
    dbot.interpreter = Interpreter();
    await dbot.interpreter.bot.tradeEngine.watchTicks('R_100');
};

/** What run-panel-store does on Run (onRunButtonClick -> dbot.runBot). */
const pressRun = () => dbot.runBot();

/** What the connection_lost path does: the Stop button's own path (run-panel-store.stopBot). */
const loseConnection = async socket => {
    socket.close();
    globalObserver.emit('session.connection_lost');
    dbot.stopBot(); // not awaited, as in run-panel-store
    await flush();
};

/** The reconnect: a new socket, authorized - api_base.onSessionAuthorized emits session.reconnected. */
const reconnect = async socket => {
    api_base.api = socket;
    api_base.connection_generation += 1;
    globalObserver.emit('session.reconnected', { generation: api_base.connection_generation });
    await flush();
};

describe('Run after a reconnect', () => {
    beforeAll(() => {
        window.Blockly = {
            derivWorkspace: { getAllBlocks: () => [] },
            accumulators_request: {},
        };
    });

    beforeEach(() => {
        localStorage.clear();
        setExecutionMode(EXECUTION_MODES.FAST);
        api_base.is_running = false;
        api_base.is_stopping = false;
        api_base.subscriptions = [];
        api_base.connection_generation = 1;
        dbot.is_bot_running = false;
        jest.spyOn(dbot, 'generateCode').mockReturnValue(BOT_CODE);
    });

    afterEach(async () => {
        api_base.setIsRunning(false);
        await dbot.interpreter?.terminateSession?.();
        jest.restoreAllMocks();
    });

    afterAll(() => setExecutionMode(EXECUTION_MODES.NORMAL));

    it('sanity: on a fresh page load, Run buys a contract', async () => {
        const socket = makeSocket('A');
        await loadPage(socket);
        pressRun();
        await tickUntil(socket, () => socket.buys().length > 0);
        expect(socket.buys()).toHaveLength(1);
    });

    it('bot running -> connection lost -> reconnect -> Run buys on the new connection', async () => {
        const a = makeSocket('A');
        await loadPage(a);
        pressRun();
        await tickUntil(a, () => a.buys().length > 0);
        expect(a.buys()).toHaveLength(1);

        await loseConnection(a);
        // The stop must finish even though the old socket never answers its forget requests.
        expect(api_base.is_stopping).toBe(false);

        const b = makeSocket('B');
        await reconnect(b);

        pressRun();
        await tickUntil(b, () => b.buys().length > 0);
        expect(b.buys()).toHaveLength(1);
        // Ticks and the buy went out on the new socket only.
        expect(b.sent.some(request => request.ticks_history === 'R_100')).toBe(true);
        expect(dbot.interpreter.isBoundTo(b)).toBe(true);

        // Contract updates arrive on the new socket and reach the engine.
        const engine = dbot.interpreter.bot.tradeEngine;
        const contract_id = engine.contractId;
        expect(contract_id).toBeTruthy();
        b.emit({
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
        expect(engine.contractId).toBe('');
        expect(engine.data.contract.contract_id).toBe(contract_id);
    });

    it('a reconnect moves the idle engine onto the new socket before Run is pressed', async () => {
        const a = makeSocket('A');
        await loadPage(a);
        await loseConnection(a);
        const b = makeSocket('B');
        await reconnect(b);
        expect(dbot.interpreter.isBoundTo(b)).toBe(true);
        expect(b.sent.some(request => request.ticks_history === 'R_100')).toBe(true);
    });

    it('Run pressed before the engine was refreshed (no reconnect event) still runs on the new connection', async () => {
        const a = makeSocket('A');
        await loadPage(a);
        pressRun();
        await tickUntil(a, () => a.buys().length > 0);
        await loseConnection(a);

        const b = makeSocket('B');
        api_base.api = b; // new socket, but nobody told DBot
        pressRun();
        await tickUntil(b, () => b.buys().length > 0);
        expect(b.buys()).toHaveLength(1);
    });

    it('AI Scanner path: the engine market changes after the reconnect, then Run buys on the new connection', async () => {
        const a = makeSocket('A');
        await loadPage(a);
        pressRun();
        await tickUntil(a, () => a.buys().length > 0);
        await loseConnection(a);

        const b = makeSocket('B');
        api_base.api = b; // reconnected; the scanner then loads its engine on R_50
        dbot.symbol = 'R_50';
        await dbot.interpreter.unsubscribeFromTicksService();
        await dbot.interpreter.bot.tradeEngine.watchTicks('R_50');

        dbot.generateCode.mockReturnValue(BOT_CODE.replace("'R_100'", "'R_50'"));
        pressRun();
        await tickUntil(b, () => b.buys().length > 0, 'R_50');
        expect(b.buys()).toHaveLength(1);
        expect(b.buys()[0].parameters.underlying_symbol).toBe('R_50');
    });
});
