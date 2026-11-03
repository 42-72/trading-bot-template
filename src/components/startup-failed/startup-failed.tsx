import { localize } from '@deriv-com/translations';
import './startup-failed.scss';

/**
 * Shown instead of the "Initializing..." loader when the bot area's start-up
 * did not finish even after its automatic retry (useStartupWatchdog). A plain
 * page element - nothing covers the page, so pull-to-refresh keeps working.
 */
const StartupFailed = () => (
    <div className='startup-failed' role='alert'>
        <p className='startup-failed__text'>
            {localize('The bot area could not finish loading. Please reload the page.')}
        </p>
        <button type='button' className='startup-failed__button' onClick={() => window.location.reload()}>
            {localize('Reload')}
        </button>
    </div>
);

export default StartupFailed;
