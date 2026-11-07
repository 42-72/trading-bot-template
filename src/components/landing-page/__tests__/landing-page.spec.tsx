import { session_status } from '@/utils/session-status';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

    it('draws the still market chart under the digits, hidden from screen readers', () => {
        const { container } = render(<LandingPage />);
        const chart = container.querySelector('.landing-page__chart');
        expect(chart).toHaveAttribute('aria-hidden', 'true');
        expect(chart?.querySelector('animate, animateTransform')).toBeNull();
    });

    it('tells the app while it is on screen, so the app keeps its loaders away', () => {
        const { unmount } = render(<LandingPage />);
        expect(session_status.is_landing_shown).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Continue without an account' }));
        expect(session_status.is_landing_shown).toBe(false);

        unmount();
        sessionStorage.clear();
        const { unmount: leave } = render(<LandingPage />);
        expect(session_status.is_landing_shown).toBe(true);
        leave();
        expect(session_status.is_landing_shown).toBe(false);
    });

    it('does not claim the screen for a logged-in trader', () => {
        localStorage.setItem('active_loginid', 'CR1');
        mock_api_base = { isAuthorizing: false, activeLoginid: 'CR1' };
        render(<LandingPage />);
        expect(session_status.is_landing_shown).toBe(false);
    });

    it('keeps the short risk bullet, and the way in without an account still works', () => {
        const { container } = render(<LandingPage />);
        expect(screen.getByText('Trade at your own risk')).toBeInTheDocument();
        expect(screen.queryByText(/Past performance/)).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Continue without an account' }));
        expect(container).toBeEmptyDOMElement();
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

    it('rule A: shows after a tab closed too long', () => {
        const { hideBootSplash } = require('@/utils/boot-splash');
        localStorage.setItem('active_loginid', 'CR1'); // a new tab: the old login's id is still there
        mock_api_base = { isAuthorizing: false, activeLoginid: '' };
        act(() => session_status.setIdleLoggedOut(true, true));
        expect(render(<LandingPage />).container).not.toBeEmptyDOMElement();
        expect(session_status.is_landing_shown).toBe(true);
        expect(hideBootSplash).toHaveBeenCalledWith('landing page');
        expect(sessionStorage.getItem('ct_idle_logged_out')).toBe('fresh_start');
    });

    it('rule A: Continue without an account still leads in', () => {
        act(() => session_status.setIdleLoggedOut(true, true));
        const { container } = render(<LandingPage />);
        fireEvent.click(screen.getByRole('button', { name: 'Continue without an account' }));
        expect(container).toBeEmptyDOMElement();
    });

    it('stays away for a logged-in trader', () => {
        localStorage.setItem('active_loginid', 'CR1');
        mock_api_base = { isAuthorizing: false, activeLoginid: 'CR1' };
        const { container } = render(<LandingPage />);
        expect(container).toBeEmptyDOMElement();
    });
});
