import { getOverUnderStrategy, OVER_UNDER_STRATEGIES, TEST_STRATEGY } from '../index';

const windows = [
    [],
    new Array(600).fill(0),
    new Array(600).fill(9),
    Array.from({ length: 600 }, (_, i) => i % 10),
    Array.from({ length: 600 }, () => Math.floor(Math.random() * 10)),
];

describe('Over/Under strategy slots', () => {
    // Over has a real strategy now (over.test.ts); Under is still the default.
    it.each(['under'] as const)('the default %s strategy never qualifies and never enters', id => {
        const strategy = OVER_UNDER_STRATEGIES[id];
        windows.forEach(digits => {
            expect(strategy.condition(digits).qualified).toBe(false);
            for (let digit = 0; digit <= 9; digit++) expect(strategy.entry(digits, digit)).toBe(false);
        });
    });

    it('only hands out the TEST strategy when asked for it', () => {
        expect(getOverUnderStrategy('over', false)).toBe(OVER_UNDER_STRATEGIES.over);
        expect(getOverUnderStrategy('under', false)).toBe(OVER_UNDER_STRATEGIES.under);
        expect(getOverUnderStrategy('under', true)).toBe(TEST_STRATEGY);
        expect(TEST_STRATEGY.condition([]).qualified).toBe(true);
        expect(TEST_STRATEGY.entry([], 5)).toBe(true);
    });
});
