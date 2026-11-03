import JournalStore, { JOURNAL_MAX_MESSAGES } from '../journal-store';
import RootStore from '../root-store';

const makeStore = () => {
    const core = {
        client: { loginid: 'CR1', account_list: [{ loginid: 'CR1', currency: 'USD' }] },
        common: { server_time: { get: () => new Date('2026-11-03T10:00:00Z') } },
    } as unknown as RootStore['core'];
    return new JournalStore({ run_panel: {} } as unknown as RootStore, core);
};

describe('JournalStore', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        sessionStorage.clear();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('never writes session storage inside a message push (the trade path)', () => {
        const store = makeStore();
        const setItem = jest.spyOn(Storage.prototype, 'setItem');
        store.pushMessage('profit', 'success', '', { currency: 'USD' });
        store.pushMessage('purchase', 'success');
        expect(setItem.mock.calls.filter(([key]) => key === 'journal_cache')).toHaveLength(0);

        jest.advanceTimersByTime(2000);
        const saved = JSON.parse(sessionStorage.getItem('journal_cache') as string);
        expect(saved.CR1[0].message).toBe('purchase');
        expect(saved.CR1[1].message).toBe('profit');
    });

    it(`keeps at most ${JOURNAL_MAX_MESSAGES} lines in memory, the newest`, () => {
        const store = makeStore();
        for (let i = 0; i < JOURNAL_MAX_MESSAGES + 5; i++) store.pushMessage(`m${i}`, 'success');
        expect(store.unfiltered_messages).toHaveLength(JOURNAL_MAX_MESSAGES);
        expect(store.unfiltered_messages[0].message).toBe(`m${JOURNAL_MAX_MESSAGES + 4}`);
    });

    it('restores the saved Journal of the account', () => {
        sessionStorage.setItem(
            'journal_cache',
            JSON.stringify({ CR1: [{ message: 'saved', message_type: 'success', unique_id: '1', extra: {} }] })
        );
        const store = makeStore();
        expect(store.unfiltered_messages.some(m => m.message === 'saved')).toBe(true);
    });
});
