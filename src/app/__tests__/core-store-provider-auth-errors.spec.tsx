import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { render } from '@testing-library/react';
import CoreStoreProvider from '../CoreStoreProvider';

let mockMessageListener: ((message: unknown) => void) | null = null;
const mockApi = {
    onMessage: () => ({
        subscribe: (listener: (message: unknown) => void) => {
            mockMessageListener = listener;
            return { unsubscribe: jest.fn() };
        },
    }),
};

jest.mock('@/external/bot-skeleton', () => ({
    api_base: { api: null, account_info: {}, reportAuthError: jest.fn() },
}));
jest.mock('@/hooks/useApiBase', () => ({
    useApiBase: () => ({
        isAuthorizing: false,
        isAuthorized: true,
        connectionStatus: 'opened',
        accountList: [],
        activeLoginid: 'VRTC1',
    }),
}));
jest.mock('@/hooks/useStore', () => ({ useStore: jest.fn() }));
jest.mock('@deriv-com/translations', () => ({ useTranslations: () => ({ currentLang: 'EN' }) }));
jest.mock('@/components/shared', () => ({ toMoment: jest.fn() }));
jest.mock('@/components/shared/constants/form-error-messages', () => ({ FORM_ERROR_MESSAGES: () => ({}) }));
jest.mock('@/components/shared/utils/validation/declarative-validation-rules', () => ({
    initFormErrorMessages: jest.fn(),
}));

const authError = { data: { msg_type: 'balance', error: { code: 'AuthorizationRequired' } } };

const setup = () => {
    const client = { logout: jest.fn(() => Promise.resolve()), setIsLoggedIn: jest.fn() };
    (useStore as jest.Mock).mockReturnValue({ client, common: { setCurrentLanguage: jest.fn() } });
    (api_base as unknown as { api: unknown }).api = mockApi;
    render(
        <CoreStoreProvider>
            <div />
        </CoreStoreProvider>
    );
    return client;
};

describe('CoreStoreProvider - an auth error on a message', () => {
    beforeEach(() => {
        localStorage.clear();
        mockMessageListener = null;
        (api_base.reportAuthError as jest.Mock).mockClear();
    });

    it('never logs out here - hands the error, and the socket it came from, to api_base', async () => {
        const client = setup();
        await mockMessageListener?.(authError);
        expect(client.logout).not.toHaveBeenCalled();
        expect(api_base.reportAuthError).toHaveBeenCalledWith(
            'AuthorizationRequired',
            'CoreStoreProvider balance',
            mockApi
        );
    });
});
