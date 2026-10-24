import { condition, entry } from '../even-odd';

/**
 * A 600-digit window with exactly `counts[d]` of each digit d, ending with
 * `tail` (the tail is part of the counts). The body puts odd digits first and
 * even digits last, so with an EVEN-side tail the tick before the tail is even
 * and never stretches a run of odd digits (and the reverse for `odd_last`).
 */
const windowOf = (counts: number[], tail: number[] = [], odd_last = false) => {
    const remaining = counts.slice();
    tail.forEach(digit => {
        remaining[digit] -= 1;
    });
    expect(remaining.every(count => count >= 0)).toBe(true);
    const of = (parity: number) =>
        remaining.flatMap((count, digit) => (digit % 2 === parity ? new Array(count).fill(digit) : []));
    const body = odd_last ? [...of(0), ...of(1)] : [...of(1), ...of(0)];
    const digits = [...body, ...tail];
    expect(digits).toHaveLength(600);
    return digits;
};
// d -> 9 - d turns every even digit odd and back: the ODD side is the mirror.
const mirrorCounts = (counts: number[]) => counts.map((_, digit) => counts[9 - digit]);

//               0   1   2   3   4   5   6   7   8   9
const EVEN = [64, 59, 68, 58, 71, 59, 64, 50, 64, 43]; // most 4, 2nd 2, 5 even at 64+, least 9

describe('Even/Odd condition', () => {
    it('EVEN: most and 2nd even, 3+ even at 64+, a single odd least digit', () => {
        const result = condition(windowOf(EVEN));
        expect(result).toMatchObject({ qualified: true, side: 'even', leastDigit: 9 });
        expect(result.reason).toBe('Most 4 (11.8%), 2nd 2 (11.3%) · 5 even at 10.6%+ (0,2,4,6,8) · least 9 (7.2%)');
    });

    it('ODD: the exact mirror', () => {
        const result = condition(windowOf(mirrorCounts(EVEN)));
        expect(result).toMatchObject({ qualified: true, side: 'odd', leastDigit: 0 });
        expect(result.reason).toBe('Most 5 (11.8%), 2nd 7 (11.3%) · 5 odd at 10.6%+ (1,3,5,7,9) · least 0 (7.2%)');
    });

    it('a tie for least never qualifies, either side', () => {
        //                0   1   2   3   4   5   6   7   8   9
        const tied = [64, 59, 68, 59, 71, 59, 64, 46, 64, 46];
        [tied, mirrorCounts(tied)].forEach(counts => {
            const result = condition(windowOf(counts));
            expect(result.qualified).toBe(false);
            expect(result.leastDigit).toBeUndefined();
            expect(result.reason).toMatch(/least tied: /);
            expect(result.reason).toMatch(/two digits tie for least/);
        });
    });

    it('several tied for most are the top two - all must be the right parity', () => {
        //                     0   1   2   3   4   5   6   7   8   9
        const both_even = [64, 59, 70, 58, 70, 58, 64, 50, 64, 43];
        expect(condition(windowOf(both_even))).toMatchObject({ qualified: true, side: 'even' });
        expect(condition(windowOf(both_even)).reason).toMatch(/^Most 2, 4 \(11.7%\) · /);
        expect(condition(windowOf(mirrorCounts(both_even)))).toMatchObject({ qualified: true, side: 'odd' });

        const even_and_odd = [64, 58, 64, 58, 70, 70, 64, 45, 64, 43];
        const result = condition(windowOf(even_and_odd));
        expect(result.qualified).toBe(false);
        expect(result.reason).toMatch(/most \(tied\) not all even/);
        expect(condition(windowOf(mirrorCounts(even_and_odd))).qualified).toBe(false);
    });

    it('several tied for 2nd must all be the right parity', () => {
        //                      0   1   2   3   4   5   6   7   8   9
        const second_even = [64, 59, 66, 58, 72, 58, 66, 50, 64, 43];
        expect(condition(windowOf(second_even))).toMatchObject({ qualified: true, side: 'even' });
        expect(condition(windowOf(second_even)).reason).toMatch(/^Most 4 \(12.0%\), 2nd 2, 6 \(11.0%\)/);
        expect(condition(windowOf(mirrorCounts(second_even)))).toMatchObject({ qualified: true, side: 'odd' });

        const second_mixed = [64, 58, 66, 66, 72, 58, 60, 49, 64, 43];
        const result = condition(windowOf(second_mixed));
        expect(result.qualified).toBe(false);
        expect(result.reason).toMatch(/most \/ 2nd not both even/);
        expect(condition(windowOf(mirrorCounts(second_mixed))).qualified).toBe(false);
    });

    it('three even digits at 64 qualify; one of them at 63 does not', () => {
        //                0   1   2   3   4   5   6   7   8   9
        const three = [64, 60, 66, 60, 72, 59, 60, 56, 60, 43];
        expect(condition(windowOf(three))).toMatchObject({ qualified: true, side: 'even' });
        expect(condition(windowOf(three)).reason).toMatch(/· 3 even at 10.6%\+ \(0,2,4\) ·/);
        expect(condition(windowOf(mirrorCounts(three)))).toMatchObject({ qualified: true, side: 'odd' });

        const two = [63, 60, 66, 60, 72, 59, 61, 56, 60, 43];
        const result = condition(windowOf(two));
        expect(result.qualified).toBe(false);
        expect(result.reason).toMatch(/only 2 even at 10.6%\+/);
        expect(condition(windowOf(mirrorCounts(two))).qualified).toBe(false);
    });

    it('an even least digit fails the EVEN side', () => {
        //                     0   1   2   3   4   5   6   7   8   9
        const least_even = [64, 59, 68, 58, 71, 59, 64, 58, 49, 50]; // least 8
        const result = condition(windowOf(least_even));
        expect(result.qualified).toBe(false);
        expect(result.reason).toMatch(/least 8 is even/);
    });

    it('is never qualified with fewer than 600 digits', () => {
        expect(condition(windowOf(EVEN).slice(1)).qualified).toBe(false);
        expect(condition([]).qualified).toBe(false);
    });
});

describe('Even/Odd entry', () => {
    //                    0   1   2   3   4   5   6   7   8   9
    const LEAST_3 = [64, 59, 68, 43, 71, 59, 64, 50, 64, 58]; // EVEN side, least digit 3

    it('the window really has 3 as its single least, on the EVEN side', () => {
        expect(condition(windowOf(LEAST_3))).toMatchObject({ qualified: true, side: 'even', leastDigit: 3 });
    });

    // EVEN: an even digit after a run of 2+ odd digits that hit the 3 before its last tick.
    it.each([
        [[3, 5, 4], true],
        [[3, 1, 7, 8], true],
        [[1, 3, 5, 2], true],
        [[3, 4], false], // the run is only the 3
        [[5, 3, 4], false], // no odd digit after the 3
        [[9, 1, 2], false], // no 3 in the run
        [[3, 5, 7], false], // the new digit is odd
    ])('EVEN (least 3): ...%p -> %p', (tail, expected) => {
        expect(entry(windowOf(LEAST_3, tail), tail[tail.length - 1], { side: 'even' })).toBe(expected);
    });

    // ODD: the mirror - least 6, an odd digit after a run of 2+ even digits that hit the 6.
    it.each([
        [[6, 4, 5], true],
        [[6, 8, 2, 1], true],
        [[8, 6, 4, 7], true],
        [[6, 5], false],
        [[4, 6, 5], false],
        [[0, 8, 7], false],
        [[6, 4, 2], false],
    ])('ODD (least 6): ...%p -> %p', (tail, expected) => {
        const odd_side = windowOf(mirrorCounts(LEAST_3), tail, true); // body ends with odd digits
        expect(condition(odd_side)).toMatchObject({ qualified: true, side: 'odd', leastDigit: 6 });
        expect(entry(odd_side, tail[tail.length - 1], { side: 'odd' })).toBe(expected);
    });

    it('a tie for least: entry is false', () => {
        //                0   1   2   3   4   5   6   7   8   9
        const tied = [73, 59, 68, 46, 71, 59, 64, 50, 64, 46]; // 3 and 9 tie for least
        const digits = windowOf(tied, [3, 5, 4]);
        expect(entry(digits, 4, { side: 'even' })).toBe(false);
    });

    it('uses the side it is given (the armed side), not the live one', () => {
        const digits = windowOf(LEAST_3, [3, 5, 4]);
        expect(entry(digits, 4, { side: 'even' })).toBe(true);
        expect(entry(digits, 4, { side: 'odd' })).toBe(false);
    });
});
