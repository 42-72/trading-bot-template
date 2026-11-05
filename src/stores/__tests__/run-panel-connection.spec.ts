import { botNotification } from '@/components/bot-notification/bot-notification';
import { observer } from '@/external/bot-skeleton';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import RootStore from '../root-store';
import RunPanelStore from '../run-panel-store';

jest.mock('@/components/bot-notification/bot-notification', () => ({ botNotification: jest.fn() }));

// Pressing Run: the bot starts only on a socket known to be alive.
const makeStore = () => {
    const dbot = {
        saveRecentWorkspace: jest.fn(),
        unHighlightAllBlocks: jest.fn(),
        shouldRunBot: jest.fn(() => true),
        runBot: jest.fn(),
        refreshEngineForNewConnection: jest.fn(async () => undefined),
        getStrategySounds: jest.fn(() => []),
    };
    const root = {
        dbot,
        summary_card: { clear: jest.fn(), onBotContractEvent: jest.fn() },
        transactions: { onBotContractEvent: jest.fn() },
        journal: { pushMessage: jest.fn() },
    } as unknown as RootStore;
    const core = {
        client: { loginid: 'VRTC1', is_logged_in: true },
        ui: { setAccountSwitcherDisabledMessage: jest.fn(), setPromptHandler: jest.fn() },
        common: { is_socket_opened: false },
    } as unknown as ConstructorParameters<typeof RunPanelStore>[1];
    return { store: new RunPanelStore(root, core), dbot };
};

describe('Run on a socket that may be dead', () => {
    let isFresh: jest.SpyInstance;
    let ensure: jest.SpyInstance;

    beforeEach(() => {
        isFresh = jest.spyOn(api_base, 'isConnectionFresh').mockReturnValue(false);
        ensure = jest.spyOn(api_base, 'ensureConnection').mockResolvedValue(true);
        (botNotification as jest.Mock).mockClear();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        ['bot.running', 'bot.stop', 'bot.click_stop', 'Error', 'ui.log.error'].forEach(name =>
            observer.unregisterAll(name)
        );
    });

    it('a healthy socket: starts at once, with no check at all', async () => {
        isFresh.mockReturnValue(true);
        const { store, dbot } = makeStore();
        store.onRunButtonClick();
        expect(dbot.runBot).toHaveBeenCalledTimes(1); // synchronously: Run is exactly as fast as before
        expect(ensure).not.toHaveBeenCalled();
    });

    it('otherwise it checks first, and only then starts', async () => {
        let finishCheck: (is_ready: boolean) => void = () => undefined;
        ensure.mockReturnValue(new Promise(resolve => (finishCheck = resolve)));
        const { store, dbot } = makeStore();
        const run = store.onRunButtonClick();
        expect(dbot.runBot).not.toHaveBeenCalled();
        finishCheck(true);
        await run;
        expect(dbot.runBot).toHaveBeenCalledTimes(1);
    });

    it('after a reconnect it starts only once the engine is on the new socket', async () => {
        let finishRefresh: () => void = () => undefined;
        const { store, dbot } = makeStore();
        dbot.refreshEngineForNewConnection.mockReturnValue(new Promise<void>(resolve => (finishRefresh = resolve)));
        const run = store.onRunButtonClick();
        await Promise.resolve();
        await Promise.resolve();
        expect(dbot.runBot).not.toHaveBeenCalled();
        finishRefresh();
        await run;
        expect(dbot.runBot).toHaveBeenCalledTimes(1);
    });

    it('Run pressed twice during the check starts one bot', async () => {
        const { store, dbot } = makeStore();
        await Promise.all([store.onRunButtonClick(), store.onRunButtonClick()]);
        expect(dbot.runBot).toHaveBeenCalledTimes(1);
    });

    it("the engine's ticks arriving just after Run do not mark the bot as stopped", () => {
        const { store } = makeStore();
        store.setIsRunning(true);
        api_base.is_running = true;
        store.onBotReadyEvent();
        expect(store.is_running).toBe(true);

        api_base.is_running = false; // a real stop: the same event ends it, as before
        store.onBotReadyEvent();
        expect(store.is_running).toBe(false);
    });

    it('no connection to be had: nothing starts, and it says so', async () => {
        ensure.mockResolvedValue(false);
        const { store, dbot } = makeStore();
        await store.onRunButtonClick();
        expect(dbot.runBot).not.toHaveBeenCalled();
        expect(store.is_running).toBe(false);
        expect(botNotification).toHaveBeenCalledTimes(1);
    });
});
