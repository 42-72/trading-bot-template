import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { TExecutionMode } from '@/utils/execution-mode';
import { localize } from '@deriv-com/translations';

const OPTIONS: { mode: TExecutionMode; label: () => string }[] = [
    { mode: 'normal', label: () => localize('Normal') },
    { mode: 'fast', label: () => localize('Fast') },
];

/**
 * "Execution: Normal | Fast" beside Run. Locked while a bot runs or the AI
 * Scanner is starting/running - the engine reads the mode once, at Run.
 */
const ExecutionModeSwitch = observer(() => {
    const { run_panel } = useStore();
    const { execution_mode, is_execution_mode_locked, setExecutionMode } = run_panel;
    const locked_hint = is_execution_mode_locked ? localize('Locked while a bot is running') : undefined;

    return (
        <div
            className={classNames('execution-mode', { 'execution-mode--locked': is_execution_mode_locked })}
            role='radiogroup'
            aria-label={localize('Execution')}
            title={locked_hint}
            data-testid='dt_execution_mode'
        >
            <span className='execution-mode__label' aria-hidden='true'>
                {localize('Execution')}
            </span>
            <div className='execution-mode__options'>
                {OPTIONS.map(({ mode, label }) => (
                    <button
                        key={mode}
                        type='button'
                        role='radio'
                        aria-checked={execution_mode === mode}
                        className={classNames('execution-mode__option', {
                            'execution-mode__option--selected': execution_mode === mode,
                        })}
                        disabled={is_execution_mode_locked}
                        onClick={() => setExecutionMode(mode)}
                    >
                        {label()}
                    </button>
                ))}
            </div>
        </div>
    );
});

export default ExecutionModeSwitch;
