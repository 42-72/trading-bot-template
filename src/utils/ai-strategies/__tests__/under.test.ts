import { condition, entry } from '../under';

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
    const digits = [...(tail.length ? body.reverse() : body), ...tail];
    expect(digits).toHaveLength(600);
    expect(remaining.every(count => count >= 0)).toBe(true);
    return digits;
};

//                 0   1   2   3   4   5   6   7   8   9
const PASSING = [64, 64, 64, 64, 56, 57, 57, 58, 58, 58];

describe('Under condition', () => {
    it('qualifies with three of 0-3 at 64 and each of 7-9 at 58', () => {
        //                      0   1   2   3   4   5   6   7   8   9
        const result = condition(windowOf([64, 64, 64, 54, 60, 60, 60, 58, 58, 58]));
        expect(result.qualified).toBe(true);
        expect(result.reason).toBe(
            '0: 10.7% · 1: 10.7% · 2: 10.7% · 3: 9.0% — 3 of 0-3 at 10.6%+ | 7: 9.7% · 8: 9.7% · 9: 9.7% — all under 10%'
        );
    });

    it('fails Rule 1 when one of the three is at 63', () => {
        const result = condition(windowOf([64, 63, 64, 54, 61, 60, 60, 58, 58, 58]));
        expect(result.qualified).toBe(false);
        expect(result.reason).toMatch(/2 of 0-3 at 10.6%\+/);
        expect(result.reason).toMatch(/needs 3 of 0-3 at 10.6%\+, has 2/);
    });

    it('passes Rule 2 with digit 9 at 59 and fails it at 60 (exactly 10.0%)', () => {
        expect(condition(windowOf(PASSING)).qualified).toBe(true);
        const at_59 = condition(windowOf([64, 64, 64, 64, 56, 57, 56, 58, 58, 59]));
        expect(at_59.qualified).toBe(true);
        expect(at_59.reason).toMatch(/7: 9.7% · 8: 9.7% · 9: 9.8% — all under 10%$/);

        const result = condition(windowOf([64, 64, 64, 64, 55, 57, 56, 58, 58, 60]));
        expect(result.qualified).toBe(false);
        expect(result.reason).toMatch(/7: 9.7% · 8: 9.7% · 9: 10.0% — not all under 10%/);
        expect(result.reason).toMatch(/needs each of 7, 8, 9 under 10%, 9 is at 10.0%\)$/);
    });

    it('names every one of 7, 8, 9 that is at 10% or more, and both rules when both fail', () => {
        const result = condition(windowOf([63, 64, 64, 52, 55, 56, 64, 60, 59, 63]));
        expect(result.qualified).toBe(false);
        expect(result.reason).toMatch(
            /\(not met: needs 3 of 0-3 at 10.6%\+, has 2; needs each of 7, 8, 9 under 10%, 7 is at 10.0%, 9 is at 10.5%\)$/
        );
    });

    it('is never qualified with fewer than 600 digits', () => {
        expect(condition(windowOf(PASSING).slice(1)).qualified).toBe(false);
        expect(condition([]).qualified).toBe(false);
    });
});

describe('Under entry', () => {
    // The window ends with the new digit, as the scanner's feed passes it.
    const enters = (tail: number[]) => entry(windowOf(PASSING, tail), tail[tail.length - 1]);

    it.each([
        [[1, 0, 7], true],
        [[2, 1, 0, 8], true],
        [[0, 0, 8], true],
        [[2, 2, 7], true],
        [[5, 1, 7], false], // only one of 0-2 before it
        [[1, 0, 9], false], // 9 never enters
        [[1, 6, 8], false],
        [[1, 0, 6], false],
        [[3, 1, 7], false], // 3 is not 0-2
    ])('...%p -> %p', (tail, expected) => {
        expect(enters(tail)).toBe(expected);
    });
});
