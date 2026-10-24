import type { TAiStrategy } from './types';

// Strategy "Under": the engine buys Under 7, and Under 6 in recovery after a
// loss (OVER_UNDER_SETUPS.under, AI DIRECTION 0 = DIGITUNDER). The direction is
// fixed by choosing this strategy. The exact mirror of over.ts.
// Recovery is the engine's own: every loss multiplies the stake by MARTINGALE
// and adds to LOSS COUNT, any LOSS COUNT > 0 buys Under 6, and a win resets the
// stake to Trade amount 2 and LOSS COUNT to 0 (back to Under 7).
//
// All thresholds are whole-number counts out of WINDOW, never float
// percentages: 10.6% of 600 = 63.6 -> at least 64; below 10% of 600 (60) ->
// at most 59 (exactly 60 = 10.0% does not pass).

const WINDOW = 600;
const LOW_DIGITS = [0, 1, 2, 3];
const LOW_MIN_COUNT = 64;
const LOW_DIGITS_NEEDED = 3;
const HIGH_DIGITS = [7, 8, 9];
const HIGH_MAX_COUNT = 59;

const percent = (count: number) => `${((count / WINDOW) * 100).toFixed(1)}%`;

const describe = (counts: number[], digits: number[]) =>
    digits.map(digit => `${digit}: ${percent(counts[digit])}`).join(' · ');

/**
 * Qualifies when at least 3 of the digits 0-3 each appear 64+ times (10.6%+)
 * AND each of 7, 8, 9 appears 59 times or fewer (under 10%) in the last 600.
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

    const low_count = LOW_DIGITS.filter(digit => counts[digit] >= LOW_MIN_COUNT).length;
    const rule_1 = low_count >= LOW_DIGITS_NEEDED;
    const rule_2 = HIGH_DIGITS.every(digit => counts[digit] <= HIGH_MAX_COUNT);

    const low_text = `${describe(counts, LOW_DIGITS)} — ${low_count} of 0-3 at 10.6%+`;
    const high_text = `${describe(counts, HIGH_DIGITS)} — ${rule_2 ? 'all under 10%' : 'not all under 10%'}`;
    const high_failing = HIGH_DIGITS.filter(digit => counts[digit] > HIGH_MAX_COUNT);
    // Ticks short: the best three of 0-3 up to 64, each of 7-9 down to 59.
    const shortfall =
        LOW_DIGITS.map(digit => counts[digit])
            .sort((a, b) => b - a)
            .slice(0, LOW_DIGITS_NEEDED)
            .reduce((sum, count) => sum + Math.max(0, LOW_MIN_COUNT - count), 0) +
        HIGH_DIGITS.reduce((sum, digit) => sum + Math.max(0, counts[digit] - HIGH_MAX_COUNT), 0);

    const failed = [
        !rule_1 && `needs 3 of 0-3 at 10.6%+, has ${low_count}`,
        !rule_2 &&
            `needs each of 7, 8, 9 under 10%, ${high_failing
                .map(digit => `${digit} is at ${percent(counts[digit])}`)
                .join(', ')}`,
    ].filter(Boolean);

    return {
        qualified: rule_1 && rule_2,
        reason: `${low_text} | ${high_text}${failed.length ? ` (not met: ${failed.join('; ')})` : ''}`,
        shortfall,
    };
};

const ENTRY_DIGITS = [7, 8];
const BEFORE_ENTRY_DIGITS = [0, 1, 2];

/**
 * Enters when the new digit is 7 or 8 and the two ticks just before it are
 * each 0, 1 or 2 (in any mix). 9 never triggers.
 *
 * `digits` already ends with `newDigit` (the scanner's feed appends each tick
 * before calling entry - useDigitAnalysis PUSH), so the two ticks before it are
 * at length-2 and length-3.
 */
export const entry: TAiStrategy['entry'] = (digits, newDigit) => {
    if (!ENTRY_DIGITS.includes(newDigit) || digits.length < 3) return false;
    return [digits[digits.length - 2], digits[digits.length - 3]].every(digit => BEFORE_ENTRY_DIGITS.includes(digit));
};
