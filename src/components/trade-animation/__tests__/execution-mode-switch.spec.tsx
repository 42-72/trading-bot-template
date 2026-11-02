import { observable } from 'mobx';
import { useStore } from '@/hooks/useStore';
import { TExecutionMode } from '@/utils/execution-mode';
import { fireEvent, render, screen } from '@testing-library/react';
import ExecutionModeSwitch from '../execution-mode-switch';

jest.mock('@/hooks/useStore', () => ({ useStore: jest.fn() }));
jest.mock('@deriv-com/translations', () => ({ localize: (text: string) => text }));

const setup = ({ mode = 'normal', locked = false }: { mode?: TExecutionMode; locked?: boolean } = {}) => {
    const run_panel = observable(
        {
            execution_mode: mode,
            is_execution_mode_locked: locked,
            setExecutionMode: jest.fn(),
        },
        { setExecutionMode: false }
    );
    (useStore as jest.Mock).mockReturnValue({ run_panel });
    render(<ExecutionModeSwitch />);
    return run_panel;
};

describe('ExecutionModeSwitch', () => {
    it('shows "Execution" with Normal and Fast, the stored mode checked', () => {
        setup({ mode: 'normal' });
        expect(screen.getByRole('radiogroup', { name: 'Execution' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Normal' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('radio', { name: 'Fast' })).toHaveAttribute('aria-checked', 'false');
    });

    it('picking Fast sets the mode', () => {
        const run_panel = setup();
        fireEvent.click(screen.getByRole('radio', { name: 'Fast' }));
        expect(run_panel.setExecutionMode).toHaveBeenCalledWith('fast');
    });

    it('is locked while a bot runs or the AI Scanner starts/runs', () => {
        const run_panel = setup({ mode: 'fast', locked: true });
        expect(screen.getByRole('radio', { name: 'Normal' })).toBeDisabled();
        expect(screen.getByRole('radio', { name: 'Fast' })).toBeDisabled();
        fireEvent.click(screen.getByRole('radio', { name: 'Normal' }));
        expect(run_panel.setExecutionMode).not.toHaveBeenCalled();
        expect(screen.getByTestId('dt_execution_mode')).toHaveAttribute('title', 'Locked while a bot is running');
    });
});
