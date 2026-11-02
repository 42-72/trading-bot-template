import { act } from 'react';
import { logConnEvent } from '@/utils/connection-log';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ConnectionLog from '../connection-log';

describe('ConnectionLog (hidden, ?ctdebug=1)', () => {
    beforeEach(() => localStorage.clear());

    it('is hidden unless ctdebug is on', () => {
        render(<ConnectionLog />);
        expect(screen.queryByRole('button', { name: 'Connection log' })).not.toBeInTheDocument();
    });

    it('opens a panel with the log, updates live, and copies it', async () => {
        localStorage.setItem('ctdebug', '1');
        logConnEvent('socket_close', 'code 1006 authenticated');
        const writeText = jest.fn(() => Promise.resolve());
        Object.assign(navigator, { clipboard: { writeText } });

        render(<ConnectionLog />);
        fireEvent.click(screen.getByRole('button', { name: 'Connection log' }));
        const entries = screen.getByTestId('dt_connection_log_entries');
        expect(entries).toHaveTextContent('socket_close code 1006 authenticated');

        act(() => logConnEvent('socket_open', 'authenticated'));
        expect(entries).toHaveTextContent('socket_open authenticated');

        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument());
        expect(writeText).toHaveBeenCalledWith(expect.stringContaining('socket_close  code 1006 authenticated'));
    });
});
