/**
 * The AI Scanner's engine after a reconnect (ct_session_v2), end to end
 * through the real pieces: real Blockly with the real blocks, the real
 * engine XML written with the scanner's values (utils/ai-engine-xml), the
 * real load() path, DBot, the interpreter and the trade engine. Only the
 * sockets are fake (as in dbot-reconnect-run.spec.js: a closed one never
 * answers). Asserts the buy request each strategy actually sends.
 */
import fs from 'fs';
import path from 'path';
import { readConnLog } from '@/utils/connection-log';
import { writeEngineValues } from '@/utils/ai-engine-xml';
import { setAiScannerTrade } from '@/utils/ai-scanner-trade-guard';
import { observer as globalObserver } from '../../utils/observer';
import { api_base } from '../../services/api/api-base';
import { EXECUTION_MODES, setExecutionMode } from '../../services/tradeEngine/utils/execution-mode';
import Interpreter from '../../services/tradeEngine/utils/interpreter';

jest.setTimeout(120000);

jest.mock('@deriv-com/translations', () => ({
    localize: (text, args) => (args ? text.replace(/{{(.*?)}}/g, (_, key) => String(args[key.trim()])) : text),
    Localize: () => null,
}));
jest.mock('../../utils/local-storage', () => ({
    getSavedWorkspaces: jest.fn(async () => []),
    saveWorkspaceToRecent: jest.fn(async () => {}),
}));
jest.mock('@/components/bot-notification/bot-notification', () => ({ botNotification: jest.fn() }));
jest.mock('../../services/api/api-base', () => {
    const base = {
        api: null,
        account_info: { loginid: 'VRTC1', balance: 1000, currency: 'USD' },
        token: 'VRTC1',
        pip_sizes: { R_100: 2, R_50: 4, '1HZ10V': 2 },
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
        noteBuy: jest.fn(),
    };
    return { api_base: base };
});

const ENGINE_DIR = path.join(__dirname, '../../../../assets/ai-engine');
const OVER_UNDER_XML = fs.readFileSync(path.join(ENGINE_DIR, 'bull-ai-overunder.xml'), 'utf8');
const EVEN_ODD_XML = fs.readFileSync(path.join(ENGINE_DIR, 'bull-ai-evenodd.xml'), 'utf8');

const COMMON = {
    market: 'synthetic_index',
    submarket: 'random_index',
    stake: 1,
    martingale: 2,
    take_profit: 5,
    stop_loss: 10,
};

let next_contract_id = 1;

function makeSocket(name, { buy_error } = {}) {
    const listeners = new Set();
    const connection = { readyState: 1, addEventListener() {}, removeEventListener() {} };
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
        tick(symbol) {
            epoch += 1;
            api.emit({ msg_type: 'tick', tick: { symbol, epoch, quote: 100 + (epoch % 10), id: `t-${name}` } });
        },
        send: jest.fn(request => {
            if (connection.readyState !== 1) return new Promise(() => {});
            api.sent.push(request);
            if (request.ticks_history) {
                const times = [1, 2, 3, 4, 5].map(i => epoch - 5 + i);
                return Promise.resolve({ history: { times, prices: times.map(() => 100) } });
            }
            if (request.buy) {
                if (buy_error) return Promise.reject({ error: buy_error, echo_req: request });
                const contract_id = next_contract_id++;
                return Promise.resolve({
                    buy: { contract_id, transaction_id: contract_id * 10, buy_price: request.price },
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

const tickUntil = async (socket, symbol, condition) => {
    for (let i = 0; i < 80 && !condition(); i++) {
        socket.tick(symbol);
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 25));
    }
};

let dbot;
let workspace;
let load;

/** What the AI Scanner does at its entry (pressRun): load its engine with the winner's values, then Run. */
const loadEngine = async (xml, values) => {
    await load({
        block_string: writeEngineValues(xml, values),
        drop_event: {},
        file_name: 'AI engine',
        strategy_id: 'ai-engine-test',
        from: 'unsaved',
        workspace,
        showIncompatibleStrategyDialog: false,
    });
    workspace.current_strategy_id = 'ai-engine-test';
    await flush(30);
    // dbot's SYMBOL_LIST handler, when the engine's market differs from the one watched:
    if (dbot.interpreter.bot.tradeEngine.symbol !== values.symbol) {
        dbot.symbol = values.symbol;
        await dbot.interpreter.unsubscribeFromTicksService();
        await dbot.interpreter.bot.tradeEngine.watchTicks(values.symbol);
    }
};

const runUntilBuy = async (socket, symbol) => {
    const before = socket.buys().length;
    dbot.runBot();
    await tickUntil(socket, symbol, () => socket.buys().length > before);
    return socket.buys()[before]?.parameters;
};

/** A run on A, the connection lost mid-run, a reconnect to B - the state the trader saw. */
const reconnectAfterRun = async () => {
    const a = makeSocket('A');
    api_base.api = a;
    dbot.symbol = 'R_100';
    dbot.interpreter = Interpreter();
    await dbot.interpreter.bot.tradeEngine.watchTicks('R_100');
    await loadEngine(OVER_UNDER_XML, {
        ...COMMON,
        symbol: 'R_100',
        ai_direction: 1,
        first_barrier: 2,
        recovery_barrier: 3,
    });
    await runUntilBuy(a, 'R_100');

    a.close();
    globalObserver.emit('session.connection_lost');
    api_base.setIsRunning(false);
    dbot.stopBot();
    await flush();

    const b = makeSocket('B');
    api_base.api = b;
    api_base.connection_generation += 1;
    globalObserver.emit('session.reconnected', { generation: api_base.connection_generation });
    await flush();
    return b;
};

describe('AI Scanner engine after a reconnect (ct_session_v2 on)', () => {
    beforeAll(async () => {
        const DBotStore = (await import('../dbot-store')).default;
        DBotStore.setInstance({
            client: { currency: 'USD', loginid: 'VRTC1', is_logged_in: true },
            dashboard: { setBotBuilderSymbol() {} },
            toolbar: { setHasRedoStack() {}, setHasUndoStack() {} },
            setLoading() {},
            load_modal: { setOpenButtonDisabled() {}, setLoadedLocalFile() {} },
            save_modal: { updateBotName() {} },
        });
        const { loadBlockly } = await import('../blockly');
        await loadBlockly(false);
        // Headless: no SVG rendering in jsdom.
        const block_proto = window.Blockly.Block.prototype;
        ['initSvg', 'queueRender', 'render', 'renderEfficiently', 'highlightExecutedBlock', 'unhighlightBlock'].forEach(
            method => {
                if (!block_proto[method]) block_proto[method] = () => {};
            }
        );
        workspace = new window.Blockly.Workspace();
        workspace.isDragging = () => false;
        workspace.asyncClear = async () => workspace.clear();
        ['cleanUp', 'setResizesEnabled', 'scrollCenter', 'resizeContents', 'render'].forEach(method => {
            if (!workspace[method]) workspace[method] = () => {};
        });
        window.Blockly.derivWorkspace = workspace;
        window.Blockly.accumulators_request = {};
        const names = new window.Blockly.Names('window');
        names.variableMap = workspace.getVariableMap();
        window.Blockly.JavaScript.variableDB_ = names;

        dbot = (await import('../dbot')).default;
        dbot.workspace = workspace;
        ({ load } = await import('../utils'));
    });

    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('ct_session_v2', '1');
        setExecutionMode(EXECUTION_MODES.FAST);
        api_base.is_running = false;
        api_base.is_stopping = false;
        dbot.is_bot_running = false;
        setAiScannerTrade(null);
    });

    afterEach(async () => {
        api_base.setIsRunning(false);
        await dbot.interpreter?.terminateSession?.();
        setAiScannerTrade(null);
    });

    afterAll(() => setExecutionMode(EXECUTION_MODES.NORMAL));

    it('Over: buys DIGITOVER with barrier 2 on the winning market', async () => {
        const b = await reconnectAfterRun();
        await loadEngine(OVER_UNDER_XML, {
            ...COMMON,
            symbol: 'R_50',
            ai_direction: 1,
            first_barrier: 2,
            recovery_barrier: 3,
        });
        setAiScannerTrade({ symbol: 'R_50', contract_types: ['DIGITOVER'], barriers: [2, 3] });
        const buy = await runUntilBuy(b, 'R_50');
        expect(buy).toMatchObject({ contract_type: 'DIGITOVER', barrier: 2, underlying_symbol: 'R_50', amount: 1 });
    });

    it('Under: buys DIGITUNDER with barrier 7 on the winning market', async () => {
        const b = await reconnectAfterRun();
        await loadEngine(OVER_UNDER_XML, {
            ...COMMON,
            symbol: 'R_50',
            ai_direction: 0,
            first_barrier: 7,
            recovery_barrier: 6,
        });
        setAiScannerTrade({ symbol: 'R_50', contract_types: ['DIGITUNDER'], barriers: [7, 6] });
        const buy = await runUntilBuy(b, 'R_50');
        expect(buy).toMatchObject({ contract_type: 'DIGITUNDER', barrier: 7, underlying_symbol: 'R_50', amount: 1 });
    });

    it.each([
        ['Even', 'DIGITEVEN', 1],
        ['Odd', 'DIGITODD', 0],
    ])('Even/Odd (%s): buys %s with no barrier', async (_, contract_type, ai_direction) => {
        const b = await reconnectAfterRun();
        await loadEngine(EVEN_ODD_XML, { ...COMMON, symbol: '1HZ10V', ai_direction });
        setAiScannerTrade({ symbol: '1HZ10V', contract_types: [contract_type], barriers: [] });
        const buy = await runUntilBuy(b, '1HZ10V');
        expect(buy).toMatchObject({ contract_type, underlying_symbol: '1HZ10V', amount: 1 });
        expect(buy.barrier).toBeUndefined();
    });

    it('a buy that is not the locked trade is never sent, and the log says what differed', async () => {
        const b = await reconnectAfterRun();
        await loadEngine(OVER_UNDER_XML, {
            ...COMMON,
            symbol: 'R_50',
            ai_direction: 1,
            first_barrier: 2,
            recovery_barrier: 3,
        });
        const stopped = jest.fn();
        globalObserver.register('bot.click_stop', stopped);
        setAiScannerTrade({ symbol: 'R_50', contract_types: ['DIGITUNDER'], barriers: [7, 6] });
        const before = b.buys().length;
        dbot.runBot();
        await tickUntil(b, 'R_50', () => stopped.mock.calls.length > 0);
        expect(b.buys()).toHaveLength(before);
        expect(stopped).toHaveBeenCalled();
        const [mismatch] = readConnLog().filter(entry => entry.e === 'ai_trade_mismatch');
        expect(mismatch.d).toContain('contract DIGITOVER (locked DIGITUNDER)');
        expect(mismatch.d).toContain('barrier 2 (locked 7/6)');
        globalObserver.unregisterAll('bot.click_stop');
    });

    it('a refused buy is logged with its code, message, contract, barrier and market - no account or token', async () => {
        await reconnectAfterRun();
        const c = makeSocket('C', { buy_error: { code: 'NoReturn', message: 'This contract offers no return.' } });
        api_base.api = c;
        api_base.connection_generation += 1;
        globalObserver.emit('session.reconnected', {});
        await flush();
        await loadEngine(OVER_UNDER_XML, {
            ...COMMON,
            symbol: 'R_50',
            ai_direction: 1,
            first_barrier: 2,
            recovery_barrier: 3,
        });
        dbot.runBot();
        await tickUntil(c, 'R_50', () => readConnLog().some(entry => entry.e === 'trade_error'));
        const [entry] = readConnLog().filter(item => item.e === 'trade_error');
        expect(entry.d).toBe(
            'AI Scanner buy: NoReturn "This contract offers no return." - DIGITOVER barrier 2 R_50 stake 1 1t'
        );
        expect(entry.d).not.toMatch(/VRTC|token|otp/i);
    });
});
