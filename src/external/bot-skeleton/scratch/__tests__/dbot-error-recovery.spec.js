/**
 * A recoverable error mid-run: the bot carries on where it was, with the same
 * stake and martingale step, and never buys twice. The real DBot, interpreter
 * and trade engine run a martingale strategy against a fake socket; only the
 * waits are shortened (their real lengths are recorded and checked).
 */
import { api_base } from '../../services/api/api-base';
import { EXECUTION_MODES, setExecutionMode } from '../../services/tradeEngine/utils/execution-mode';
import Interpreter from '../../services/tradeEngine/utils/interpreter';
import { observer as globalObserver } from '../../utils/observer';
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
jest.mock('@deriv-com/translations', () => ({
    localize: (text, values = {}) => text.replace(/{{(\w+)}}/g, (_, key) => values[key]),
}));
jest.mock('../blockly', () => ({ loadBlockly: jest.fn() }));
jest.mock('../utils', () => ({
    isAllRequiredBlocksEnabled: jest.fn(() => true),
    updateDisabledBlocks: jest.fn(),
    validateErrorOnBlockDelete: jest.fn(),
}));
jest.mock('../../utils/local-storage', () => ({ getSavedWorkspaces: jest.fn(), saveWorkspaceToRecent: jest.fn() }));
jest.mock('../../services/api/api-helpers', () => ({ __esModule: true, default: { instance: null } }));

/** Doubles the stake after a loss, back to 1 after a win - the state a restart must never lose. */
const martingaleBot = ({ restart_on_error = true } = {}) => `
    var stake = 1;
    Bot.init('VRTC1', {
        symbol: 'R_100',
        contractTypes: ['CALL'],
        candleInterval: '60',
        shouldRestartOnError: ${restart_on_error},
        timeMachineEnabled: false,
    });
    while (true) {
        Bot.start({
            limitations: {},
            duration: 1,
            duration_unit: 't',
            currency: 'USD',
            amount: stake,
            basis: 'stake',
        });
        while (watch('before')) {
            Bot.purchase('CALL');
            break;
        }
        while (watch('during')) {}
        stake = Bot.isResult('loss') ? stake * 2 : 1;
    }
`;

let next_contract_id = 1;

/** `script`: what each buy answers, in order - after it, every buy works. */
function makeSocket(script = []) {
    const listeners = new Set();
    const streams = new Map();
    const open_contracts = [];
    let epoch = 1000;
    const contract = (contract_id, amount, is_sold, profit = 0) => ({
        contract_id,
        is_sold,
        is_expired: is_sold,
        buy_price: amount,
        sell_price: amount + profit,
        currency: 'USD',
        status: is_sold ? 'sold' : 'open',
        entry_tick_time: epoch,
        exit_tick_time: epoch,
        transaction_ids: { buy: contract_id * 10, sell: contract_id * 10 + 1 },
    });
    const api = {
        connection: { readyState: 1, addEventListener: () => {}, removeEventListener: () => {} },
        sent: [],
        portfolio_error: null,
        /** The result the next explicit proposal_open_contract answers with, when it is already over. */
        finished: null,
        onMessage: () => ({
            subscribe: callback => {
                listeners.add(callback);
                return { unsubscribe: () => listeners.delete(callback) };
            },
        }),
        emit(data) {
            listeners.forEach(callback => callback({ data }));
        },
        tick(symbol = 'R_100') {
            const id = streams.get(symbol);
            if (!id) return;
            epoch += 1;
            api.emit({ msg_type: 'tick', tick: { symbol, epoch, quote: 100, id }, subscription: { id } });
        },
        settle(contract_id, amount, profit) {
            open_contracts.length = 0;
            api.emit({
                msg_type: 'proposal_open_contract',
                proposal_open_contract: contract(contract_id, amount, 1, profit),
            });
        },
        send: jest.fn(request => {
            api.sent.push(request);
            if (request.ticks_history) {
                const times = [1, 2, 3, 4, 5].map(i => epoch - 5 + i);
                const id = `stream-${request.ticks_history}`;
                streams.set(request.ticks_history, id);
                return Promise.resolve({ history: { times, prices: times.map(() => 100) }, subscription: { id } });
            }
            if (request.forget_all) {
                streams.clear();
                return Promise.resolve({ forget_all: [], echo_req: request });
            }
            if (request.portfolio) {
                if (api.portfolio_error) return Promise.reject({ error: api.portfolio_error });
                return Promise.resolve({ portfolio: { contracts: [...open_contracts] } });
            }
            if (request.proposal_open_contract) {
                if (api.finished) {
                    const { contract_id, amount, profit } = api.finished;
                    api.finished = null;
                    api.emit({
                        msg_type: 'proposal_open_contract',
                        proposal_open_contract: contract(contract_id, amount, 1, profit),
                    });
                }
                return Promise.resolve({});
            }
            if (request.proposal) {
                const id = `proposal-${next_contract_id++}`;
                const response = {
                    msg_type: 'proposal',
                    proposal: { id, ask_price: request.amount, payout: 2 },
                    passthrough: request.passthrough,
                };
                api.emit(response);
                return Promise.resolve(response);
            }
            if (request.buy) {
                const amount = request.parameters?.amount ?? request.price;
                const outcome = script.shift();
                const contract_id = next_contract_id++;
                if (outcome?.placed) {
                    // Deriv took the buy, but the reply says otherwise.
                    const row = {
                        contract_id,
                        transaction_id: contract_id * 10,
                        buy_price: amount,
                        contract_type: 'CALL',
                        symbol: 'R_100',
                        purchase_time: epoch,
                    };
                    if (outcome.placed !== 'finished') open_contracts.push(row);
                    if (outcome.placed !== 'portfolio_only') {
                        api.emit({
                            msg_type: 'transaction',
                            transaction: {
                                action: 'buy',
                                contract_id,
                                transaction_id: contract_id * 10,
                                amount: -amount,
                                symbol: 'R_100',
                            },
                        });
                    }
                }
                if (outcome?.foreign) {
                    // Somebody else's buy on the account, at the same moment.
                    api.emit({
                        msg_type: 'transaction',
                        transaction: { action: 'buy', contract_id: 999, amount: -50, symbol: 'R_50' },
                    });
                }
                if (outcome?.code) return Promise.reject({ error: { code: outcome.code, message: outcome.code } });
                return Promise.resolve({ buy: { contract_id, transaction_id: contract_id * 10, buy_price: amount } });
            }
            return Promise.resolve({ echo_req: request });
        }),
        forget: jest.fn(id => api.send({ forget: id })),
        forgetAll: jest.fn((...types) => api.send({ forget_all: types })),
        buys: () => api.sent.filter(request => request.buy),
        stakes: () => api.buys().map(request => request.parameters?.amount ?? request.price),
        checks: () => api.sent.filter(request => request.portfolio),
    };
    return api;
}

const pause = ms => new Promise(resolve => real_setTimeout(resolve, ms));
const real_setTimeout = global.setTimeout;

const tickUntil = async (socket, condition) => {
    for (let i = 0; i < 200 && !condition(); i++) {
        socket.tick();
        // eslint-disable-next-line no-await-in-loop
        await pause(5);
    }
    expect(condition()).toBe(true);
};

/** Ticks for a while, for the things that must NOT happen. */
const keepTicking = async (socket, rounds = 40) => {
    for (let i = 0; i < rounds; i++) {
        socket.tick();
        // eslint-disable-next-line no-await-in-loop
        await pause(5);
    }
};

describe('a recoverable error mid-run', () => {
    let waits;
    let stops;
    let notices;
    const onStopped = message => stops.push(message);
    const onNotice = ({ message }) => notices.push(message);
    const engine = () => dbot.interpreter.bot.tradeEngine;

    beforeAll(() => {
        window.Blockly = { derivWorkspace: { getAllBlocks: () => [] }, accumulators_request: {} };
    });

    beforeEach(() => {
        localStorage.clear();
        globalObserver.emit('statistics.clear');
        setExecutionMode(EXECUTION_MODES.NORMAL);
        api_base.is_running = false;
        api_base.is_stopping = false;
        api_base.subscriptions = [];
        dbot.is_bot_running = false;
        stops = [];
        notices = [];
        waits = [];
        globalObserver.register('bot.stopped_on_error', onStopped);
        globalObserver.register('ui.log.notify', onNotice);
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        // The retry waits are 1 s and up: recorded, then run at once.
        jest.spyOn(global, 'setTimeout').mockImplementation((fn, ms, ...args) => {
            if (ms >= 1000 && ms < 10000) {
                waits.push(ms);
                return real_setTimeout(fn, 1, ...args);
            }
            return real_setTimeout(fn, ms, ...args);
        });
    });

    afterEach(async () => {
        globalObserver.unregisterAll('bot.stopped_on_error');
        globalObserver.unregisterAll('ui.log.notify');
        api_base.setIsRunning(false);
        await dbot.interpreter?.terminateSession?.();
        jest.restoreAllMocks();
        window.Blockly.derivWorkspace.getAllBlocks = () => [];
    });

    const startBot = async (script, options) => {
        const socket = makeSocket(script);
        api_base.api = socket;
        dbot.symbol = 'R_100';
        dbot.interpreter = Interpreter();
        await dbot.interpreter.bot.tradeEngine.watchTicks('R_100');
        jest.spyOn(dbot, 'generateCode').mockReturnValue(martingaleBot(options));
        dbot.runBot();
        return socket;
    };

    /** Buys and settles one trade. */
    const trade = async (socket, profit) => {
        await tickUntil(socket, () => !!engine().contractId);
        socket.settle(engine().contractId, socket.stakes().at(-1), profit);
    };

    const LOSS = -1;

    it('carries on with the same stake and martingale step', async () => {
        const socket = await startBot([{}, {}, { code: 'InternalServerError' }]);
        await trade(socket, LOSS); // stake 1 lost
        await trade(socket, LOSS); // stake 2 lost: the next stake is 4
        await tickUntil(socket, () => socket.buys().length === 4 && !!engine().contractId);
        expect(socket.stakes()).toEqual([1, 2, 4, 4]);
        expect(engine().getTotalRuns()).toBe(3); // the refused buy never counted
        // And the strategy goes on from there: 4 lost, the next is 8.
        socket.settle(engine().contractId, 4, LOSS);
        await tickUntil(socket, () => socket.buys().length === 5);
        expect(socket.stakes().at(-1)).toBe(8);
        expect(api_base.is_running).toBe(true);
    });

    it('keeps the same engine and tick stream: no forget_all, nothing torn down', async () => {
        const socket = await startBot([{}, { code: 'InternalServerError' }]);
        const interpreter = dbot.interpreter;
        await trade(socket, LOSS);
        await tickUntil(socket, () => socket.buys().length === 3);
        expect(socket.forgetAll).not.toHaveBeenCalled();
        expect(dbot.interpreter).toBe(interpreter);
    });

    it('waits 1 s, 2 s then 4 s, and says so in the Journal', async () => {
        const failure = { code: 'InternalServerError' };
        const socket = await startBot([failure, failure, failure]);
        await tickUntil(socket, () => socket.buys().length === 4 && !!engine().contractId);
        expect(waits.filter(ms => [1000, 2000, 4000].includes(ms))).toEqual([1000, 2000, 4000]);
        expect(notices).toHaveLength(3);
        expect(notices[0]).toContain('try 1 of 3');
        expect(stops).toEqual([]);
    });

    it('a later failure gets its full tries again', async () => {
        const failure = { code: 'InternalServerError' };
        const socket = await startBot([failure, failure, failure, {}, failure, failure, failure]);
        await tickUntil(socket, () => socket.buys().length === 4 && !!engine().contractId);
        socket.settle(engine().contractId, 1, 1);
        await tickUntil(socket, () => socket.buys().length === 8 && !!engine().contractId);
        expect(stops).toEqual([]);
    });

    it('a normal run never asks about open contracts', async () => {
        const socket = await startBot([]);
        await trade(socket, 1);
        await trade(socket, LOSS);
        expect(socket.checks()).toHaveLength(0);
    });

    describe('never buys twice', () => {
        it('the transaction stream shows the buy went through: waits for its result', async () => {
            const socket = await startBot([{ code: 'InternalServerError', placed: 'open' }]);
            await tickUntil(socket, () => !!engine().contractId);
            await keepTicking(socket);
            expect(socket.buys()).toHaveLength(1);
            expect(engine().getTotalRuns()).toBe(1);

            // Its result counts, and the strategy goes on from it.
            socket.settle(engine().contractId, 1, LOSS);
            await tickUntil(socket, () => socket.buys().length === 2);
            expect(socket.stakes()).toEqual([1, 2]);
        });

        it('only the open contracts show it: same', async () => {
            const socket = await startBot([{ code: 'InternalServerError', placed: 'portfolio_only' }]);
            await tickUntil(socket, () => !!engine().contractId);
            await keepTicking(socket);
            expect(socket.checks()).toHaveLength(1);
            expect(socket.buys()).toHaveLength(1);
        });

        it('the contract is already over: its result is fetched, not bought again', async () => {
            const socket = await startBot([{ code: 'InternalServerError', placed: 'finished' }]);
            const contract_id = next_contract_id;
            socket.finished = { contract_id, amount: 1, profit: LOSS };
            await tickUntil(socket, () => socket.buys().length === 2);
            expect(socket.stakes()).toEqual([1, 2]); // the lost contract's martingale step
        });

        it('another contract on the account is not mistaken for this buy', async () => {
            const socket = await startBot([{ code: 'InternalServerError', foreign: true }]);
            await tickUntil(socket, () => socket.buys().length === 2 && !!engine().contractId);
            expect(engine().contractId).not.toBe(999);
        });

        it('cannot find out: does not buy, and stops once the tries run out', async () => {
            const socket = await startBot([{ code: 'InternalServerError' }]);
            socket.portfolio_error = { code: 'InternalServerError', message: 'no' };
            await tickUntil(socket, () => stops.length === 1);
            expect(socket.buys()).toHaveLength(1);
            expect(socket.checks()).toHaveLength(3);
            expect(stops[0]).toMatch(/^Bot stopped: .*\. Press Run to start again\.$/);
        });
    });

    describe('when the tries run out', () => {
        it('a fourth failure in a row stops the bot with the message', async () => {
            const failure = { code: 'InternalServerError' };
            const socket = await startBot([failure, failure, failure, failure]);
            await tickUntil(socket, () => stops.length === 1);
            expect(socket.buys()).toHaveLength(4);
            expect(stops[0]).toMatch(/^Bot stopped: .*\. Press Run to start again\.$/);
            await keepTicking(socket);
            expect(socket.buys()).toHaveLength(4);
            expect(api_base.is_running).toBe(false);
            expect(dbot.is_bot_running).toBe(false);
        });

        it('Rate limit gets longer waits, still inside the 60 s', async () => {
            const failure = { code: 'RateLimit' };
            const socket = await startBot([failure, failure, failure, failure]);
            await tickUntil(socket, () => socket.buys().length === 2);
            expect(waits).toContain(5000);
        });
    });

    describe('errors that are not recoverable stop at once, with the message', () => {
        it.each([
            'InsufficientBalance',
            'MarketIsClosed',
            'OfferingsValidationError',
            'TradingDurationNotAllowed',
            'AuthorizationRequired',
            'ClientUnwelcome',
            'DailyLossLimitExceeded',
            'SomeCodeNobodyHasSeen',
        ])('%s', async code => {
            const socket = await startBot([{}, { code }]);
            await trade(socket, LOSS);
            await tickUntil(socket, () => stops.length === 1);
            await keepTicking(socket);
            expect(socket.buys()).toHaveLength(2);
            expect(socket.checks()).toHaveLength(0);
            expect(stops[0]).toMatch(/^Bot stopped: .*\. Press Run to start again\.$/);
            expect(api_base.is_running).toBe(false);
        });
    });

    it('"Restart last trade on error" switched off: stops instead of retrying', async () => {
        const socket = await startBot([{ code: 'InternalServerError' }], { restart_on_error: false });
        await tickUntil(socket, () => stops.length === 1);
        expect(socket.buys()).toHaveLength(1);
    });

    describe('while it waits to try again', () => {
        const holdRetries = () => {
            const held = [];
            global.setTimeout.mockImplementation((fn, ms, ...args) => {
                if (ms >= 1000 && ms < 10000) {
                    held.push(fn);
                    return 0;
                }
                return real_setTimeout(fn, ms, ...args);
            });
            return held;
        };

        it('Stop ends it: nothing more is bought', async () => {
            const held = holdRetries();
            const socket = await startBot([{ code: 'InternalServerError' }]);
            await tickUntil(socket, () => held.length === 1);
            await dbot.stopBot();
            held[0]();
            await keepTicking(socket);
            expect(socket.buys()).toHaveLength(1);
        });

        it('a new connection ends it: bots never run on by themselves after a reconnect', async () => {
            const held = holdRetries();
            const socket = await startBot([{ code: 'InternalServerError' }]);
            await tickUntil(socket, () => held.length === 1);
            const new_socket = makeSocket();
            api_base.api = new_socket;
            held[0]();
            await keepTicking(socket);
            expect(socket.buys()).toHaveLength(1);
            expect(new_socket.buys()).toHaveLength(0);
            expect(new_socket.checks()).toHaveLength(0);
            api_base.api = socket;
        });
    });

    it('a strategy buying from proposals gets fresh ones before the next try', async () => {
        window.Blockly.derivWorkspace.getAllBlocks = () => [{ type: 'payout', parentBlock_: {} }];
        const socket = await startBot([{ code: 'InvalidContractProposal' }]);
        await tickUntil(socket, () => socket.buys().length === 2);
        expect(socket.buys()[1].buy).not.toBe(socket.buys()[0].buy);
    });
});
