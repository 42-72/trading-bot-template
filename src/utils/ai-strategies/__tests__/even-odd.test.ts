import { condition, entry } from '../even-odd';

/**
 * A 600-digit window with exactly `counts[d]` of each digit d, ending with
 * `tail` (the tail is part of the counts). The body puts odd digits first and
 * even digits last, so with an EVEN-side tail the tick before the tail is even
 * and never stretches a run of odd digits (and the reverse for `odd_last`).
 */
const windowOf = (counts: number[], tail: number[] = [], odd_last = false) => {
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(600);
    const remaining = counts.slice();
    tail.forEach(digit => {
        remaining[digit] -= 1;
    });
    expect(remaining.every(count => count >= 0)).toBe(true);
    const of = (parity: number) =>
        remaining.flatMap((count, digit) => (digit % 2 === parity ? new Array(count).fill(digit) : []));
    const body = odd_last ? [...of(0), ...of(1)] : [...of(1), ...of(0)];
    return [...body, ...tail];
};
// d -> 9 - d turns every even digit odd and back: the ODD side is the mirror.
const mirrorCounts = (counts: number[]) => counts.map((_, digit) => counts[9 - digit]);

//               0   1   2   3   4   5   6   7   8   9
const EVEN = [68, 59, 62, 57, 72, 58, 60, 50, 66, 48]; // top 3: 4, 0, 8 - all even; 3 even at 64+; least 9

describe('Even/Odd condition', () => {
    it('EVEN: the top 3 even, 3+ even at 64+, a single odd least digit', () => {
        const result = condition(windowOf(EVEN));
        expect(result).toMatchObject({ qualified: true, side: 'even', leastDigit: 9 });
        expect(result.reason).toBe('Top 3: 4 (12.0%), 0 (11.3%), 8 (11.0%) · 3 even at 10.6%+ · least 9 (8.0%)');
    });

    it('ODD: the exact mirror', () => {
        const result = condition(windowOf(mirrorCounts(EVEN)));
        expect(result).toMatchObject({ qualified: true, side: 'odd', leastDigit: 0 });
        expect(result.reason).toBe('Top 3: 5 (12.0%), 9 (11.3%), 1 (11.0%) · 3 odd at 10.6%+ · least 0 (8.0%)');
    });

    it('the 3rd most appearing digit odd fails EVEN (most and 2nd even are no longer enough)', () => {
        //                   0   1   2   3   4   5   6   7   8   9
        const third_odd = [68, 58, 62, 56, 72, 66, 60, 50, 64, 44];
        const result = condition(windowOf(third_odd));
        expect(result.qualified).toBe(false);
        expect(result.reason).toMatch(/^Top 3: 4 \(12.0%\), 0 \(11.3%\), 5 \(11.0%\) · /);
        expect(result.reason).toMatch(/even: top 3 not all even;/);
        expect(condition(windowOf(mirrorCounts(third_odd))).qualified).toBe(false);
    });

    it('a tie straddling 3rd place brings in every tied digit - all must be even', () => {
        //                       0   1   2   3   4   5   6   7   8   9
        const tie_all_even = [68, 59, 65, 57, 72, 58, 60, 50, 65, 46];
        const result = condition(windowOf(tie_all_even));
        expect(result).toMatchObject({ qualified: true, side: 'even' });
        expect(result.reason).toMatch(/^Top 3: 4 \(12.0%\), 0 \(11.3%\), 2 \(10.8%\), 8 \(10.8%\) · /);
        expect(condition(windowOf(mirrorCounts(tie_all_even)))).toMatchObject({ qualified: true, side: 'odd' });

        //                        0   1   2   3   4   5   6   7   8   9
        const tie_with_odd = [68, 58, 62, 56, 72, 65, 60, 50, 65, 44];
        const mixed = condition(windowOf(tie_with_odd));
        expect(mixed.qualified).toBe(false);
        expect(mixed.reason).toMatch(/^Top 3: 4 \(12.0%\), 0 \(11.3%\), 5 \(10.8%\), 8 \(10.8%\) · /);
        expect(mixed.reason).toMatch(/top 3 \(with ties\) not all even/);
        expect(condition(windowOf(mirrorCounts(tie_with_odd))).qualified).toBe(false);
    });

    it('a tie for least never qualifies, either side', () => {
        //                0   1   2   3   4   5   6   7   8   9
        const tied = [68, 59, 62, 59, 72, 58, 60, 48, 66, 48];
        [tied, mirrorCounts(tied)].forEach(counts => {
            const result = condition(windowOf(counts));
            expect(result.qualified).toBe(false);
            expect(result.leastDigit).toBeUndefined();
            expect(result.reason).toMatch(/least tied: /);
            expect(result.reason).toMatch(/two digits tie for least/);
        });
    });

    it('three even digits at 64 qualify; one of them at 63 does not', () => {
        //                0   1   2   3   4   5   6   7   8   9
        const three = [66, 60, 62, 59, 72, 59, 60, 56, 64, 42];
        expect(condition(windowOf(three))).toMatchObject({ qualified: true, side: 'even' });
        expect(condition(windowOf(three)).reason).toMatch(/· 3 even at 10.6%\+ ·/);
        expect(condition(windowOf(mirrorCounts(three)))).toMatchObject({ qualified: true, side: 'odd' });

        const two = [66, 60, 62, 59, 72, 59, 61, 56, 63, 42];
        const result = condition(windowOf(two));
        expect(result.qualified).toBe(false);
        expect(result.reason).toMatch(/only 2 even at 10.6%\+/);
        expect(condition(windowOf(mirrorCounts(two))).qualified).toBe(false);
    });

    it('an even least digit fails the EVEN side', () => {
        //                     0   1   2   3   4   5   6   7   8   9
        const least_even = [68, 59, 66, 58, 72, 58, 62, 57, 44, 56]; // least 8
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
    const LEAST_3 = [68, 59, 62, 44, 72, 58, 60, 56, 66, 55]; // EVEN side, least digit 3

    it('the window really has 3 as its single least, on the EVEN side', () => {
        expect(condition(windowOf(LEAST_3))).toMatchObject({ qualified: true, side: 'even', leastDigit: 3 });
    });

    // EVEN: an even digit after a run of odd digits that hit the 3, then 2+ more odd digits.
    it.each([
        [[3, 5, 7, 4], true],
        [[3, 1, 9, 5, 2], true],
        [[1, 3, 5, 7, 8], true],
        [[3, 5, 4], false], // only one odd after the 3
        [[5, 3, 1, 4], false], // only one odd after the 3
        [[3, 4], false],
        [[9, 1, 5, 2], false], // no 3 in the run
        [[3, 5, 7, 9], false], // the new digit is odd
    ])('EVEN (least 3): ...%p -> %p', (tail, expected) => {
        expect(entry(windowOf(LEAST_3, tail), tail[tail.length - 1], { side: 'even' })).toBe(expected);
    });

    // ODD: the mirror (d -> 9 - d) - least 6, an odd digit after the 6 and 2+ more even digits.
    it.each([
        [[6, 4, 2, 5], true],
        [[6, 8, 0, 4, 7], true],
        [[8, 6, 4, 2, 1], true],
        [[6, 4, 5], false],
        [[4, 6, 8, 5], false],
        [[6, 5], false],
        [[0, 8, 4, 7], false],
        [[6, 4, 2, 0], false],
    ])('ODD (least 6): ...%p -> %p', (tail, expected) => {
        const odd_side = windowOf(mirrorCounts(LEAST_3), tail, true); // body ends with odd digits
        expect(condition(odd_side)).toMatchObject({ qualified: true, side: 'odd', leastDigit: 6 });
        expect(entry(odd_side, tail[tail.length - 1], { side: 'odd' })).toBe(expected);
    });

    it('a tie for least: entry is false', () => {
        //                0   1   2   3   4   5   6   7   8   9
        const tied = [68, 59, 62, 48, 72, 58, 60, 59, 66, 48]; // 3 and 9 tie for least
        const digits = windowOf(tied, [3, 5, 7, 4]);
        expect(entry(digits, 4, { side: 'even' })).toBe(false);
    });

    it('uses the side it is given (the armed side), not the live one', () => {
        const digits = windowOf(LEAST_3, [3, 5, 7, 4]);
        expect(entry(digits, 4, { side: 'even' })).toBe(true);
        expect(entry(digits, 4, { side: 'odd' })).toBe(false);
    });
});
