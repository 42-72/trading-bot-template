import { isAiScannerEnabled } from '../ai-scanner-switch';

const KEY = 'ct_ai_scanner';

// jsdom can't navigate window.location across hosts, so each test hands the
// switch a page of its own: an address bar we can read back.
const visit = (href: string) => {
    const url = new URL(href);
    return {
        get href() {
            return url.href;
        },
        replaceUrl: (next: string) => {
            const replaced = new URL(next, url.origin);
            url.pathname = replaced.pathname;
            url.search = replaced.search;
            url.hash = replaced.hash;
        },
    };
};

describe('isAiScannerEnabled', () => {
    beforeEach(() => localStorage.clear());

    afterEach(() => jest.restoreAllMocks());

    it('is off by default on production', () => {
        expect(isAiScannerEnabled(visit('https://charlestraders.com/dashboard'))).toBe(false);
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('?ai=on turns it on, remembers it and removes the parameter from the address bar', () => {
        const location = visit('https://charlestraders.com/dashboard?account=USD&ai=on#bot');
        expect(isAiScannerEnabled(location)).toBe(true);
        expect(localStorage.getItem(KEY)).toBe('1');
        expect(location.href).toBe('https://charlestraders.com/dashboard?account=USD#bot');

        // Later visits without the parameter stay on.
        expect(isAiScannerEnabled(visit('https://charlestraders.com/dashboard'))).toBe(true);
    });

    it('?ai=off removes it', () => {
        localStorage.setItem(KEY, '1');
        const location = visit('https://charlestraders.com/?ai=off');
        expect(isAiScannerEnabled(location)).toBe(false);
        expect(localStorage.getItem(KEY)).toBeNull();
        expect(location.href).toBe('https://charlestraders.com/');
    });

    it('ignores any other value of ?ai and leaves it in the URL', () => {
        const location = visit('https://charlestraders.com/?ai=yes');
        expect(isAiScannerEnabled(location)).toBe(false);
        expect(location.href).toBe('https://charlestraders.com/?ai=yes');
    });

    it.each(['ai-scanner.charlestraders-bot.pages.dev', 'f534e025.charlestraders-bot.pages.dev'])(
        'is always on on the %s preview',
        host => {
            expect(isAiScannerEnabled(visit(`https://${host}/`))).toBe(true);
            expect(isAiScannerEnabled(visit(`https://${host}/?ai=off`))).toBe(true);
            expect(localStorage.getItem(KEY)).toBeNull();
        }
    );

    it('is not on for other pages.dev hosts', () => {
        expect(isAiScannerEnabled(visit('https://charlestraders-bot.pages.dev.evil.example/'))).toBe(false);
        expect(isAiScannerEnabled(visit('https://someone-else.pages.dev/'))).toBe(false);
    });

    it('stays off when storage fails', () => {
        const page = visit('https://charlestraders.com/?ai=on');
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceeded');
        });
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });
        expect(isAiScannerEnabled(page)).toBe(false);
    });
});
