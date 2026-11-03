import { DerivWSAccountsService, DerivWSRequestError } from '@/services/derivws-accounts.service';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { readConnLog } from '@/utils/connection-log';
import { SessionExpiredError } from '@/utils/session-status';
import { getSocketURL } from '../config';

jest.mock('@/services/oauth-token-exchange.service', () => ({
    OAuthTokenExchangeService: { getAuthInfo: jest.fn() },
}));
jest.mock('@/services/derivws-accounts.service', () => {
    class MockDerivWSRequestError extends Error {
        status: number;
        constructor(message: string, status: number) {
            super(message);
            this.status = status;
        }
    }
    return {
        DerivWSRequestError: MockDerivWSRequestError,
        DerivWSAccountsService: { getAuthenticatedWebSocketURL: jest.fn() },
    };
});

const mockGetURL = DerivWSAccountsService.getAuthenticatedWebSocketURL as jest.Mock;
const mockGetAuthInfo = OAuthTokenExchangeService.getAuthInfo as jest.Mock;

describe('getSocketURL', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        mockGetAuthInfo.mockReturnValue({ access_token: 'token', expires_at: Date.now() + 3600000 });
    });

    afterEach(() => jest.restoreAllMocks());

    it('not logged in: the public socket', async () => {
        mockGetAuthInfo.mockReturnValue(null);
        expect(await getSocketURL()).toMatch(/\/public$/);
    });

    it('logged in: the URL with the one-time code', async () => {
        mockGetURL.mockResolvedValue('wss://example.com/ws?otp=abc');
        expect(await getSocketURL()).toBe('wss://example.com/ws?otp=abc');
    });

    it('OTP request fails: no fallback to the public socket - the error goes to the retry', async () => {
        mockGetURL.mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(getSocketURL()).rejects.toThrow('Failed to fetch');
        expect(readConnLog().map(entry => entry.e)).toContain('socket_url_failed');
    });

    it('OTP request answered 401: a genuine expiry', async () => {
        mockGetURL.mockRejectedValue(new DerivWSRequestError('Failed to fetch OTP: 401', 401));
        await expect(getSocketURL()).rejects.toBeInstanceOf(SessionExpiredError);
    });

    it('any other HTTP error is retried, not an expiry', async () => {
        mockGetURL.mockRejectedValue(new DerivWSRequestError('Failed to fetch OTP: 503', 503));
        const error = await getSocketURL().catch(e => e);
        expect(error).not.toBeInstanceOf(SessionExpiredError);
    });
});
