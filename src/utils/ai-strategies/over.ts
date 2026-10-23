import type { TAiStrategy } from './types';

// Strategy "Over": the engine buys Over 2, and Over 3 in recovery after a loss
// (OVER_UNDER_SETUPS.over). The direction is fixed by choosing this strategy.
// Recovery is the engine's own: every loss multiplies the stake by MARTINGALE
// and adds to LOSS COUNT, any LOSS COUNT > 0 buys Over 3, and a win resets the
// stake to Trade amount 2 and LOSS COUNT to 0 (back to Over 2).
//
// All thresholds are whole-number counts out of WINDOW, never float
// percentages: 10.6% of 600 = 63.6 -> at least 64; 9.8% of 600 = 58.8 ->
// at most 58.

const WINDOW = 600;
const HIGH_DIGITS = [6, 7, 8, 9];
const HIGH_MIN_COUNT = 64;
const HIGH_DIGITS_NEEDED = 3;
const LOW_DIGITS = [0, 1, 2];
const LOW_MAX_COUNT = 58;

const percent = (count: number) => `${((count / WINDOW) * 100).toFixed(1)}%`;

const describe = (counts: number[], digits: number[]) =>
    digits.map(digit => `${digit}: ${percent(counts[digit])}`).join(' · ');

/**
 * Qualifies when at least 3 of the digits 6-9 each appear 64+ times (10.6%+)
 * AND each of 0, 1, 2 appears 58 times or fewer (under 9.8%) in the last 600.
 */
export const condition: TAiStrategy['condition'] = digits => {
    if (digits.length < WINDOW) {
        return {
            qualified: false,
            reason: `Not enough ticks yet (${digits.length} of ${WINDOW}).`,
            shortfall: WINDOW - digits.length,
        };
    }

    const counts = new Array(10).fill(0);
    digits.slice(-WINDOW).forEach(digit => {
        counts[digit] += 1;
    });

    const high_count = HIGH_DIGITS.filter(digit => counts[digit] >= HIGH_MIN_COUNT).length;
    const rule_1 = high_count >= HIGH_DIGITS_NEEDED;
    const rule_2 = LOW_DIGITS.every(digit => counts[digit] <= LOW_MAX_COUNT);

    const high_text = `${describe(counts, HIGH_DIGITS)} — ${high_count} of 6-9 at 10.6%+`;
    const low_text = `${describe(counts, LOW_DIGITS)} — ${rule_2 ? 'all under 9.8%' : 'not all under 9.8%'}`;
    // Ticks short: the best three of 6-9 up to 64, each of 0-2 down to 58.
    const shortfall =
        HIGH_DIGITS.map(digit => counts[digit])
            .sort((a, b) => b - a)
            .slice(0, HIGH_DIGITS_NEEDED)
            .reduce((sum, count) => sum + Math.max(0, HIGH_MIN_COUNT - count), 0) +
        LOW_DIGITS.reduce((sum, digit) => sum + Math.max(0, counts[digit] - LOW_MAX_COUNT), 0);

    const failed = [
        !rule_1 && `needs 3 of 6-9 at 10.6%+, has ${high_count}`,
        !rule_2 && 'needs each of 0, 1, 2 under 9.8%',
    ].filter(Boolean);

    return {
        qualified: rule_1 && rule_2,
        reason: `${high_text} | ${low_text}${failed.length ? ` (not met: ${failed.join('; ')})` : ''}`,
        shortfall,
    };
};

const ENTRY_DIGITS = [1, 2];
const BEFORE_ENTRY_DIGITS = [7, 8, 9];

/**
 * Enters when the new digit is 1 or 2 and the two ticks just before it are
 * each 7, 8 or 9 (in any mix). 0 never triggers.
 *
 * `digits` already ends with `newDigit` (the scanner's feed appends each tick
 * before calling entry - useDigitAnalysis PUSH), so the two ticks before it are
 * at length-2 and length-3.
 */
export const entry: TAiStrategy['entry'] = (digits, newDigit) => {
    if (!ENTRY_DIGITS.includes(newDigit) || digits.length < 3) return false;
    return [digits[digits.length - 2], digits[digits.length - 3]].every(digit => BEFORE_ENTRY_DIGITS.includes(digit));
};
