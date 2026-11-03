import { BOT_VERSION_CONFIG } from '@/constants/bot-version';

/**
 * Keys a version change never clears: the login (so a trader stays logged
 * in) and the trader's own settings - execution mode, theme, language, the
 * selected account, the Market Tool symbol, Bot Builder settings, saved
 * strategies (localforage's localStorage fallback), chart settings and so on.
 */
export const KEPT_STORAGE_KEYS = [
    BOT_VERSION_CONFIG.STORAGE_KEY,
    // Login state
    'active_loginid',
    'account_type',
    'accountsList',
    'clientAccounts',
    'authToken',
    'client_account_details',
    'client.country',
    'google_access_token',
    'google_access_token_expiry',
    // User settings
    'ct_execution_mode',
    'market_tool_symbol',
    'dbot_settings',
    'active_tab',
    'ct-theme',
    'i18n_language',
    'qs-fields',
    'bot-announcements',
    'library_strategy_ids',
    'tracking_status',
    'bot.chart_props',
    'cq-favorites',
];

/** Key prefixes kept too (several keys of one kind). */
export const KEPT_STORAGE_PREFIXES = ['ct_', 'ai_scanner_button_position', 'localforage', 'smartcharts'];

const isKept = (key: string) =>
    KEPT_STORAGE_KEYS.includes(key) || KEPT_STORAGE_PREFIXES.some(prefix => key.startsWith(prefix));

/**
 * A new bot version (BOT_VERSION_CONFIG.REQUIRED_VERSION): clears what an
 * older version may have left behind, but never the login or the trader's
 * settings (KEPT_STORAGE_KEYS). It used to wipe ALL of localStorage and every
 * cookie, which logged traders out and reset their settings.
 */
const clearStaleLocalStorage = (): string[] => {
    const removed: string[] = [];
    try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key !== null) keys.push(key);
        }
        keys.forEach(key => {
            if (isKept(key)) return;
            localStorage.removeItem(key);
            removed.push(key);
        });
    } catch (error) {
        console.error('Error clearing localStorage:', error);
    }
    return removed;
};

/**
 * Sets the bot version in localStorage to prevent infinite clearing
 */
const setBotVersion = (): void => {
    try {
        localStorage.setItem(BOT_VERSION_CONFIG.STORAGE_KEY, BOT_VERSION_CONFIG.REQUIRED_VERSION.toString());
    } catch (error) {
        console.error('Error setting bot version:', error);
    }
};

/**
 * Checks if the current bot version matches the required version
 * @returns true if version matches, false if it is different or not set
 */
const isVersionValid = (): boolean => {
    try {
        const currentVersion = localStorage.getItem(BOT_VERSION_CONFIG.STORAGE_KEY);
        if (currentVersion === null) return false;
        return parseInt(currentVersion, 10) === BOT_VERSION_CONFIG.REQUIRED_VERSION;
    } catch (error) {
        console.error('Error checking bot version:', error);
        return false;
    }
};

/**
 * Performs version check and clears stale storage if necessary.
 * Called at the very beginning of app initialization, before any other
 * localStorage operations.
 */
export const performVersionCheck = (): void => {
    if (isVersionValid()) return;
    const removed = clearStaleLocalStorage();
    setBotVersion();
    // eslint-disable-next-line no-console
    console.info(
        `Bot version set to ${BOT_VERSION_CONFIG.REQUIRED_VERSION}; cleared ${removed.length} stale storage key(s), kept the login and settings.`
    );
};
