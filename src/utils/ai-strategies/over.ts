import type { TAiStrategy } from './types';

// Strategy "Over": the engine buys Over 2, and Over 3 in recovery after a loss
// (OVER_UNDER_SETUPS.over). The direction is fixed by choosing this strategy.
//
// Not written yet. Until it is, condition never qualifies, so the scanner
// keeps scanning and nothing can trade.

export const condition: TAiStrategy['condition'] = () => ({
    qualified: false,
    reason: 'No Over strategy has been added yet.',
});

export const entry: TAiStrategy['entry'] = () => false;
