import type { TOverUnderStrategyId } from '@/constants/ai-engine';
import * as over from './over';
import type { TAiStrategy } from './types';
import * as under from './under';

export type { TAiStrategy, TConditionResult } from './types';

export const OVER_UNDER_STRATEGIES: Record<TOverUnderStrategyId, TAiStrategy> = { over, under };

/**
 * Pipeline check only - DEMO accounts only, off by default (the store refuses
 * it on a real account and cancels a scan that started on one). Qualifies the
 * first market with a full window immediately and enters on the next tick,
 * for whichever of Over / Under is selected.
 */
export const TEST_STRATEGY: TAiStrategy = {
    condition: () => ({ qualified: true, reason: 'TEST strategy (demo only): qualifies the first market at once.' }),
    entry: () => true,
};

export const getOverUnderStrategy = (id: TOverUnderStrategyId, use_test_strategy: boolean): TAiStrategy =>
    use_test_strategy ? TEST_STRATEGY : OVER_UNDER_STRATEGIES[id];
