import { observer } from 'mobx-react-lite';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import { LabelPairedSquareLgFillIcon } from '@deriv/quill-icons/LabelPaired';
import { Localize } from '@deriv-com/translations';

/**
 * Phones, Tbots / DTrader tabs only (PHONE_FULL_HEIGHT_TABS), while a bot or
 * the AI Scanner runs: the run panel drawer is hidden there, so this slim bar
 * is the one way to stop the run without leaving the tab. It stops through the
 * same paths as the existing controls: the AI Scanner's own cancel() (which
 * also stops a bot it started) or the Run bar's Stop (onStopBotClick).
 */
const SlimStopBar = observer(() => {
    const { run_panel, ai_scanner } = useStore();
    const { contract_stage, is_stop_button_visible, onStopBotClick } = run_panel;
    const is_scanner_run = ai_scanner.is_active;
    const is_scanning = ai_scanner.is_pre_run;
    const is_stopping = is_scanner_run
        ? ai_scanner.stage === 'stopping'
        : contract_stage === contract_stages.IS_STOPPING;
    // Like the Run bar's Stop, a tap always stops (also mid-purchase); only an
    // already-stopping run can't be stopped again.

    const onStop = () => {
        if (is_scanner_run) {
            ai_scanner.cancel();
            return;
        }
        if (is_stop_button_visible) onStopBotClick();
    };

    return (
        <div className='run-panel-slim-stop' data-testid='dt_slim_stop_bar'>
            <span className='run-panel-slim-stop__status'>
                {is_scanning ? (
                    <Localize i18n_default_text='AI Scanner is scanning' />
                ) : is_scanner_run ? (
                    <Localize i18n_default_text='AI Scanner bot is running' />
                ) : (
                    <Localize i18n_default_text='Bot is running' />
                )}
            </span>
            <button
                type='button'
                id='db-slim-stop-button'
                className='run-panel-slim-stop__button'
                onClick={onStop}
                disabled={is_stopping}
            >
                <LabelPairedSquareLgFillIcon fill='#fff' width='16px' height='16px' />
                {is_stopping ? (
                    <Localize i18n_default_text='Stopping…' />
                ) : is_scanning ? (
                    <Localize i18n_default_text='Stop scan' />
                ) : (
                    <Localize i18n_default_text='Stop' />
                )}
            </button>
        </div>
    );
});

export default SlimStopBar;
