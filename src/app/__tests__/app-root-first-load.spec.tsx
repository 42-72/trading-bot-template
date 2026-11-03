/**
 * First load: the app opens its socket once the page is shown, whatever the
 * query string, and start-up removes the storage keys of removed features.
 */
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { removeRetiredStorageKeys, RETIRED_STORAGE_KEYS } from '@/utils/page-start';
import { act, render } from '@testing-library/react';
import AppRoot from '../app-root';

jest.mock('@/external/bot-skeleton', () => ({ api_base: { init: jest.fn(() => Promise.resolve()) } }));
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
