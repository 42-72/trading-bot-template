import { useEffect, useRef } from 'react';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { ErrorLogger } from '@/utils/error-logger';

/**
 * Hook to handle invalid token events by clearing auth data and redirecting to OAuth login
 *
 * This hook listens for 'InvalidToken' events (emitted by CoreStoreProvider
 * when a WS message comes back with code: 'AuthorizationRequired',
 * 'DisabledClient' or 'InvalidToken'). When such an event is detected, it
 * clears the invalid authentication data and redirects to OAuth login to
 * prevent infinite reload loops.
 *
 * isRunning gates this: while a strategy is running, this must never fire -
 * that case is owned entirely by run-panel-store's handleInvalidToken
 * (stop the bot, Journal entry, a dismissible "Log in again" notification -
 * no auto-redirect, the bot must never auto-run after login). The caller
 * (CoreStoreProvider) already only emits 'InvalidToken' when nothing is
 * running, but this hook re-checks isRunning itself at fire time (via a
 * ref, so the effect doesn't need isRunning in its own dependency array and
 * doesn't re-subscribe on every render) as a second, independent guard
 * against a future emitter being added elsewhere without the same care.
 *
 * @param isRunning Whether a strategy is currently running.
 * @returns {{ unregisterHandler: () => void }} An object containing a function to unregister the event handler
 */
export const useInvalidTokenHandler = (isRunning: boolean): { unregisterHandler: () => void } => {
    const isRunningRef = useRef(isRunning);
    isRunningRef.current = isRunning;

    const handleInvalidToken = async () => {
        if (isRunningRef.current) return;

        try {
            // Clear invalid session data to prevent infinite reload loop
            sessionStorage.removeItem('auth_info');
            localStorage.removeItem('active_loginid');
            localStorage.removeItem('authToken');
            localStorage.removeItem('accountsList');
            localStorage.removeItem('clientAccounts');

            // Clear sessionStorage completely to remove any stale auth data
            sessionStorage.clear();

            // Redirect to OAuth login instead of reload to get fresh authentication
            const { generateOAuthURL } = await import('@/components/shared');
            const oauthUrl = await generateOAuthURL();

            if (oauthUrl) {
                // Use replace to prevent back button from returning to invalid state
                window.location.replace(oauthUrl);
            } else {
                // Fallback: reload if OAuth URL generation fails
                ErrorLogger.error('InvalidToken', 'Failed to generate OAuth URL, falling back to reload');
                window.location.reload();
            }
        } catch (error) {
            ErrorLogger.error('InvalidToken', 'Error handling invalid token', error);
            // Last resort: reload the page
            window.location.reload();
        }
    };

    // Subscribe to the InvalidToken event
    useEffect(() => {
        globalObserver.register('InvalidToken', handleInvalidToken);

        // Cleanup the subscription when the component unmounts
        return () => {
            globalObserver.unregister('InvalidToken', handleInvalidToken);
        };
    }, []);

    // Return a function to unregister the handler manually if needed
    return {
        unregisterHandler: () => {
            globalObserver.unregister('InvalidToken', handleInvalidToken);
        },
    };
};

export default useInvalidTokenHandler;
