import { getLocalizedErrorMessage } from '@/constants/backend-error-messages';
import { localize } from '@deriv-com/translations';
import { recoverable_errors } from '../../../constants/messages';

// A recoverable error doesn't end a run: the call that failed is tried again
// where it stands (interpreter.js), a few times, then the bot stops cleanly.
export const MAX_RETRIES = 3;
export const RETRY_WINDOW_MS = 60000;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
// Deriv's limit needs time to clear: another try within seconds would only hit it again.
const RATE_LIMIT_DELAYS_MS = [5000, 15000, 30000];
const RATE_LIMIT_ERRORS = ['RateLimit', 'RateLimitExceeded'];

export const isRecoverableError = code => recoverable_errors.includes(code);

/** Counts the tries of one failure. next() is the wait before the next try, null once none are left. */
export const createRetryBudget = () => {
    let tries = 0;
    let started_at = null;
    return {
        next(code) {
            const now = Date.now();
            started_at = started_at ?? now;
            if (tries >= MAX_RETRIES || now - started_at >= RETRY_WINDOW_MS) return null;
            const delays = RATE_LIMIT_ERRORS.includes(code) ? RATE_LIMIT_DELAYS_MS : RETRY_DELAYS_MS;
            const delay = delays[tries];
            tries += 1;
            return delay;
        },
        get tries() {
            return tries;
        },
        reset() {
            tries = 0;
            started_at = null;
        },
    };
};

const getReason = error => {
    const localized = error?.code ? getLocalizedErrorMessage(error.code, error) : error?.message;
    // A template Deriv sent no values for: its own text reads better than a raw {{param1}}.
    const message = /{{\w+}}/.test(localized ?? '') ? error.message : localized;
    return (message || localize('An error occurred')).replace(/\.+$/, '');
};

export const getRetryMessage = (error, delay_ms, try_number) =>
    localize('Trade error: {{reason}}. Trying again in {{seconds}}s (try {{try_number}} of {{max_tries}}).', {
        reason: getReason(error),
        seconds: delay_ms / 1000,
        try_number,
        max_tries: MAX_RETRIES,
    });

export const getBotStoppedMessage = error =>
    localize('Bot stopped: {{reason}}. Press Run to start again.', { reason: getReason(error) });
