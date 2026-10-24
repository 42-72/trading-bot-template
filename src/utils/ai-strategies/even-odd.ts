import type { TAiStrategy, TConditionResult, TSide } from './types';

// Strategy "Even/Odd": one strategy, and for each market the AI decides the
// side. Even -> the engine buys DIGITEVEN (AI DIRECTION 1), Odd -> DIGITODD
// (AI DIRECTION 0), bull-ai-evenodd.xml. After a loss the engine stays on the
// same market and side with the stake times MARTINGALE; a win resets the
// stake to Trade amount 2.
//
// Whole-number counts out of WINDOW: 10.6% of 600 = 63.6 -> at least 64.

const WINDOW = 600;
const MIN_COUNT = 64;
const DIGITS_NEEDED = 3;
// Rule 1 looks at the TOP_PLACES most appearing digits.
const TOP_PLACES = 3;
// Entry: odd digits (for EVEN) that must follow the red bar inside the run.
const AFTER_RED_BAR = 2;

// An armed market is dropped the moment its condition no longer holds for
// its armed side (fails, or flips to the other side) - see TAiStrategy.
export const keepArmedWhenConditionFades = false;

const parityOf = (digit: number): TSide => (digit % 2 === 0 ? 'even' : 'odd');
const opposite = (side: TSide): TSide => (side === 'even' ? 'odd' : 'even');
const percent = (count: number) => `${((count / WINDOW) * 100).toFixed(1)}%`;

type TRanking = {
    counts: number[];
    /**
     * The three most appearing digits, most first (ties by digit). A tie
     * straddling 3rd place brings in every tied digit, so there can be more.
     */
    top: number[];
    /** The least appearing digits - more than one is a tie, which never qualifies. */
    least: number[];
};

const rank = (digits: number[]): TRanking => {
    const counts = new Array(10).fill(0);
    digits.slice(-WINDOW).forEach(digit => {
        counts[digit] += 1;
    });
    const sorted = counts.map((_, digit) => digit).sort((a, b) => counts[b] - counts[a] || a - b);
    const third_count = counts[sorted[TOP_PLACES - 1]];
    const top = sorted.filter(digit => counts[digit] >= third_count);
    const min = Math.min(...counts);
    const least = sorted.filter(digit => counts[digit] === min).sort((a, b) => a - b);
    return { counts, top, least };
};

type TSideCheck = { qualified: boolean; failures: string[]; strong: number[]; shortfall: number };

const checkSide = ({ counts, top, least }: TRanking, side: TSide): TSideCheck => {
    const failures: string[] = [];
    // Rule 1: the three most appearing digits (every one tied for 3rd too) are of this parity.
    if (!top.every(digit => parityOf(digit) === side)) {
        failures.push(top.length > TOP_PLACES ? `top 3 (with ties) not all ${side}` : `top 3 not all ${side}`);
    }
    // Rule 2: at least three digits of this parity at 10.6%+.
    const side_digits = counts.map((_, digit) => digit).filter(digit => parityOf(digit) === side);
    const strong = side_digits.filter(digit => counts[digit] >= MIN_COUNT);
    if (strong.length < DIGITS_NEEDED) failures.push(`only ${strong.length} ${side} at 10.6%+`);
    // Rule 3: exactly one least appearing digit, of the other parity.
    if (least.length > 1) failures.push('two digits tie for least');
    else if (parityOf(least[0]) !== opposite(side)) failures.push(`least ${least[0]} is ${side}`);

    // Hidden ranking for the panel's "Closest": ticks short on rule 2, plus
    // one per other rule missed.
    const shortfall =
        side_digits
            .map(digit => counts[digit])
            .sort((a, b) => b - a)
            .slice(0, DIGITS_NEEDED)
            .reduce((sum, count) => sum + Math.max(0, MIN_COUNT - count), 0) +
        failures.filter(failure => !failure.includes('10.6%')).length;
    return { qualified: failures.length === 0, failures, strong, shortfall };
};

/**
 * EVEN qualifies when the three most appearing digits are even (all of them,
 * when a tie straddles 3rd place), at least 3 even digits each appear 64+
 * times, and there is exactly one least appearing digit, which is odd. ODD is
 * the mirror. Even is checked first. A tie for least never qualifies.
 */
export const condition: TAiStrategy['condition'] = digits => {
    if (digits.length < WINDOW) {
        return {
            qualified: false,
            reason: `Not enough ticks yet (${digits.length} of ${WINDOW}).`,
            shortfall: WINDOW - digits.length,
        };
    }

    const ranking = rank(digits);
    const { counts, top, least } = ranking;
    const even = checkSide(ranking, 'even');
    const odd = checkSide(ranking, 'odd');
    const side: TSide = even.qualified || (!odd.qualified && parityOf(top[0]) === 'even') ? 'even' : 'odd';
    const shown = side === 'even' ? even : odd;

    const top_text = `Top 3: ${top.map(digit => `${digit} (${percent(counts[digit])})`).join(', ')}`;
    const strong = `${shown.strong.length} ${side} at 10.6%+`;
    const least_text =
        least.length > 1
            ? `least tied: ${least.join(', ')} (${percent(counts[least[0]])})`
            : `least ${least[0]} (${percent(counts[least[0]])})`;
    const stats = `${top_text} · ${strong} · ${least_text}`;

    const result: TConditionResult = {
        qualified: even.qualified || odd.qualified,
        side,
        shortfall: Math.min(even.shortfall, odd.shortfall),
        reason: stats,
    };
    if (least.length === 1) result.leastDigit = least[0];
    if (!result.qualified) {
        result.reason = `${stats} (not met: even: ${even.failures.join(', ')}; odd: ${odd.failures.join(', ')})`;
    }
    return result;
};

/**
 * EVEN entry: the new digit is even, and just before it is an unbroken run of
 * odd digits containing the least appearing digit (the single red bar of the
 * current window) followed by at least two more odd digits - the red bar was
 * hit, then 2+ more odd digits, then the first even. ODD is the mirror. A tie
 * for least never enters.
 *
 * `digits` already ends with `newDigit` (as for Over/Under), so the run ends
 * at length-2. `side` is the side the market armed with.
 */
export const entry: TAiStrategy['entry'] = (digits, newDigit, context) => {
    const side = context?.side ?? (condition(digits).side as TSide | undefined);
    if (!side || digits.length < 3 || parityOf(newDigit) !== side) return false;
    const { least } = rank(digits);
    if (least.length !== 1) return false;

    const run_parity = opposite(side);
    const run: number[] = [];
    for (let i = digits.length - 2; i >= 0 && parityOf(digits[i]) === run_parity; i--) run.unshift(digits[i]);
    // The red bar anywhere with at least AFTER_RED_BAR run ticks after it.
    return run.slice(0, -AFTER_RED_BAR).includes(least[0]);
};
