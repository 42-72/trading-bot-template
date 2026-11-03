import GTM from '../gtm';

describe('GTM pushes', () => {
    it('never push inside the event (Tag Manager runs its tags synchronously): in idle time', () => {
        const pushed: unknown[] = [];
        (window as unknown as { dataLayer: unknown[] }).dataLayer = { push: (d: unknown) => pushed.push(d) } as never;
        const idle_callbacks: (() => void)[] = [];
        (window as unknown as { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback = cb => {
            idle_callbacks.push(cb);
            return 1;
        };
        GTM.onTransactionClosed({ contract_id: 5 } as never);
        expect(pushed).toEqual([]);
        idle_callbacks.forEach(cb => cb());
        expect(pushed).toEqual([{ event: 'dbot_run_transaction', reference_id: 5 }]);
    });
});
