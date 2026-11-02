import { act } from 'react';
import { generateOAuthURL } from '@/components/shared';
import { session_status } from '@/utils/session-status';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SessionNotice from '../session-notice';

jest.mock('@/components/shared', () => ({ generateOAuthURL: jest.fn(() => Promise.resolve('')) }));
jest.mock('@deriv-com/translations', () => ({ localize: (text: string) => text }));

describe('SessionNotice', () => {
    beforeEach(() => {
        act(() => {
            session_status.setReconnecting(false);
            session_status.notice = null;
        });
    });

    it('shows nothing normally', () => {
        render(<SessionNotice />);
        expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows "Reconnecting…" while retrying, and hides it once reconnected', () => {
        render(<SessionNotice />);
        act(() => session_status.setReconnecting(true));
        expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
        act(() => session_status.setReconnecting(false));
        expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();
    });

    it('"Connection lost – bot stopped" can be dismissed', () => {
        render(<SessionNotice />);
        act(() => session_status.setNotice('connection_lost'));
        expect(screen.getByRole('alert')).toHaveTextContent('Connection lost – bot stopped');
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('"Session expired – log in again" stays, and only redirects when clicked', async () => {
        render(<SessionNotice />);
        act(() => session_status.setNotice('session_expired'));
        expect(screen.getByRole('alert')).toHaveTextContent('Session expired – log in again');
        expect(generateOAuthURL).not.toHaveBeenCalled();

        act(() => {
            session_status.dismissNotice();
            session_status.setNotice('connection_lost');
        });
        expect(screen.getByRole('alert')).toHaveTextContent('Session expired – log in again');

        fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
        await waitFor(() => expect(generateOAuthURL).toHaveBeenCalledTimes(1));
    });
});
