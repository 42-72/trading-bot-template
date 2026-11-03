/**
 * Start-up helpers (main.tsx, app-root.tsx).
 */

/**
 * Storage keys of removed features, deleted at start-up:
 *   ct_conn_log   - the hidden connection log
 *   ctdebug       - its button switch
 *   ct_session_v2 - the old switch for the session handling, now always on
 */
export const RETIRED_STORAGE_KEYS = ['ct_conn_log', 'ctdebug', 'ct_session_v2'];

export const removeRetiredStorageKeys = () => {
    try {
        RETIRED_STORAGE_KEYS.forEach(key => localStorage.removeItem(key));
    } catch {
        // Blocked storage: nothing to remove.
    }
};

/** Chrome may load a page typed in the address bar before Enter is pressed (prerendering). */
export const isPrerendering = () =>
    typeof document !== 'undefined' && !!(document as Document & { prerendering?: boolean }).prerendering;

/**
 * Resolves once the page is really shown to the trader. A prerendered page
 * runs without the tab's sessionStorage (so without its login): the app must
 * not open its socket or decide who is logged in until then.
 */
export const whenPageActivated = (): Promise<void> =>
    new Promise(resolve => {
        if (!isPrerendering()) {
            resolve();
            return;
        }
        document.addEventListener('prerenderingchange', () => resolve(), { once: true });
    });
