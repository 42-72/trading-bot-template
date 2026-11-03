import fs from 'fs';
import path from 'path';

// jsdom has no layout, so the stacking order is checked on the stylesheets themselves:
// these are the values that decide what covers what (all in the root stacking context).
const src = path.resolve(__dirname, '../../../..');
const read = (file: string) => fs.readFileSync(path.join(src, file), 'utf8');
const number = (text: string, pattern: RegExp, what: string) => {
    const match = text.match(pattern);
    if (!match) throw new Error(`${what} not found`);
    return Number(match[1]);
};

const account_dropdown = number(
    read('components/layout/header/account-switcher.scss'),
    /\$acc-dropdown-z:\s*(\d+)/,
    'account dropdown z-index'
);
const run_bar = number(
    read('pages/main/main.scss'),
    /\.run-strategy-bar\s*\{[^}]*?z-index:\s*(\d+)/s,
    'Run bar z-index'
);
const ai_panel = number(
    read('components/ai-scanner/ai-scanner.scss'),
    /\$ai-scanner-panel-z:\s*(\d+)/,
    'AI panel z-index'
);
const modal_root = number(
    read('app/app.scss'),
    /\.modal-root:not\(:empty\)\s*\{[^}]*?z-index:\s*(\d+)/s,
    'dialog z-index'
);
const session_notice = number(
    read('components/session-notice/session-notice.scss'),
    /z-index:\s*(\d+)/,
    'notice z-index'
);

describe('account switcher dropdown layer', () => {
    it('opens above the Run bar (it used to cover the second account row on laptops)', () => {
        expect(account_dropdown).toBeGreaterThan(run_bar);
    });

    it('opens above the AI panel', () => {
        expect(account_dropdown).toBeGreaterThan(ai_panel);
    });

    it('stays under the dialogs, toasts and session notices', () => {
        expect(account_dropdown).toBeLessThan(modal_root);
        expect(account_dropdown).toBeLessThan(session_notice);
        expect(account_dropdown).toBeLessThan(9999); // react-toastify's container
    });
});
