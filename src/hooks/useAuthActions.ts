import { useCallback } from 'react';
import { generateOAuthURL } from '@/components/shared';
import { useApiBase } from '@/hooks/useApiBase';

/**
 * Shared login/signup OAuth redirect handlers.
 *
 * Every call site (header auth buttons, landing page CTAs, ...) must use these
 * rather than reimplementing the redirect — handleSignup's `registration` prompt
 * is the one thing here that must not drift out of sync between call sites.
 */
export const useAuthActions = () => {
    const { setIsAuthorizing } = useApiBase();

    const handleSignup = useCallback(async () => {
        try {
            setIsAuthorizing(true);
            const oauthUrl = await generateOAuthURL('registration');
            if (oauthUrl) {
                window.location.replace(oauthUrl);
            } else {
                console.error('Failed to generate OAuth URL for signup');
                setIsAuthorizing(false);
            }
        } catch (error) {
            console.error('Signup redirection failed:', error);
            setIsAuthorizing(false);
        }
    }, [setIsAuthorizing]);

    const handleLogin = useCallback(async () => {
        try {
            setIsAuthorizing(true);
            const oauthUrl = await generateOAuthURL();
            if (oauthUrl) {
                window.location.replace(oauthUrl);
            } else {
                console.error('Failed to generate OAuth URL');
                setIsAuthorizing(false);
            }
        } catch (error) {
            console.error('Login redirection failed:', error);
            setIsAuthorizing(false);
        }
    }, [setIsAuthorizing]);

    return { handleLogin, handleSignup };
};
