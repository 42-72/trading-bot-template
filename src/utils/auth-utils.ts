/**
 * Utility functions for authentication-related operations
 */

import { logConnEvent } from './connection-log';

/**
 * Clears authentication data from local storage and reloads the page
 * @param source the file / function that asked for it (for the connection log)
 */
export const clearAuthData = (source = 'auth-utils.ts clearAuthData') => {
    logConnEvent('auth_wipe', `localStorage auth keys cleared (${source})`);
    localStorage.removeItem('authToken');
    localStorage.removeItem('active_loginid');
    localStorage.removeItem('client.country');
    localStorage.removeItem('account_type'); // Clear account type when clearing auth data
    localStorage.removeItem('accountsList');
    localStorage.removeItem('clientAccounts');
    localStorage.removeItem('callback_token');
};
