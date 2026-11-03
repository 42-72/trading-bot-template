import { localize } from '@deriv-com/translations';
import { logConnEvent } from './connection-log';

export type TSessionStopReason = 'connection_lost' | 'session_expired';

type TSessionStopTargets = {
    is_running: boolean;
    ai_scanner?: { is_active: boolean; stopForSession: (message: string) => void };
    journal: { pushMessage: (message: string, message_type: string, className: string) => void };
    /** The Stop button's own path (run-panel-store.stopBot). */
    stopBot: () => void;
    error_message_type: string;
};

/**
 * ct_session_v2: the connection or the session is gone. A running bot or AI
 * Scanner is stopped through the Stop button's own path, with a Journal
 * entry. Nothing is ever resumed or re-run - the trader presses Run again.
 * Returns whether anything was running.
 */
export const stopRunsForSession = (
    { is_running, ai_scanner, journal, stopBot, error_message_type }: TSessionStopTargets,
    reason: TSessionStopReason
) => {
    const is_scanner_active = !!ai_scanner?.is_active;
    if (!is_running && !is_scanner_active) return false;

    const what = is_running ? localize('bot stopped') : localize('AI Scanner stopped');
    const message =
        reason === 'connection_lost'
            ? `${localize('Connection lost')} – ${what}`
            : `${localize('Session expired')} – ${what}`;

    logConnEvent(
        'run_stopped',
        `${is_scanner_active ? 'AI Scanner' : 'bot'} stopped - ${reason === 'connection_lost' ? 'connection lost' : 'session expired'}`
    );

    // The scanner stops its own bot through the same Stop path.
    if (is_scanner_active) ai_scanner?.stopForSession(message);
    else stopBot();
    journal.pushMessage(message, error_message_type, '');
    return true;
};
