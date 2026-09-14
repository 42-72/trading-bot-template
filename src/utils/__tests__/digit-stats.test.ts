import { computeOverUnderStats, computeStat, getLastDigit } from '../digit-stats';

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
});
