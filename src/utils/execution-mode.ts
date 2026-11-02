/**
 * The "Execution: Normal | Fast" switch beside Run, saved per browser.
 *
 * Normal is the engine's original timing. Fast lets the next Before Purchase
 * run as soon as the previous contract's result is in, instead of waiting
 * for a new tick (see bot-skeleton trade/watch-scope.js) - never before the
 * result, so martingale, take profit and stop loss see every contract.
 */
export type TExecutionMode = 'normal' | 'fast';

export const EXECUTION_MODE_STORAGE_KEY = 'ct_execution_mode';

export const readStoredExecutionMode = (): TExecutionMode => {
    try {
        return localStorage.getItem(EXECUTION_MODE_STORAGE_KEY) === 'fast' ? 'fast' : 'normal';
    } catch {
        return 'normal';
    }
};

export const storeExecutionMode = (mode: TExecutionMode) => {
    try {
        localStorage.setItem(EXECUTION_MODE_STORAGE_KEY, mode);
    } catch {
        // Storage unavailable (private mode, quota): the switch still works for this session.
    }
};

/** The mode is read once at Run: locked while a bot runs, or while the AI Scanner is about to press Run or is running. */
export const isExecutionModeLocked = (is_bot_running: boolean, ai_scanner_stage?: string) =>
    is_bot_running || ai_scanner_stage === 'starting' || ai_scanner_stage === 'running';
