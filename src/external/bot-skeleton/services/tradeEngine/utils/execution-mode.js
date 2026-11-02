/**
 * Execution mode for the trade engine: 'normal' (the engine's original
 * timing) or 'fast' (see trade/watch-scope.js).
 *
 * Kept at module level, not on the TradeEngine: restart-on-error replaces
 * the engine with a new instance (utils/interpreter.js), and the mode chosen
 * at Run must survive that.
 */
export const EXECUTION_MODES = Object.freeze({ NORMAL: 'normal', FAST: 'fast' });

/** Fast mode never sends two buys closer together than this. */
export const FAST_MIN_BUY_GAP_MS = 500;

let execution_mode = EXECUTION_MODES.NORMAL;

export const setExecutionMode = mode => {
    execution_mode = mode === EXECUTION_MODES.FAST ? EXECUTION_MODES.FAST : EXECUTION_MODES.NORMAL;
};

export const getExecutionMode = () => execution_mode;

export const isFastExecution = () => execution_mode === EXECUTION_MODES.FAST;

/** How long a Fast-mode buy must still wait so it is at least FAST_MIN_BUY_GAP_MS after the previous one. */
export const getBuyGapDelayMs = (last_buy_sent_at, now) => {
    if (!last_buy_sent_at) return 0;
    return Math.max(0, FAST_MIN_BUY_GAP_MS - (now - last_buy_sent_at));
};
