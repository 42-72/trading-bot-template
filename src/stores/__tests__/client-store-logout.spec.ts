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

describe('ClientStore.logout', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it('clears the stored login and the session', async () => {
        localStorage.setItem('active_loginid', 'VRTC1');
        sessionStorage.setItem('auth_info', '{}');
        const client = new ClientStore({} as RootStore);

        await client.logout();

        expect(localStorage.getItem('active_loginid')).toBeNull();
        expect(sessionStorage.getItem('auth_info')).toBeNull();
    });
});
