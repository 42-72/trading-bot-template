import { useEffect, useRef, useState } from 'react';
import { startLog } from '@/utils/start-log';

/** How long the bot area's start-up may take before it is retried, and again before it gives up. */
export const STARTUP_WATCHDOG_MS = 15000;

/**
 * Safety net for the bot area's start-up ("Initializing Deriv Bot account...").
 * While `is_loading` stays true: after STARTUP_WATCHDOG_MS the start-up is
 * retried once (`retry`); if it is still not done after another
 * STARTUP_WATCHDOG_MS, `has_failed` turns true so the page shows a message
 * with a Reload button instead of a loader that never ends.
 */
export const useStartupWatchdog = (is_loading: boolean, retry: () => void) => {
    const [attempt, setAttempt] = useState(0); // 0: first wait, 1: after the retry
    const [has_failed, setHasFailed] = useState(false);
    const retry_ref = useRef(retry);
    retry_ref.current = retry;

    useEffect(() => {
        if (!is_loading || has_failed) {
            if (!is_loading && attempt > 0) startLog('bot area ready (after the retry)');
            return undefined;
        }
        const timer = setTimeout(() => {
            if (attempt === 0) {
                startLog(`bot area not ready after ${STARTUP_WATCHDOG_MS / 1000}s - retrying the start-up once`);
                setAttempt(1);
                retry_ref.current();
            } else {
                startLog('bot area still not ready after the retry - showing the Reload message');
                setHasFailed(true);
            }
        }, STARTUP_WATCHDOG_MS);
        return () => clearTimeout(timer);
    }, [is_loading, attempt, has_failed]);

    return { has_failed };
};
