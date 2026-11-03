import LZString from 'lz-string';
import { SessionListCache } from '../session-list-cache';
import { getStoredItemsByKey } from '../session-storage';

describe('SessionListCache', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        sessionStorage.clear();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('never writes inside the change, and writes many changes once, later', () => {
        const setItem = jest.spyOn(Storage.prototype, 'setItem');
        const cache = new SessionListCache<number>({ storage_key: 'k', max_items: 10, delay_ms: 2000 });
        cache.write('CR1', [1]);
        cache.write('CR1', [2, 1]);
        cache.write('CR1', [3, 2, 1]);
        expect(setItem).not.toHaveBeenCalled();

        jest.advanceTimersByTime(2000);
        expect(setItem).toHaveBeenCalledTimes(1);
        expect(JSON.parse(sessionStorage.getItem('k') as string)).toEqual({ CR1: [3, 2, 1] });
    });

    it('keeps only the newest max_items, and other accounts as they were', () => {
        sessionStorage.setItem('k', JSON.stringify({ VRTC1: ['demo'] }));
        const cache = new SessionListCache<number>({ storage_key: 'k', max_items: 2 });
        cache.write('CR1', [5, 4, 3]);
        cache.flush();
        expect(JSON.parse(sessionStorage.getItem('k') as string)).toEqual({ VRTC1: ['demo'], CR1: [5, 4] });
    });

    it('writes at once when the page is hidden', () => {
        const cache = new SessionListCache<number>({ storage_key: 'k', max_items: 10 });
        cache.write('CR1', [1]);
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        expect(JSON.parse(sessionStorage.getItem('k') as string)).toEqual({ CR1: [1] });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    });

    it('read() includes writes not saved yet', () => {
        const cache = new SessionListCache<number>({ storage_key: 'k', max_items: 10 });
        cache.write('CR1', [7]);
        expect(cache.read('CR1')).toEqual([7]);
        expect(cache.read(undefined)).toBeUndefined();
    });

    it('reads the old LZString-compressed format', () => {
        sessionStorage.setItem('k', LZString.compress(JSON.stringify({ CR1: ['old'] })));
        const cache = new SessionListCache<string>({ storage_key: 'k', max_items: 10 });
        expect(cache.read('CR1')).toEqual(['old']);
        expect(getStoredItemsByKey('k', {})).toEqual({ CR1: ['old'] });
    });

    it('drops the oldest halves until it fits the storage quota', () => {
        const real_set = Storage.prototype.setItem;
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
            if (value.length > 30) throw new Error('QuotaExceededError');
            return real_set.call(this, key, value);
        });
        const cache = new SessionListCache<number>({ storage_key: 'k', max_items: 100 });
        cache.write('CR1', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        cache.flush();
        const saved = JSON.parse(sessionStorage.getItem('k') as string);
        expect(saved.CR1[0]).toBe(1);
        expect(JSON.stringify(saved).length).toBeLessThanOrEqual(30);
    });
});
