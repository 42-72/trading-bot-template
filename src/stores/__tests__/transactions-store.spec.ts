import RootStore from '../root-store';
import TransactionsStore from '../transactions-store';

const makeStore = () => {
    const core = { client: { loginid: 'CR1' } } as unknown as RootStore['core'];
    return new TransactionsStore({ run_panel: { run_id: 'run-1' } } as unknown as RootStore, core);
};
const poc = (buy: number, extra = {}) =>
    ({ transaction_ids: { buy }, contract_id: buy, buy_price: 1, date_start: 1730000000, ...extra }) as never;

describe('TransactionsStore.pushTransaction', () => {
    it('adds a new contract on top, and updates a known one in place', () => {
        const store = makeStore();
        store.pushTransaction(poc(1));
        store.pushTransaction(poc(2));
        store.pushTransaction(poc(1, { is_sold: 1, status: 'won', sell_price: 1.95, profit: 0.95 }));
        const contracts = store.transactions.filter(t => t.type === 'contract');
        expect(contracts.map(t => (t.data as { transaction_ids: { buy: number } }).transaction_ids.buy)).toEqual([
            2, 1,
        ]);
        expect((contracts[1].data as { profit: number }).profit).toBe(0.95);
    });

    it('finds contracts of a list it did not build itself (restored), and starts over after Reset', () => {
        const store = makeStore();
        store.elements = { CR1: [{ type: 'contract', data: poc(7) as never }] };
        store.pushTransaction(poc(7, { is_sold: 1, status: 'lost', sell_price: 0, profit: -1 }));
        expect(store.transactions.filter(t => t.type === 'contract')).toHaveLength(1);

        store.clear();
        store.pushTransaction(poc(7));
        expect(store.transactions.filter(t => t.type === 'contract')).toHaveLength(1);
    });
});
