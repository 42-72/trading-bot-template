import { BOT_VERSION_CONFIG } from '@/constants/bot-version';
import { KEPT_STORAGE_KEYS, performVersionCheck } from '../version-check';

describe('performVersionCheck', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.spyOn(console, 'info').mockImplementation(() => undefined);
    });

    afterEach(() => jest.restoreAllMocks());

    const settings = {
        active_loginid: 'CR123',
        account_type: 'real',
        accountsList: '{"CR123":"x"}',
        clientAccounts: '{}',
        ct_execution_mode: 'fast',
        market_tool_symbol: '1HZ100V',
        dbot_settings: '{"journal_filter":["error"]}',
        'ct-theme': 'light',
        active_tab: '3',
        i18n_language: 'EN',
        ai_scanner_button_position_mobile: '{"x":1}',
        'localforage/saved_workspaces': 'abc',
    };

    it('on a new version keeps the login and every user setting, and clears the rest', () => {
        localStorage.setItem(BOT_VERSION_CONFIG.STORAGE_KEY, String(BOT_VERSION_CONFIG.REQUIRED_VERSION - 1));
        Object.entries(settings).forEach(([key, value]) => localStorage.setItem(key, value));
        localStorage.setItem('some_stale_key', '1');
        localStorage.setItem('client.accounts', 'old');

        performVersionCheck();

        Object.entries(settings).forEach(([key, value]) => expect(localStorage.getItem(key)).toBe(value));
        expect(localStorage.getItem('some_stale_key')).toBeNull();
        expect(localStorage.getItem('client.accounts')).toBeNull();
        expect(localStorage.getItem(BOT_VERSION_CONFIG.STORAGE_KEY)).toBe(String(BOT_VERSION_CONFIG.REQUIRED_VERSION));
    });

    it('does nothing when the version already matches', () => {
        localStorage.setItem(BOT_VERSION_CONFIG.STORAGE_KEY, String(BOT_VERSION_CONFIG.REQUIRED_VERSION));
        localStorage.setItem('some_other_key', '1');
        performVersionCheck();
        expect(localStorage.getItem('some_other_key')).toBe('1');
    });

    it('never clears cookies', () => {
        document.cookie = 'utm_data=keep';
        performVersionCheck();
        expect(document.cookie).toContain('utm_data=keep');
    });

    it('keeps the version key itself', () => {
        expect(KEPT_STORAGE_KEYS).toContain(BOT_VERSION_CONFIG.STORAGE_KEY);
    });
});
