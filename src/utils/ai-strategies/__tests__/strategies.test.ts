import { EVEN_ODD_STRATEGY, getScannerStrategy, OVER_UNDER_STRATEGIES } from '../index';

const windows = [
    [],
    new Array(600).fill(0),
    new Array(600).fill(9),
    Array.from({ length: 600 }, (_, i) => i % 10),
    Array.from({ length: 600 }, () => Math.floor(Math.random() * 10)),
];

describe('Over/Under strategy slots', () => {
    // Under is Over mirrored digit by digit (d -> 9 - d): 6-9 <-> 0-3,
    // 0-2 <-> 7-9, entry 1/2 after 7-9 <-> entry 8/7 after 2-0.
    const mirror = (digits: number[]) => digits.map(digit => 9 - digit);
    // Windows that sit right on the thresholds (64 / 59 counts), in shuffled order.
    const shuffled = (counts: number[]) => {
        const digits = counts.flatMap((count, digit) => new Array(count).fill(digit));
        for (let i = digits.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [digits[i], digits[j]] = [digits[j], digits[i]];
        }
        return digits;
    };
    const near_thresholds = [
        [59, 59, 59, 55, 56, 56, 64, 64, 64, 64],
        [60, 58, 58, 55, 57, 56, 64, 64, 64, 64],
        [58, 58, 58, 57, 57, 57, 64, 64, 63, 64],
        [58, 58, 58, 57, 57, 58, 64, 63, 63, 64],
    ].map(shuffled);

    it('Under answers every window exactly as Over answers its mirror image', () => {
        [...windows, ...near_thresholds].forEach(digits => {
            const over = OVER_UNDER_STRATEGIES.over.condition(digits);
            const under = OVER_UNDER_STRATEGIES.under.condition(mirror(digits));
            expect(under.qualified).toBe(over.qualified);
            expect(under.shortfall).toBe(over.shortfall);
            for (let digit = 0; digit <= 9; digit++) {
                const with_tick = [...digits.slice(1), digit];
                expect(OVER_UNDER_STRATEGIES.under.entry(mirror(with_tick), 9 - digit)).toBe(
                    OVER_UNDER_STRATEGIES.over.entry(with_tick, digit)
                );
            }
        });
    });

    it('a scan runs the strategy of its tab - and only the real ones', () => {
        expect(getScannerStrategy('over_under', 'over')).toBe(OVER_UNDER_STRATEGIES.over);
        expect(getScannerStrategy('over_under', 'under')).toBe(OVER_UNDER_STRATEGIES.under);
        expect(getScannerStrategy('even_odd', 'over')).toBe(EVEN_ODD_STRATEGY);
    });
});

describe('keepArmedWhenConditionFades - a per-strategy setting', () => {
    it('Over and Under keep a faded market armed (the default); Even/Odd drops it', () => {
        expect(OVER_UNDER_STRATEGIES.over.keepArmedWhenConditionFades ?? true).toBe(true);
        expect(OVER_UNDER_STRATEGIES.under.keepArmedWhenConditionFades ?? true).toBe(true);
        expect(EVEN_ODD_STRATEGY.keepArmedWhenConditionFades).toBe(false);
    });
});
