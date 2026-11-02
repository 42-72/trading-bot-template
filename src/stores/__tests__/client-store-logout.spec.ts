import { CONN_LOG_KEY, logConnEvent, readConnLog } from '@/utils/connection-log';
import ClientStore from '../client-store';
import RootStore from '../root-store';

jest.mock('@/external/bot-skeleton', () => {
    const { observer } = jest.requireActual('@/external/bot-skeleton/utils/observer');
    return { observer };
});
jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({ api_base: { is_running: false } }));
jest.mock('@/external/bot-skeleton/services/api/appId', () => ({ clearDerivApiInstance: jest.fn() }));
jest.mock('@/services/derivws-accounts.service', () => ({
    DerivWSAccountsService: { clearStoredAccounts: jest.fn(), clearCache: jest.fn() },
}));
// jsdom has no document.domain for the cookie clean-up.
jest.mock('@/components/shared/utils/storage/storage', () => ({ removeCookies: jest.fn() }));
jest.mock('@/services/oauth-token-exchange.service', () => ({
    OAuthTokenExchangeService: { clearAuthInfo: jest.fn() },
}));

describe('ClientStore.logout and the connection log', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it('logout clears the session but never the connection log - and logs why, and from where', async () => {
        logConnEvent('socket_close', 'code 1006');
        localStorage.setItem('active_loginid', 'VRTC1');
        sessionStorage.setItem('auth_info', '{}');
        const client = new ClientStore({} as RootStore);

        await client.logout('InvalidToken on balance', 'CoreStoreProvider.tsx handleMessages');

        expect(localStorage.getItem('active_loginid')).toBeNull();
        expect(sessionStorage.getItem('auth_info')).toBeNull();
        expect(localStorage.getItem(CONN_LOG_KEY)).not.toBeNull();
        const [before, logout] = readConnLog();
        expect(before.e).toBe('socket_close');
        expect(logout.e).toBe('logout');
        expect(logout.d).toBe('InvalidToken on balance (CoreStoreProvider.tsx handleMessages)');
    });
});
