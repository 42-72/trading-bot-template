/**
 * Pure statistics helpers for the Digit Analysis tool (Market Tool tab).
 *
 * This module is display-only math: it reports how an observed window of last
 * digits compares to what an independent, uniform RNG would produce. It must
 * never be extended to predict, recommend, or signal a "due" digit - each
 * digit from Deriv's RNG is independent of the ones before it.
 */

export const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const MIN_WINDOW_SIZE = 50;
export const MAX_WINDOW_SIZE = 5000;
export const DEFAULT_WINDOW_SIZE = 1000;

/**
 * Extracts the last digit of a quote, respecting the symbol's pip size.
 *
 * This is the one thing that quietly breaks these tools: a quote of 2740.40
 * is stored/arrives as the float 2740.4, so naively reading its last
 * character gives digit 4 instead of the correct 0. toFixed(pipSize) restores
 * the trailing zero the float dropped, so the last character is always the
 * digit actually quoted at this symbol's precision.
 *
 * pip_size must come from the ticks_history response (history.pip_size) -
 * the streamed `tick` message documents pip_size as optional and not
 * guaranteed, so never read it from there.
 */
export const getLastDigit = (quote: number | string, pipSize: number): number => {
    const fixed = Number(quote).toFixed(pipSize);
    return Number(fixed.slice(-1));
};

export const createEmptyCounts = (): number[] => new Array(10).fill(0);

/** One-time build of digit counts from a seed window (e.g. ticks_history). Not used per-tick. */
export const countDigits = (digits: number[]): number[] => {
    const counts = createEmptyCounts();
    digits.forEach(d => {
        counts[d] += 1;
    });
    return counts;
};

export type TStat = {
    label: string;
    /** Observed proportion (successCount / n). */
    pHat: number;
    /** Expected proportion under the null hypothesis of a uniform, independent RNG. */
    expected: number;
    /** Standard error of the expected proportion at this sample size. */
    se: number;
    bandLow: number;
    bandHigh: number;
    /** z-score of the observed proportion against the expected one. */
    z: number;
    isInsideBand: boolean;
    n: number;
};

/**
 * Computes the observed-vs-expected comparison for one binary measure
 * (e.g. "is even", "is over 4", "matches 7"). SE/band are computed from the
 * EXPECTED proportion (the null hypothesis), not the observed one - this is
 * "is what we observed consistent with a fair RNG", not a confidence
 * interval around the observation itself.
 */
export const computeStat = (successCount: number, n: number, expected: number, label = ''): TStat => {
    if (n <= 0) {
        return { label, pHat: 0, expected, se: 0, bandLow: expected, bandHigh: expected, z: 0, isInsideBand: true, n: 0 };
    }
    const pHat = successCount / n;
    const se = Math.sqrt((expected * (1 - expected)) / n);
    const bandLow = expected - 1.96 * se;
    const bandHigh = expected + 1.96 * se;
    const z = se === 0 ? 0 : (pHat - expected) / se;
    const isInsideBand = pHat >= bandLow && pHat <= bandHigh;
    return { label, pHat, expected, se, bandLow, bandHigh, z, isInsideBand, n };
};

/** Per-digit (0-9) observed-vs-expected stat, expected = 0.1 for every digit. */
export const computeDigitStats = (counts: number[], n: number): TStat[] =>
    DIGITS.map(digit => computeStat(counts[digit] ?? 0, n, 0.1, String(digit)));

export const computeEvenOddStats = (counts: number[], n: number) => {
    const evenCount = counts[0] + counts[2] + counts[4] + counts[6] + counts[8];
    const oddCount = n - evenCount;
    return {
        even: computeStat(evenCount, n, 0.5, 'Even'),
        odd: computeStat(oddCount, n, 0.5, 'Odd'),
    };
};

/**
 * Over N: last digit STRICTLY GREATER than N (so "Over 4" is 5,6,7,8,9 -
 * expected 50%, not 60%). Under N: strictly less than N. Digit === N counts
 * toward neither, so these two do not sum to 100% - each is its own
 * independent measure with its own expected value and band.
 */
export const computeOverUnderStats = (counts: number[], n: number, barrier: number) => {
    let overCount = 0;
    let underCount = 0;
    DIGITS.forEach(digit => {
        const c = counts[digit] ?? 0;
        if (digit > barrier) overCount += c;
        else if (digit < barrier) underCount += c;
    });
    return {
        over: computeStat(overCount, n, (9 - barrier) / 10, `Over ${barrier}`),
        under: computeStat(underCount, n, barrier / 10, `Under ${barrier}`),
    };
};

export const computeMatchesDiffersStats = (counts: number[], n: number, digit: number) => {
    const matchCount = counts[digit] ?? 0;
    const differCount = n - matchCount;
    return {
        matches: computeStat(matchCount, n, 0.1, `Matches ${digit}`),
        differs: computeStat(differCount, n, 0.9, `Differs ${digit}`),
    };
};

/** "R" if a tick's quote >= the previous quote, else "F" - see useDigitAnalysis. */
export const computeRiseFallStats = (directions: ('R' | 'F')[]) => {
    const n = directions.length;
    const riseCount = directions.filter(d => d === 'R').length;
    return {
        rise: computeStat(riseCount, n, 0.5, 'Rise'),
        fall: computeStat(n - riseCount, n, 0.5, 'Fall'),
    };
};

export type TDigitRank = 1 | 2 | 3 | 4;

/**
 * Ranks only the two most- and two least-frequent digits in the window (1 =
 * most frequent, 2 = 2nd most, 3 = 2nd least, 4 = least); the other six are
 * unranked. Ties are broken by digit value ascending, so ranking is stable
 * and reproducible rather than jumping around for cosmetic reasons.
 */
export const rankDigits = (counts: number[]): Map<number, TDigitRank> => {
    const ranks = new Map<number, TDigitRank>();
    const total = counts.reduce((sum, c) => sum + c, 0);
    if (total === 0) return ranks;
    const sorted = DIGITS.slice().sort((a, b) => counts[b] - counts[a] || a - b);
    ranks.set(sorted[0], 1);
    ranks.set(sorted[1], 2);
    ranks.set(sorted[8], 3);
    ranks.set(sorted[9], 4);
    return ranks;
};

/**
 * Length of the run of the most recent shared outcome at the end of a
 * history (e.g. "3x Under"). `null` entries (an outcome that belongs to
 * neither label, such as the barrier digit itself for Over/Under) are
 * skipped rather than breaking the streak, so a barrier hit doesn't reset an
 * otherwise-unbroken run. Purely descriptive of what already happened - not
 * a prediction of what comes next.
 */
export const computeStreak = <T extends string>(outcomes: (T | null)[]): { label: T; count: number } | null => {
    const labeled = outcomes.filter((o): o is T => o !== null);
    if (labeled.length === 0) return null;
    const last = labeled[labeled.length - 1];
    let count = 0;
    for (let i = labeled.length - 1; i >= 0; i--) {
        if (labeled[i] !== last) break;
        count++;
    }
    return { label: last, count };
};
