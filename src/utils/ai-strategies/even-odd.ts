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

const parityOf = (digit: number): TSide => (digit % 2 === 0 ? 'even' : 'odd');
const opposite = (side: TSide): TSide => (side === 'even' ? 'odd' : 'even');
const percent = (count: number) => `${((count / WINDOW) * 100).toFixed(1)}%`;

type TRanking = {
    counts: number[];
    /** The most appearing digits - all of them when several tie. */
    top: number[];
    /** The second most appearing digits; empty when several tie for most (they are the top two). */
    second: number[];
    /** The least appearing digits - more than one is a tie, which never qualifies. */
    least: number[];
};

const rank = (digits: number[]): TRanking => {
    const counts = new Array(10).fill(0);
    digits.slice(-WINDOW).forEach(digit => {
        counts[digit] += 1;
    });
    const all = counts.map((_, digit) => digit);
    const max = Math.max(...counts);
    const top = all.filter(digit => counts[digit] === max);
    const rest = all.filter(digit => counts[digit] < max);
    const second_count = rest.length ? Math.max(...rest.map(digit => counts[digit])) : -1;
    const second = top.length >= 2 ? [] : rest.filter(digit => counts[digit] === second_count);
    const min = Math.min(...counts);
    const least = all.filter(digit => counts[digit] === min);
    return { counts, top, second, least };
};

const list = (digits: number[], counts: number[]) =>
    `${digits.join(', ')} (${digits.length ? percent(counts[digits[0]]) : '-'})`;

type TSideCheck = { qualified: boolean; failures: string[]; strong: number[]; shortfall: number };

const checkSide = ({ counts, top, second, least }: TRanking, side: TSide): TSideCheck => {
    const failures: string[] = [];
    // Rule 1: the most and second most appearing digits are all of this parity.
    const leaders = [...top, ...second];
    if (!leaders.every(digit => parityOf(digit) === side)) {
        failures.push(top.length >= 2 ? `most (tied) not all ${side}` : `most / 2nd not both ${side}`);
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
 * EVEN qualifies when the most and second most appearing digits are even, at
 * least 3 even digits each appear 64+ times, and there is exactly one least
 * appearing digit, which is odd. ODD is the mirror. Even is checked first.
 * A tie for least never qualifies either side.
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
    const { counts, top, second, least } = ranking;
    const even = checkSide(ranking, 'even');
    const odd = checkSide(ranking, 'odd');
    const side: TSide = even.qualified || (!odd.qualified && parityOf(top[0]) === 'even') ? 'even' : 'odd';
    const shown = side === 'even' ? even : odd;

    const leaders =
        top.length >= 2 ? `Most ${list(top, counts)}` : `Most ${list(top, counts)}, 2nd ${list(second, counts)}`;
    const strong = `${shown.strong.length} ${side} at 10.6%+${shown.strong.length ? ` (${shown.strong.join(',')})` : ''}`;
    const least_text = least.length > 1 ? `least tied: ${list(least, counts)}` : `least ${list(least, counts)}`;
    const stats = `${leaders} · ${strong} · ${least_text}`;

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
 * 2+ odd digits that contains the least appearing digit (the single red bar
 * of the current window) anywhere but its last tick - the red bar was hit,
 * then at least one more odd digit, then the first even. ODD is the mirror.
 * A tie for least never enters.
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
    if (run.length < 2) return false;
    // Anywhere in the run except its last tick.
    return run.slice(0, -1).includes(least[0]);
};
