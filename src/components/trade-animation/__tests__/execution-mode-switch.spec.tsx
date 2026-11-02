import { observable, runInAction } from 'mobx';
import { useStore } from '@/hooks/useStore';
import { TExecutionMode } from '@/utils/execution-mode';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExecutionModeSwitch from '../execution-mode-switch';

jest.mock('@/hooks/useStore', () => ({ useStore: jest.fn() }));
jest.mock('@deriv-com/translations', () => ({ localize: (text: string) => text }));

/** A run panel whose setExecutionMode really changes the mode (and respects the lock), like the store's. */
const setup = ({ mode = 'normal', locked = false }: { mode?: TExecutionMode; locked?: boolean } = {}) => {
    const run_panel = observable(
        {
            execution_mode: mode,
            is_execution_mode_locked: locked,
            setExecutionMode: jest.fn((next: TExecutionMode) => {
                if (run_panel.is_execution_mode_locked) return;
                runInAction(() => {
                    run_panel.execution_mode = next;
                });
            }),
        },
        { setExecutionMode: false }
    );
    (useStore as jest.Mock).mockReturnValue({ run_panel });
    render(<ExecutionModeSwitch />);
    return run_panel;
};

const toggle = () => screen.getByRole('switch', { name: 'Fast execution' });
const pill = () => screen.getByTestId('dt_execution_mode_pill');

describe('ExecutionModeSwitch', () => {
    it('shows "Execution", the mode in capitals and one switch - Normal (off) by default', () => {
        setup();
        expect(screen.getByText('Execution')).toBeInTheDocument();
        expect(screen.getByText('NORMAL')).toBeInTheDocument();
        expect(toggle()).toHaveAttribute('aria-checked', 'false');
        expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    });

    it('the toggle switches Normal -> Fast -> Normal', () => {
        const run_panel = setup();
        fireEvent.click(toggle());
        expect(run_panel.setExecutionMode).toHaveBeenLastCalledWith('fast');
        expect(toggle()).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByText('FAST')).toBeInTheDocument();

        fireEvent.click(toggle());
        expect(run_panel.setExecutionMode).toHaveBeenLastCalledWith('normal');
        expect(toggle()).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByText('NORMAL')).toBeInTheDocument();
    });

    it('the label, the word and the toggle sit in one pill, tinted (fast class) only when Fast', () => {
        setup();
        expect(pill()).toContainElement(screen.getByText('Execution'));
        expect(pill()).toContainElement(screen.getByText('NORMAL'));
        expect(pill()).toContainElement(toggle());
        expect(pill()).not.toHaveClass('execution-mode__pill--fast');

        fireEvent.click(toggle());
        expect(pill()).toHaveClass('execution-mode__pill--fast');

        fireEvent.click(toggle());
        expect(pill()).not.toHaveClass('execution-mode__pill--fast');
    });

    it('Space and Enter toggle it from the keyboard', async () => {
        const user = userEvent.setup();
        setup();
        toggle().focus();
        await user.keyboard(' ');
        expect(toggle()).toHaveAttribute('aria-checked', 'true');
        await user.keyboard('{Enter}');
        expect(toggle()).toHaveAttribute('aria-checked', 'false');
    });

    it('is locked (disabled, faded) while a bot or the AI Scanner is running', async () => {
        const user = userEvent.setup();
        const run_panel = setup({ mode: 'fast', locked: true });
        expect(toggle()).toBeDisabled();
        expect(screen.getByTestId('dt_execution_mode')).toHaveClass('execution-mode--locked');
        expect(screen.getByTestId('dt_execution_mode')).toHaveAttribute('title', 'Locked while a bot is running');

        await user.click(toggle());
        toggle().focus();
        await user.keyboard(' ');
        expect(run_panel.setExecutionMode).not.toHaveBeenCalled();
        expect(toggle()).toHaveAttribute('aria-checked', 'true');
    });

    it('unlocks again when the run ends', () => {
        const run_panel = setup({ locked: true });
        expect(toggle()).toBeDisabled();
        act(() => {
            runInAction(() => {
                run_panel.is_execution_mode_locked = false;
            });
        });
        expect(toggle()).toBeEnabled();
        expect(screen.getByTestId('dt_execution_mode')).not.toHaveClass('execution-mode--locked');
    });
});
