import { observer } from '@/external/bot-skeleton';
import { flushUi, pendingUiJobs } from '@/utils/ui-queue';
import RootStore from '../root-store';
import RunPanelStore from '../run-panel-store';

const makeStore = () => {
    const calls: string[] = [];
    const transactions = { onBotContractEvent: jest.fn(() => calls.push('transactions')) };
    const summary_card = {
        onBotContractEvent: jest.fn(() => calls.push('summary')),
        clearContractUpdateConfigValues: jest.fn(),
        clear: jest.fn(),
    };
    const journal = {
        onNotify: jest.fn(() => calls.push('journal notify')),
        onLogSuccess: jest.fn(() => calls.push('journal log')),
    };
    const root = { dbot: {}, summary_card, transactions, journal } as unknown as RootStore;
    const core = {
        client: { loginid: 'CR1' },
        ui: { setAccountSwitcherDisabledMessage: jest.fn() },
        common: { is_socket_opened: false },
    } as unknown as ConstructorParameters<typeof RunPanelStore>[1];
    const store = new RunPanelStore(root, core);
    return { store, calls, transactions, journal };
};

describe('run panel: per-trade UI after the engine (utils/ui-queue.ts)', () => {
    afterEach(() => {
        flushUi();
        observer.unregisterAll('bot.contract');
        observer.unregisterAll('contract.status');
        observer.unregisterAll('bot.stop');
        observer.unregisterAll('bot.trade_again');
        observer.unregisterAll('bot.running');
        observer.unregisterAll('ui.log.notify');
        observer.unregisterAll('ui.log.success');
        observer.unregisterAll('ui.log.error');
    });

    it('a contract update reaches Transactions / Summary / the stage only after the engine is done with it', () => {
        const { store, calls } = makeStore();
        store.registerBotListeners();
        observer.emit('bot.contract', { is_sold: 1 });
        observer.emit('contract.status', { id: 'contract.sold' });
        expect(calls).toEqual([]); // nothing on the trade path
        expect(pendingUiJobs()).toBe(4);
        flushUi();
        expect(calls).toEqual(['summary', 'transactions']);
        expect(store.contract_stage).toBe(6); // CONTRACT_CLOSED
    });

    it('Journal lines (Notify blocks, results) are deferred too, in order', () => {
        const { store, calls } = makeStore();
        store.onMount();
        observer.emit('ui.log.notify', { message: 'n' });
        observer.emit('ui.log.success', { log_type: 'profit', extra: {} });
        expect(calls).toEqual([]);
        flushUi();
        expect(calls).toEqual(['journal notify', 'journal log']);
    });

    it('a bot stop first lets the queued results in: the order of events is unchanged', () => {
        const { store, calls } = makeStore();
        store.registerBotListeners();
        observer.emit('bot.contract', { is_sold: 1 });
        observer.emit('contract.status', { id: 'contract.sold' });
        store.has_open_contract = true;
        observer.emit('bot.stop');
        // The queued updates ran first, then the stop - exactly the order of the events.
        expect(calls).toEqual(['summary', 'transactions']);
        expect(pendingUiJobs()).toBe(0);
        expect(store.has_open_contract).toBe(false);
    });

    it('trade again (every trade) does not run the queued UI on the trade path; trade again = false does', () => {
        const { store, calls } = makeStore();
        (store as unknown as { stopBot: () => void }).stopBot = () => calls.push('stopBot');
        store.registerBotListeners();
        observer.emit('bot.contract', { is_sold: 1 });
        observer.emit('bot.trade_again', true);
        observer.emit('bot.running');
        expect(calls).toEqual([]);
        observer.emit('bot.trade_again', false);
        expect(calls).toEqual(['summary', 'transactions', 'stopBot']);
    });
});
