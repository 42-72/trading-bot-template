/**
 * Start-up trace in the browser console ("[CT start] ..."), for debugging on a
 * laptop. Invisible to traders. Never pass a token, an OTP or a socket URL.
 */
export const startLog = (message: string) => {
    // eslint-disable-next-line no-console
    console.info(`[CT start] ${message}`);
};
