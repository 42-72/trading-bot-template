import type { TOverUnderStrategyId } from '@/constants/ai-engine';
import * as even_odd from './even-odd';
import * as over from './over';
import type { TAiStrategy } from './types';
import * as under from './under';

export type { TAiStrategy, TConditionResult, TSide } from './types';

export const OVER_UNDER_STRATEGIES: Record<TOverUnderStrategyId, TAiStrategy> = { over, under };

/** The Even/Odd tab's one strategy - it picks the side per market. */
export const EVEN_ODD_STRATEGY: TAiStrategy = even_odd;

/**
 * Pipeline check only - DEMO accounts only, off by default (the store refuses
 * it on a real account and cancels a scan that started on one). Qualifies the
 * first market with a full window immediately and enters on the next tick,
 * for whichever of Over / Under is selected.
 */
export const TEST_STRATEGY: TAiStrategy = {
    condition: () => ({
        qualified: true,
        reason: 'TEST strategy (demo only): qualifies the first market at once.',
        shortfall: 0,
    }),
    entry: () => true,
};

export const getOverUnderStrategy = (id: TOverUnderStrategyId, use_test_strategy: boolean): TAiStrategy =>
    use_test_strategy ? TEST_STRATEGY : OVER_UNDER_STRATEGIES[id];

/** The strategy a scan runs: the tab's, or TEST (whose side, on Even/Odd, is Even). */
export const getScannerStrategy = (
    tab: 'over_under' | 'even_odd',
    over_under_id: TOverUnderStrategyId,
    use_test_strategy: boolean
): TAiStrategy => {
    if (use_test_strategy) return TEST_STRATEGY;
    return tab === 'even_odd' ? EVEN_ODD_STRATEGY : OVER_UNDER_STRATEGIES[over_under_id];
};
