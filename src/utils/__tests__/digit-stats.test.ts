import {
    computeOverUnderStats,
    computeStat,
    computeStreak,
    DIGITS,
    getLastDigit,
    getOverUnderOutcome,
    OVER_UNDER_CHIP_TEXT,
    rankDigits,
} from '../digit-stats';

describe('getLastDigit', () => {
    // The bug this guards against: a quote of 2740.40 arrives/is stored as
    // the float 2740.4, so reading its last character naively gives 4
    // instead of the correct 0 (the trailing zero toFixed(pipSize) restores).
    it('reads 2740.40 at pip_size 2 as digit 0, not 4', () => {
        expect(getLastDigit(2740.4, 2)).toBe(0);
    });

    it('reads 2740.4 at pip_size 1 as digit 4', () => {
        expect(getLastDigit(2740.4, 1)).toBe(4);
    });

    it('reads 1234.5 at pip_size 2 as digit 0', () => {
        expect(getLastDigit(1234.5, 2)).toBe(0);
    });

    it('accepts a string quote, as the API sends it', () => {
        expect(getLastDigit('2740.40', 2)).toBe(0);
    });
});

describe('computeStat', () => {
    it('flags a textbook-fair result as inside the band', () => {
        // 250/500 = exactly 0.5, expected 0.5 -> z = 0
        const stat = computeStat(250, 500, 0.5);
        expect(stat.pHat).toBe(0.5);
        expect(stat.z).toBe(0);
        expect(stat.isInsideBand).toBe(true);
    });

    it('flags an extreme run as outside the band', () => {
        // 400/500 = 0.8 vs expected 0.5 is many SEs away
        const stat = computeStat(400, 500, 0.5);
        expect(stat.isInsideBand).toBe(false);
        expect(stat.z).toBeGreaterThan(1.96);
    });

    it('handles n = 0 without dividing by zero', () => {
        const stat = computeStat(0, 0, 0.1);
        expect(stat.n).toBe(0);
        expect(stat.pHat).toBe(0);
        expect(stat.isInsideBand).toBe(true);
    });
});

describe('computeOverUnderStats', () => {
    it('treats "Over 4" as strictly greater than 4 (digits 5-9), expected 50% not 60%', () => {
        // counts index = digit; put 100 ticks on each of 5,6,7,8,9 (over) and
        // none anywhere else, n = 500
        const counts = [0, 0, 0, 0, 0, 100, 100, 100, 100, 100];
        const { over, under } = computeOverUnderStats(counts, 500, 4);
        expect(over.expected).toBe(0.5);
        expect(over.pHat).toBe(1);
        // digit === 4 counts toward neither over nor under
        expect(under.expected).toBe(0.4);
        expect(under.pHat).toBe(0);
    });

    it('Over % + Under % + the barrier digit % = 100%', () => {
        const counts = [11, 9, 10, 12, 8, 10, 10, 9, 11, 10];
        const n = counts.reduce((sum, c) => sum + c, 0);
        DIGITS.forEach(barrier => {
            const { over, under } = computeOverUnderStats(counts, n, barrier);
            expect(over.pHat + under.pHat + counts[barrier] / n).toBeCloseTo(1, 10);
        });
    });
});

const tones = (counts: number[]) => {
    const ranks = rankDigits(counts);
    const byRank = (rank: number) => DIGITS.filter(d => ranks.get(d) === rank);
    return { green: byRank(1), blue: byRank(2), yellow: byRank(3), red: byRank(4) };
};

describe('rankDigits', () => {
    it('gives one digit each colour when all counts differ', () => {
        expect(tones([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])).toEqual({ green: [0], blue: [1], yellow: [8], red: [9] });
    });

    it('colours both digits red when two tie for least', () => {
        const { red, yellow } = tones([10, 11, 12, 5, 13, 14, 15, 5, 16, 17]);
        expect(red).toEqual([3, 7]);
        expect(yellow).toEqual([0]);
    });

    it('colours all three digits green when three tie for most', () => {
        const { green, blue } = tones([20, 20, 20, 10, 11, 12, 13, 14, 15, 16]);
        expect(green).toEqual([0, 1, 2]);
        expect(blue).toEqual([9]);
    });

    it('colours both digits yellow when two tie for 2nd least', () => {
        const { yellow, red } = tones([1, 4, 4, 10, 11, 12, 13, 14, 15, 16]);
        expect(red).toEqual([0]);
        expect(yellow).toEqual([1, 2]);
    });

    it('colours nothing when all ten digits have the same count', () => {
        expect(rankDigits(new Array(10).fill(7)).size).toBe(0);
    });

    it('colours nothing on an empty window', () => {
        expect(rankDigits(new Array(10).fill(0)).size).toBe(0);
    });

    it('compares raw counts, not rounded percentages (96 vs 95 of 1000 both show ~9.6%)', () => {
        const { red, yellow } = tones([96, 95, 100, 101, 102, 103, 104, 105, 97, 97]);
        expect(red).toEqual([1]);
        expect(yellow).toEqual([0]);
    });

    it('lets green and red win when there are only two distinct counts', () => {
        expect(tones([5, 5, 5, 5, 5, 9, 9, 9, 9, 9])).toEqual({
            green: [5, 6, 7, 8, 9],
            blue: [],
            yellow: [],
            red: [0, 1, 2, 3, 4],
        });
    });

    it('gives the middle count blue (not yellow) when there are three distinct counts', () => {
        expect(tones([1, 2, 2, 2, 2, 2, 2, 2, 2, 3])).toEqual({
            green: [9],
            blue: [1, 2, 3, 4, 5, 6, 7, 8],
            yellow: [],
            red: [0],
        });
    });
});

describe('Over/Under chip outcome', () => {
    it('selected 7 and digit 7 -> "="', () => {
        expect(OVER_UNDER_CHIP_TEXT[getOverUnderOutcome(7, 7)]).toBe('=');
    });

    it('selected 7 and digit 8 -> "O"', () => {
        expect(OVER_UNDER_CHIP_TEXT[getOverUnderOutcome(8, 7)]).toBe('O');
    });

    it('selected 7 and digit 6 -> "U"', () => {
        expect(OVER_UNDER_CHIP_TEXT[getOverUnderOutcome(6, 7)]).toBe('U');
    });

    it('streak treats "=" as its own result, not Under or Over', () => {
        const outcomes = [5, 6, 7].map(d => getOverUnderOutcome(d, 7));
        expect(computeStreak(outcomes)).toEqual({ label: 'Equal', count: 1 });
    });

    it('an "=" breaks an Under run', () => {
        const outcomes = [3, 4, 7, 2].map(d => getOverUnderOutcome(d, 7));
        expect(computeStreak(outcomes)).toEqual({ label: 'Under', count: 1 });
    });
});
