import type { TAiStrategy } from '../types';

/**
 * TESTS ONLY - not part of the app (nothing outside tests imports it). The
 * old pipeline check: qualifies the first market it sees and enters on its
 * next tick, so a test can drive scan -> load -> Run without real patterns.
 *
 * In a spec:
 *   jest.mock('@/utils/ai-strategies', () =>
 *       jest.requireActual('@/utils/ai-strategies/__mocks__/test-strategy').strategiesWithTestSwitch()
 *   );
 *   import { setTestStrategy } from '@/utils/ai-strategies/__mocks__/test-strategy';
 *   setTestStrategy(true); // before Scan; false gives the real strategies
 */
export const TEST_STRATEGY: TAiStrategy = {
    condition: () => ({
        qualified: true,
        reason: 'TEST strategy: qualifies the first market at once.',
        shortfall: 0,
    }),
    entry: () => true,
};

const test_switch = { on: false };

export const setTestStrategy = (on: boolean) => {
    test_switch.on = on;
};

/** The real ai-strategies module, except a scan runs TEST while the switch is on. */
export const strategiesWithTestSwitch = () => {
    const actual = jest.requireActual('@/utils/ai-strategies');
    return {
        ...actual,
        getScannerStrategy: (...args: Parameters<typeof actual.getScannerStrategy>) =>
            test_switch.on ? TEST_STRATEGY : actual.getScannerStrategy(...args),
    };
};
