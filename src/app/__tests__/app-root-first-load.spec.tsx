/**
 * First load: the app opens its socket once the page is shown, whatever the
 * query string, and start-up removes the storage keys of removed features.
 */
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { markOAuthExchangeSettled, OAUTH_EXCHANGE_WAIT_MS, resetOAuthStartForTests } from '@/utils/oauth-start';
import { removeRetiredStorageKeys, RETIRED_STORAGE_KEYS } from '@/utils/page-start';
import { act, render } from '@testing-library/react';
import AppRoot from '../app-root';

jest.mock('@/external/bot-skeleton', () => ({ api_base: { api: null, init: jest.fn(() => Promise.resolve()) } }));
jest.mock('@/hooks/useStore', () => ({ useStore: jest.fn() }));
jest.mock('@/components/session-notice/session-notice', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/loader/chunk-loader', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/error-component/error-boundary', () => ({
    __esModule: true,
    default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/error-component/error-component', () => ({ __esModule: true, default: () => null }));
jest.mock('../app-content', () => ({ __esModule: true, default: () => null }));
jest.mock('@deriv-com/translations', () => ({ localize: (text: string) => text }));

const setPrerendering = (value: boolean) =>
    Object.defineProperty(document, 'prerendering', { configurable: true, get: () => value });

const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));

describe('first load', () => {
    beforeEach(() => {
        localStorage.clear();
        (api_base.init as jest.Mock).mockClear();
        (useStore as jest.Mock).mockReturnValue({ common: {} });
    });

    afterEach(() => {
        setPrerendering(false);
        window.history.replaceState({}, '', '/');
    });

    it.each(['/', '/?ctdebug=1', '/?ct_session_v2=1&ctdebug=1', '/?utm_source=x&foo=bar'])(
        '%s: the socket starts at once, the same way, and the URL is left alone',
        async url => {
            window.history.replaceState({}, '', url);
            render(<AppRoot />);
            await flush();
            expect(api_base.init).toHaveBeenCalledTimes(1);
            expect(api_base.init).toHaveBeenCalledWith();
            expect(`${window.location.pathname}${window.location.search}`).toBe(url);
        }
    );

    it('prerendered from the address bar: the socket waits until the page is shown', async () => {
        setPrerendering(true);
        render(<AppRoot />);
        await flush();
        expect(api_base.init).not.toHaveBeenCalled();

        setPrerendering(false);
        document.dispatchEvent(new Event('prerenderingchange'));
        await flush();
        expect(api_base.init).toHaveBeenCalledTimes(1);
    });
});

describe('login return (?code=...&state=...) in a fresh tab', () => {
    const api = api_base as unknown as { api: unknown };

    beforeEach(() => {
        jest.spyOn(console, 'info').mockImplementation(() => {});
        resetOAuthStartForTests();
        (api_base.init as jest.Mock).mockClear();
        (useStore as jest.Mock).mockReturnValue({ common: {} });
        api.api = null;
        window.history.replaceState({}, '', '/?code=abc&state=xyz');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        window.history.replaceState({}, '', '/');
    });

    it('opens no public socket while the token exchange runs; then uses the socket the exchange opened', async () => {
        render(<AppRoot />);
        await flush();
        expect(api_base.init).not.toHaveBeenCalled();

        // The exchange stored the login and opened the logged-in socket (api_base.init(true)).
        api.api = { connection: { readyState: 1 } };
        markOAuthExchangeSettled('token exchange done - logged-in socket opened');
        await flush();
        expect(api_base.init).not.toHaveBeenCalled();
        const lines = (console.info as jest.Mock).mock.calls.map(([line]) => String(line));
        expect(lines).toContain('[CT start] connection already opened by the token exchange - using it');
        expect(lines.join(' ')).not.toMatch(/abc|xyz/);
    });

    it('a failed exchange: connects then (public socket, logged-out page) - never waits for good', async () => {
        render(<AppRoot />);
        await flush();
        markOAuthExchangeSettled('token exchange failed (invalid_grant)');
        await flush();
        expect(api_base.init).toHaveBeenCalledTimes(1);
    });

    it('an exchange that never answers: connects anyway after the wait limit', async () => {
        jest.useFakeTimers();
        render(<AppRoot />);
        await act(() => jest.advanceTimersByTimeAsync(OAUTH_EXCHANGE_WAIT_MS - 1));
        expect(api_base.init).not.toHaveBeenCalled();
        await act(() => jest.advanceTimersByTimeAsync(1));
        expect(api_base.init).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
    });
});

describe('removeRetiredStorageKeys (start-up)', () => {
    it('deletes the connection log, its switch and the old session switch - nothing else', () => {
        localStorage.setItem('ct_conn_log', '[]');
        localStorage.setItem('ctdebug', '1');
        localStorage.setItem('ct_session_v2', '1');
        localStorage.setItem('active_loginid', 'VRTC1');
        removeRetiredStorageKeys();
        RETIRED_STORAGE_KEYS.forEach(key => expect(localStorage.getItem(key)).toBeNull());
        expect(RETIRED_STORAGE_KEYS).toEqual(['ct_conn_log', 'ctdebug', 'ct_session_v2']);
        expect(localStorage.getItem('active_loginid')).toBe('VRTC1');
    });
});
