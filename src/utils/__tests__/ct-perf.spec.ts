import { ct_perf, OUR_DELAY_THRESHOLD_MS, summarise } from '../ct-perf';

describe('ct-perf', () => {
    let clock = 0;
    let now_spy: jest.SpyInstance;

    beforeEach(() => {
        clock = 1000;
        now_spy = jest.spyOn(performance, 'now').mockImplementation(() => clock);
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'table').mockImplementation(() => undefined);
        ct_perf.reset();
        ct_perf.busy.clear();
        ct_perf.subs.clear();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        now_spy.mockRestore();
    });

    it('summarises count, average, p95 and max', () => {
        expect(summarise([])).toEqual({ count: 0, avg: 0, p95: 0, max: 0 });
        const values = Array.from({ length: 100 }, (_, i) => i + 1);
        expect(summarise(values)).toEqual({ count: 100, avg: 51, p95: 95, max: 100 });
    });

    it('splits result -> next buy into tick waits and our own time', () => {
        ct_perf.resultIn();
        clock += 40;
        ct_perf.resultRecorded();
        ct_perf.watchSettled('during', 900, false);
        ct_perf.watchSettled('before', 1000, false);
        clock += 1960;
        ct_perf.botTick();
        clock += 10;
        ct_perf.buyCalled('normal');
        clock += 2;
        ct_perf.buySent();
        clock += 350;
        ct_perf.buyConfirmed();

        expect(ct_perf.series.result_handling).toEqual([40]);
        expect(ct_perf.series.result_to_buy).toEqual([2012]);
        expect(ct_perf.series.ours).toEqual([112]);
        expect(ct_perf.series.pre_send).toEqual([2]);
        expect(ct_perf.series.tick_to_buy).toEqual([12]);
        expect(ct_perf.series.buy).toEqual([350]);
        expect(ct_perf.trade_no).toBe(1);
        expect(ct_perf.delayed).toHaveLength(0);
    });

    it('flags a trade delayed by more than the threshold on our side, with the reason', () => {
        ct_perf.resultIn();
        ct_perf.time('Transactions saved to sessionStorage', () => {
            clock += OUR_DELAY_THRESHOLD_MS + 100;
        });
        ct_perf.resultRecorded();
        ct_perf.watchSettled('before', 0, true);
        ct_perf.buyCalled('fast');
        ct_perf.buySent();

        expect(ct_perf.delayed).toHaveLength(1);
        expect(ct_perf.delayed[0].mode).toBe('fast');
        expect(ct_perf.delayed[0].reasons[0]).toContain('recording the result took');
        // Released by the fast pass, not by a tick.
        expect(ct_perf.series.tick_to_buy).toEqual([]);
        expect(ct_perf.sections['Transactions saved to sessionStorage'].count).toBe(1);
    });

    it("does not count Fast's minimum gap as our delay", () => {
        ct_perf.resultIn();
        ct_perf.designWait(400);
        clock += 410;
        ct_perf.buyCalled('fast');
        ct_perf.buySent();
        expect(ct_perf.series.ours).toEqual([10]);
    });

    it('counts a retried buy once, and its retries', () => {
        ct_perf.buyCalled('normal');
        ct_perf.buySent();
        ct_perf.buySent();
        expect(ct_perf.trade_no).toBe(1);
        expect(ct_perf.counters.buy_retries).toBe(1);
    });

    it('tracks subscriptions from socket messages, and flags duplicates', () => {
        let emit: (message: { data: Record<string, unknown> }) => void = () => undefined;
        const api = {
            onMessage: () => ({ subscribe: (fn: typeof emit) => (emit = fn) }),
            connection: { addEventListener: jest.fn() },
        };
        ct_perf.watchApi(api);
        emit({ data: { msg_type: 'history', echo_req: { ticks_history: 'R_100' }, subscription: { id: 'a' } } });
        emit({ data: { msg_type: 'tick', tick: { symbol: 'R_100' }, subscription: { id: 'a' } } });
        emit({ data: { msg_type: 'history', echo_req: { ticks_history: 'R_100' }, subscription: { id: 'b' } } });
        emit({ data: { msg_type: 'balance', echo_req: { balance: 1 }, subscription: { id: 'c' } } });
        emit({ data: { msg_type: 'tick', error: { code: 'AlreadySubscribed' }, echo_req: { ticks_history: 'R_50' } } });

        const ticks = ct_perf.subscriptions().find(s => s.type === 'ticks');
        expect(ticks).toEqual({ type: 'ticks', key: 'R_100', count: 2, msgs: 3, duplicate: true });
        expect(ct_perf.counters.already_subscribed).toBe(1);

        emit({ data: { msg_type: 'forget', forget: 1, echo_req: { forget: 'b' } } });
        emit({ data: { msg_type: 'forget_all', forget_all: ['a'], echo_req: { forget_all: 'ticks' } } });
        expect(ct_perf.subscriptions()).toEqual([{ type: 'balance', key: '', count: 1, msgs: 1, duplicate: false }]);
    });

    it('warns when forget_all ticks is sent while a run is busy', () => {
        ct_perf.requestSent({ forget_all: 'ticks' });
        expect(ct_perf.counters.forget_all_ticks_while_busy).toBe(0);
        ct_perf.setBusy('bot', true);
        ct_perf.requestSent({ forget_all: 'ticks' });
        ct_perf.requestSent({ forget_all: 'proposal' });
        expect(ct_perf.counters.forget_all_ticks_while_busy).toBe(1);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('forget_all ticks sent while a run is busy'));
    });

    it('reports loaders and returns the summary', () => {
        const hide = ct_perf.loaderShown('Loading...');
        clock += 250;
        hide();
        const summary = ct_perf.report();
        expect(summary.loaders.slice(-1)[0]).toMatchObject({ loader: 'Loading...', visible_ms: 250 });
        expect(summary.timings).toHaveLength(8);
    });
});
