import type { TAiStrategy } from './types';

// Strategy "Under": the engine buys Under 7, and Under 6 in recovery after a
// loss (OVER_UNDER_SETUPS.under). The direction is fixed by choosing this
// strategy.
//
// Not written yet. Until it is, condition never qualifies, so the scanner
// keeps scanning and nothing can trade.

export const condition: TAiStrategy['condition'] = () => ({
    qualified: false,
    reason: 'No Under strategy has been added yet.',
});

export const entry: TAiStrategy['entry'] = () => false;
