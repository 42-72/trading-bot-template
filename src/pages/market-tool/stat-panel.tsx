import { useState } from 'react';
import classNames from 'classnames';
import { DIGITS } from '@/utils/digit-stats';
import StatRow from './stat-row';

type TTone = 'tone-green' | 'tone-red' | 'tone-blue' | 'tone-yellow';

type TChip = { text: string; tone: TTone };

type TStatPanelProps = {
    title: string;
    rows: { label: string; pct: number; hasData: boolean; tone: TTone }[];
    streak: { label: string; count: number; tone: TTone } | null;
    picker?: { value: number; onChange: (digit: number) => void; ariaLabel: string };
    /** Oldest first, newest last - already the full available history (component slices to 10/40 itself). */
    chips: TChip[];
};

/**
 * One of the four Even/Odd, Over/Under, Match/Differ, Rise/Fall panels.
 * Everything here is a description of what already happened in the current
 * window - the streak badge and chip history included - never a prediction.
 */
const StatPanel = ({ title, rows, streak, picker, chips }: TStatPanelProps) => {
    const [showMore, setShowMore] = useState(false);
    const visibleChips = showMore ? chips.slice(-40) : chips.slice(-10);

    return (
        <div className='stat-panel'>
            <div className='stat-panel__header'>
                <span className='stat-panel__title'>{title}</span>
                {streak && (
                    <span className={classNames('stat-panel__streak', streak.tone)}>
                        {streak.count}× {streak.label}
                    </span>
                )}
            </div>

            {picker && (
                <div className='digit-picker' role='group' aria-label={picker.ariaLabel}>
                    {DIGITS.map(d => (
                        <button
                            key={d}
                            type='button'
                            className={classNames('digit-picker__btn', {
                                'digit-picker__btn--selected': d === picker.value,
                            })}
                            aria-pressed={d === picker.value}
                            onClick={() => picker.onChange(d)}
                        >
                            {d}
                        </button>
                    ))}
                </div>
            )}

            <div className='stat-panel__rows'>
                {rows.map(row => (
                    <StatRow key={row.label} {...row} />
                ))}
            </div>

            <div className='stat-panel__history'>
                <div className='stat-panel__chips'>
                    {visibleChips.length === 0 && <span className='stat-panel__chips-empty'>No outcomes yet</span>}
                    {visibleChips.map((chip, index) => (
                        <span key={index} className={classNames('stat-panel__chip', chip.tone)}>
                            {chip.text}
                        </span>
                    ))}
                </div>
                {chips.length > 10 && (
                    <button type='button' className='stat-panel__more' onClick={() => setShowMore(v => !v)}>
                        {showMore ? 'Show less' : '+ More'}
                    </button>
                )}
            </div>
        </div>
    );
};

export default StatPanel;
