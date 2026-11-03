import { observer } from 'mobx-react-lite';
import { generateOAuthURL } from '@/components/shared';
import { session_status } from '@/utils/session-status';
import { localize } from '@deriv-com/translations';
import './session-notice.scss';

/** Opens Deriv's login - only ever from a click, never on its own. */
const logInAgain = async () => {
    const oauth_url = await generateOAuthURL();
    if (oauth_url) window.location.replace(oauth_url);
};

/**
 * Session notices (state in utils/session-status.ts):
 * - "Reconnecting…" while a logged-in user's connection is being retried.
 * - "Connection lost – bot stopped" after a running bot / AI Scanner was stopped (dismissible).
 * - "Session expired – log in again", which stays until the trader logs in.
 */
const SessionNotice = observer(() => {
    const { is_reconnecting, notice, dismissNotice } = session_status;

    return (
        <div className='session-notice' aria-live='polite'>
            {notice === 'session_expired' && (
                <div className='session-notice__card session-notice__card--expired' role='alert'>
                    <span>{localize('Session expired – log in again')}</span>
                    <button type='button' className='session-notice__action' onClick={logInAgain}>
                        {localize('Log in')}
                    </button>
                </div>
            )}
            {notice === 'connection_lost' && (
                <div className='session-notice__card session-notice__card--lost' role='alert'>
                    <span>{localize('Connection lost – bot stopped. Press Run to start again.')}</span>
                    <button
                        type='button'
                        className='session-notice__close'
                        aria-label={localize('Dismiss')}
                        onClick={dismissNotice}
                    >
                        ×
                    </button>
                </div>
            )}
            {is_reconnecting && notice !== 'session_expired' && (
                <div className='session-notice__pill' data-testid='dt_session_reconnecting'>
                    {localize('Reconnecting…')}
                </div>
            )}
        </div>
    );
});

export default SessionNotice;
