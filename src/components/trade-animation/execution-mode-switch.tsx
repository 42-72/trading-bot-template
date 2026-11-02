import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';

/**
 * "Execution  NORMAL ◯" inside the Run bar: one toggle, off = Normal, on = Fast.
 * Locked while a bot runs or the AI Scanner is starting/running - the engine
 * reads the mode once, at Run.
 *
 * A native button with role="switch": Space and Enter toggle it with no key
 * handling of our own, and `disabled` takes it out of the tab order when locked.
 */
const ExecutionModeSwitch = observer(() => {
    const { run_panel } = useStore();
    const { execution_mode, is_execution_mode_locked, setExecutionMode } = run_panel;
    const is_fast = execution_mode === 'fast';

    return (
        <div
            className={classNames('execution-mode', {
                'execution-mode--fast': is_fast,
                'execution-mode--locked': is_execution_mode_locked,
            })}
            title={is_execution_mode_locked ? localize('Locked while a bot is running') : undefined}
            data-testid='dt_execution_mode'
        >
            <span className='execution-mode__label' aria-hidden='true'>
                {localize('Execution')}
            </span>
            <span className='execution-mode__value' aria-hidden='true'>
                {is_fast ? localize('FAST') : localize('NORMAL')}
            </span>
            <button
                type='button'
                role='switch'
                aria-checked={is_fast}
                aria-label={localize('Fast execution')}
                className='execution-mode__toggle'
                disabled={is_execution_mode_locked}
                onClick={() => setExecutionMode(is_fast ? 'normal' : 'fast')}
            >
                <span className='execution-mode__thumb' />
            </button>
        </div>
    );
});

export default ExecutionModeSwitch;
