// The AI Scanner's strategy slot. A strategy is two pure functions over a
// market's last AI_SCANNER_TICK_WINDOW last digits (oldest first, each from
// getLastDigit - toFixed(pip_size), never the raw quote):
//
//   condition: is this market worth waiting on? Scanned on every tick of every
//              market, starting with the seeded history, however many digits
//              it holds - a strategy that needs a full window checks the
//              length itself. `reason` is shown to the trader as-is.
//   entry:     with the condition met, is `newDigit` (already the last item of
//              `digits`) the tick to start the bot on?
//
// Neither may claim to change the odds - the contract's win rate is fixed
// (contractWinRate, constants/ai-engine.ts) and is what the panel shows.

/** Even/Odd: the side a market qualifies on (and is armed with). */
export type TSide = 'even' | 'odd';

export type TConditionResult = {
    qualified: boolean;
    reason: string;
    /** Even/Odd only: the side this market qualified on (or, when not, the side it is shown for). */
    side?: TSide;
    /** Even/Odd only: the single least appearing digit; absent when several tie. */
    leastDigit?: number;
    /**
     * Optional: how many ticks short of qualifying, from the real counts (0 =
     * qualified). Only used to pick which market the panel shows as closest -
     * never shown, and never a probability.
     */
    shortfall?: number;
};

export type TAiStrategy = {
    condition: (digits: number[]) => TConditionResult;
    /** `context.side`: Even/Odd's armed side; Over/Under ignore it. */
    entry: (digits: number[], newDigit: number, context?: { side?: TSide }) => boolean;
};
