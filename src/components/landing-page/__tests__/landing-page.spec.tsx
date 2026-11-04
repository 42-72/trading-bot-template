import { session_status } from '@/utils/session-status';
import { act, cleanup, render, screen } from '@testing-library/react';
import LandingPage from '..';

let mock_api_base = { isAuthorizing: false, activeLoginid: '' };
let mock_store: { client: { is_account_regenerating: boolean } } | null = null;

jest.mock('@/hooks/useApiBase', () => ({ useApiBase: () => mock_api_base }));
jest.mock('@/hooks/useStore', () => ({ useStore: () => mock_store }));
jest.mock('@/hooks/useAuthActions', () => ({
    useAuthActions: () => ({ handleLogin: jest.fn(), handleSignup: jest.fn() }),
}));
jest.mock('../DigitRain', () => ({ __esModule: true, default: () => null }));
jest.mock('@/utils/boot-splash', () => ({ hideBootSplash: jest.fn() }));

describe('LandingPage', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        mock_api_base = { isAuthorizing: false, activeLoginid: '' };
        mock_store = { client: { is_account_regenerating: false } };
        session_status.setIdleLoggedOut(false);
        jest.clearAllMocks();
    });

    it('shows for a logged-out visitor, and makes the start-up splash go', () => {
        const { hideBootSplash } = require('@/utils/boot-splash');
        render(<LandingPage />);
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        expect(hideBootSplash).toHaveBeenCalledWith('landing page');
    });

    it('never flashes up during a demo <-> real switch (old account cleared, new one not in yet)', () => {
        localStorage.setItem('active_loginid', 'VRTC1');
        mock_store = { client: { is_account_regenerating: true } };
        const { container } = render(<LandingPage />);
        expect(container).toBeEmptyDOMElement();
    });

    it('stays away after an idle logout, the moment it happens and after a reload', () => {
        localStorage.setItem('active_loginid', 'CR1');
        mock_api_base = { isAuthorizing: false, activeLoginid: 'CR1' };
        const { container } = render(<LandingPage />);
        expect(container).toBeEmptyDOMElement();

        // client.logout's end state, with the flag set before it: no frame of landing page.
        act(() => session_status.setIdleLoggedOut(true));
        localStorage.clear();
        mock_api_base = { isAuthorizing: false, activeLoginid: '' };
        cleanup();
        expect(render(<LandingPage />).container).toBeEmptyDOMElement();
        expect(sessionStorage.getItem('ct_idle_logged_out')).toBe('1');
    });

    it('stays away for a logged-in trader', () => {
        localStorage.setItem('active_loginid', 'CR1');
        mock_api_base = { isAuthorizing: false, activeLoginid: 'CR1' };
        const { container } = render(<LandingPage />);
        expect(container).toBeEmptyDOMElement();
    });
});
