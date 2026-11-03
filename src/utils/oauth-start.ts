import { startLog } from './start-log';

/**
 * Login return (?code=...&state=... from Deriv's login page) in this tab.
 *
 * The token exchange (App.tsx -> OAuthTokenExchangeService) stores the login
 * and opens the logged-in socket itself. The page must not open the public
 * socket meanwhile: the exchange would close it again, and anything still
 * waiting on it would never be answered (the stuck "Initializing..." loader).
 * So the page's start-up (app-root.tsx) waits for the exchange to settle.
 */

/** Longest the start-up waits for the exchange before it connects anyway. */
export const OAUTH_EXCHANGE_WAIT_MS = 20000;

let settle: () => void = () => {};
let exchange_settled = new Promise<void>(resolve => {
    settle = resolve;
});

export const isOAuthCallbackURL = () => {
    try {
        const params = new URLSearchParams(window.location.search);
        return !!(params.get('code') && params.get('state'));
    } catch {
        return false;
    }
};

/** App.tsx: the exchange is done (or will not happen); `outcome` is for the console only. */
export const markOAuthExchangeSettled = (outcome: string) => {
    startLog(`login return: ${outcome}`);
    settle();
};

/** app-root.tsx: resolves when the exchange settled, or after OAUTH_EXCHANGE_WAIT_MS. */
export const whenOAuthExchangeSettled = () =>
    new Promise<void>(resolve => {
        const timer = setTimeout(() => {
            startLog(`login return: no result after ${OAUTH_EXCHANGE_WAIT_MS / 1000}s - connecting anyway`);
            resolve();
        }, OAUTH_EXCHANGE_WAIT_MS);
        exchange_settled.then(() => {
            clearTimeout(timer);
            resolve();
        });
    });

/** Tests only. */
export const resetOAuthStartForTests = () => {
    exchange_settled = new Promise<void>(resolve => {
        settle = resolve;
    });
};
