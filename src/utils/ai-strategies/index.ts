import type { TOverUnderStrategyId } from '@/constants/ai-engine';
import * as even_odd from './even-odd';
import * as over from './over';
import type { TAiStrategy } from './types';
import * as under from './under';

export type { TAiStrategy, TConditionResult, TSide } from './types';

export const OVER_UNDER_STRATEGIES: Record<TOverUnderStrategyId, TAiStrategy> = { over, under };

/** The Even/Odd tab's one strategy - it picks the side per market. */
export const EVEN_ODD_STRATEGY: TAiStrategy = even_odd;

/** The strategy a scan runs: the tab's (on Over/Under, the one picked). */
export const getScannerStrategy = (tab: 'over_under' | 'even_odd', over_under_id: TOverUnderStrategyId): TAiStrategy =>
    tab === 'even_odd' ? EVEN_ODD_STRATEGY : OVER_UNDER_STRATEGIES[over_under_id];
