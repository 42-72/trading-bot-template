/**
 * First load of a link with a query string (e.g. charlestraders.com/?ctdebug=1)
 * typed into the address bar. Chrome may prerender such a page before Enter is
 * pressed; a prerendered page does not see the tab's sessionStorage (its login),
 * so a socket opened then starts logged out: page_load "no auth_info;
 * active_loginid set" -> public socket -> authorize_skipped. The app must not
 * open its socket until the page is shown, and then load exactly like a plain URL.
 */
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { readConnLog } from '@/utils/connection-log';
import { isConnDebugEnabled, startSessionDiagnostics } from '@/utils/session-flags';
import { act, render } from '@testing-library/react';
import AppRoot from '../app-root';

jest.mock('@/external/bot-skeleton', () => ({ api_base: { init: jest.fn(() => Promise.resolve()) } }));
jest.mock('@/hooks/useStore', () => ({ useStore: jest.fn() }));
jest.mock('@/components/connection-log/connection-log', () => ({ __esModule: true, default: () => null }));
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

describe('first load of ?ctdebug=1', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        (api_base.init as jest.Mock).mockClear();
        (useStore as jest.Mock).mockReturnValue({ common: {} });
        localStorage.setItem('active_loginid', 'VRTC1');
    });

    afterEach(() => {
        setPrerendering(false);
        window.history.replaceState({}, '', '/');
    });

    it('prerendered from the address bar: the socket waits until the page is shown, which then has the login', async () => {
        window.history.replaceState({}, '', '/?ctdebug=1');
        setPrerendering(true);
        startSessionDiagnostics();
        render(<AppRoot />);
        await flush();

        expect(api_base.init).not.toHaveBeenCalled();
        expect(readConnLog().find(entry => entry.e === 'page_load')?.d).toMatch(
            /no auth_info; active_loginid set; prerendering - start-up waits until shown/
        );

        // Shown: the tab's sessionStorage (with the login) is now the page's.
        sessionStorage.setItem('auth_info', JSON.stringify({ access_token: 'x', expires_at: Date.now() + 3600000 }));
        setPrerendering(false);
        document.dispatchEvent(new Event('prerenderingchange'));
        await flush();

        expect(api_base.init).toHaveBeenCalledTimes(1);
        expect(readConnLog().find(entry => entry.e === 'page_activated')?.d).toMatch(/auth_info, expires in \d+ min/);
        expect(isConnDebugEnabled()).toBe(true);
        expect(window.location.search).toBe('');
        expect(
            readConnLog()
                .map(entry => entry.d ?? '')
                .join(' ')
        ).not.toContain('"x"');
    });

    it('not prerendered: ?ctdebug=1 starts exactly like the plain URL', async () => {
        window.history.replaceState({}, '', '/?ctdebug=1');
        startSessionDiagnostics();
        render(<AppRoot />);
        await flush();
        expect(api_base.init).toHaveBeenCalledTimes(1);
        expect(api_base.init).toHaveBeenCalledWith();
        expect(window.location.search).toBe('');
    });

    it('the plain URL starts at once', async () => {
        startSessionDiagnostics();
        render(<AppRoot />);
        await flush();
        expect(api_base.init).toHaveBeenCalledTimes(1);
    });
});
