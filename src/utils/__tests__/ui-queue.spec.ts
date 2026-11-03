import { afterUi, deferUi, flushUi, pendingUiJobs } from '../ui-queue';

describe('ui-queue (UI work after the engine)', () => {
    afterEach(() => flushUi());

    it('runs deferred listeners later, in the order the events came', async () => {
        const seen: string[] = [];
        const a = deferUi((x: string) => seen.push(`a:${x}`));
        const b = deferUi((x: string) => seen.push(`b:${x}`));
        a('1');
        b('2');
        a('3');
        expect(seen).toEqual([]); // nothing inside the event itself
        expect(pendingUiJobs()).toBe(3);
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(seen).toEqual(['a:1', 'b:2', 'a:3']);
    });

    it('lets queued work catch up before a synchronous listener (afterUi), keeping the order', () => {
        const seen: string[] = [];
        const ui = deferUi(() => seen.push('contract sold'));
        const stop = afterUi(() => seen.push('bot stopped'));
        ui();
        stop();
        expect(seen).toEqual(['contract sold', 'bot stopped']);
    });

    it('one failing UI update never stops the others', () => {
        const seen: string[] = [];
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        deferUi(() => {
            throw new Error('boom');
        })();
        deferUi(() => seen.push('still runs'))();
        flushUi();
        expect(seen).toEqual(['still runs']);
    });
});
