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

export type TConditionResult = {
    qualified: boolean;
    reason: string;
    /**
     * Optional: how many ticks short of qualifying, from the real counts (0 =
     * qualified). Only used to pick which market the panel shows as closest -
     * never shown, and never a probability.
     */
    shortfall?: number;
};

export type TAiStrategy = {
    condition: (digits: number[]) => TConditionResult;
    entry: (digits: number[], newDigit: number) => boolean;
};
