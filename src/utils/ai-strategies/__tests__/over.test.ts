import { condition, entry } from '../over';

/**
 * A 600-digit window with exactly `counts[d]` of each digit d, ending with
 * `tail` (the tail is part of the counts). Counts must sum to 600.
 */
const windowOf = (counts: number[], tail: number[] = []) => {
    const remaining = counts.slice();
    tail.forEach(digit => {
        remaining[digit] -= 1;
    });
    const body: number[] = [];
    remaining.forEach((count, digit) => {
        for (let i = 0; i < count; i++) body.push(digit);
    });
    const digits = [...body, ...tail];
    expect(digits).toHaveLength(600);
    expect(remaining.every(count => count >= 0)).toBe(true);
    return digits;
};

//                 0   1   2   3   4   5   6   7   8   9
const PASSING = [58, 58, 58, 57, 57, 56, 64, 64, 64, 64];

describe('Over condition', () => {
    it('qualifies with three of 6-9 at 64 and each of 0-2 at 58', () => {
        //                      0   1   2   3   4   5   6   7   8   9
        const result = condition(windowOf([58, 58, 58, 60, 60, 60, 64, 64, 64, 54]));
        expect(result.qualified).toBe(true);
        expect(result.reason).toBe(
            '6: 10.7% · 7: 10.7% · 8: 10.7% · 9: 9.0% — 3 of 6-9 at 10.6%+ | 0: 9.7% · 1: 9.7% · 2: 9.7% — all under 9.8%'
        );
    });

    it('fails Rule 1 when one of the three is at 63', () => {
        const result = condition(windowOf([58, 58, 58, 60, 60, 61, 64, 64, 63, 54]));
        expect(result.qualified).toBe(false);
        expect(result.reason).toMatch(/2 of 6-9 at 10.6%\+/);
        expect(result.reason).toMatch(/needs 3 of 6-9/);
    });

    it('passes Rule 2 with digit 0 at 58 and fails it at 59', () => {
        expect(condition(windowOf(PASSING)).qualified).toBe(true);
        const result = condition(windowOf([59, 58, 58, 56, 57, 56, 64, 64, 64, 64]));
        expect(result.qualified).toBe(false);
        expect(result.reason).toMatch(/not all under 9.8%/);
        expect(result.reason).toMatch(/needs each of 0, 1, 2 under 9.8%/);
    });

    it('is never qualified with fewer than 600 digits', () => {
        expect(condition(windowOf(PASSING).slice(1)).qualified).toBe(false);
        expect(condition([]).qualified).toBe(false);
    });
});

describe('Over entry', () => {
    // The window ends with the new digit, as the scanner's feed passes it.
    const enters = (tail: number[]) => entry(windowOf(PASSING, tail), tail[tail.length - 1]);

    it.each([
        [[7, 9, 1], true],
        [[8, 8, 2], true],
        [[7, 7, 7, 1], true],
        [[9, 7, 2], true],
        [[7, 9, 0], false],
        [[5, 7, 1], false],
        [[6, 9, 1], false],
        [[7, 9, 3], false],
    ])('...%p -> %p', (tail, expected) => {
        expect(enters(tail)).toBe(expected);
    });
});
