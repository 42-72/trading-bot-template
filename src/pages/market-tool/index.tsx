import { useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import { useDigitAnalysis } from '@/hooks/useDigitAnalysis';
import { useSyntheticSymbols } from '@/hooks/useSyntheticSymbols';
import {
    computeDigitStats,
    computeEvenOddStats,
    computeMatchesDiffersStats,
    computeOverUnderStats,
    DIGITS,
    MAX_BUFFER,
} from '@/utils/digit-stats';
import { Localize } from '@deriv-com/translations';
import DigitRing from './digit-ring';
import StatBar from './stat-bar';
import './market-tool.scss';

const DIGIT_OPTIONS = DIGITS;

const MarketTool = () => {
    const symbols = useSyntheticSymbols();
    const { connectionStatus } = useApiBase();
    const [symbol, setSymbol] = useState('');
    const [barrier, setBarrier] = useState(4);
    const [matchDigit, setMatchDigit] = useState(0);

    // Default to the first available synthetic index once the list loads;
    // never hardcoded - see useSyntheticSymbols.
    useEffect(() => {
        if (!symbol && symbols.length > 0) {
            const preferred = symbols.find(s => s.value === 'R_100') ?? symbols[0];
            setSymbol(preferred.value);
        }
    }, [symbols, symbol]);

    const { counts, lastDigit, lastTickAt, n } = useDigitAnalysis(symbol);

    const digitStats = useMemo(() => computeDigitStats(counts, n), [counts, n]);
    const { even, odd } = useMemo(() => computeEvenOddStats(counts, n), [counts, n]);
    const { over, under } = useMemo(() => computeOverUnderStats(counts, n, barrier), [counts, n, barrier]);
    const { matches, differs } = useMemo(
        () => computeMatchesDiffersStats(counts, n, matchDigit),
        [counts, n, matchDigit]
    );

    const { highestDigit, lowestDigit } = useMemo(() => {
        if (n === 0) return { highestDigit: null as number | null, lowestDigit: null as number | null };
        let highest = 0;
        let lowest = 0;
        DIGITS.forEach(d => {
            if (counts[d] > counts[highest]) highest = d;
            if (counts[d] < counts[lowest]) lowest = d;
        });
        return { highestDigit: highest, lowestDigit: lowest };
    }, [counts, n]);

    const tickCountLabel =
        n >= MAX_BUFFER ? `Last ${MAX_BUFFER} ticks` : n > 0 ? `Last ${n} ticks (still filling)` : 'Waiting for ticks…';

    return (
        <div className='market-tool'>
            <div className='market-tool__header'>
                <div className='market-tool__control'>
                    <label htmlFor='market-tool-symbol'>
                        <Localize i18n_default_text='Volatility index' />
                    </label>
                    <select
                        id='market-tool-symbol'
                        value={symbol}
                        onChange={e => setSymbol(e.target.value)}
                        disabled={symbols.length === 0}
                    >
                        {symbols.length === 0 && <option value=''>Loading…</option>}
                        {symbols.map(s => (
                            <option key={s.value} value={s.value}>
                                {s.text}
                            </option>
                        ))}
                    </select>
                </div>

                <span className='market-tool__tick-count'>{tickCountLabel}</span>

                <span
                    className={classNames('market-tool__connection', {
                        'market-tool__connection--live': connectionStatus === CONNECTION_STATUS.OPENED,
                    })}
                >
                    <span className='market-tool__connection__dot' aria-hidden='true' />
                    {connectionStatus === CONNECTION_STATUS.OPENED ? 'Live' : 'Reconnecting…'}
                </span>
            </div>

            <div className='market-tool__rings' role='list' aria-label='Last digit distribution'>
                {digitStats.map(stat => {
                    const digit = Number(stat.label);
                    return (
                        <DigitRing
                            key={digit}
                            digit={digit}
                            stat={stat}
                            isLatest={lastDigit === digit}
                            isHighest={highestDigit === digit && counts[digit] > 0}
                            isLowest={lowestDigit === digit && n > 0 && highestDigit !== lowestDigit}
                            pulseKey={lastDigit === digit ? lastTickAt : null}
                        />
                    );
                })}
            </div>

            <div className='market-tool__strength'>
                <div className='strength-row'>
                    <div className='strength-row__header'>
                        <span className='strength-row__title'>
                            <Localize i18n_default_text='Even vs Odd' />
                        </span>
                    </div>
                    <StatBar stat={even} />
                    <StatBar stat={odd} />
                </div>

                <div className='strength-row'>
                    <div className='strength-row__header'>
                        <span className='strength-row__title'>
                            <Localize i18n_default_text='Over / Under' />
                        </span>
                        <label className='strength-row__selector'>
                            <Localize i18n_default_text='Barrier' />
                            <select value={barrier} onChange={e => setBarrier(Number(e.target.value))}>
                                {DIGIT_OPTIONS.map(d => (
                                    <option key={d} value={d}>
                                        {d}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                    <StatBar stat={over} />
                    <StatBar stat={under} />
                </div>

                <div className='strength-row'>
                    <div className='strength-row__header'>
                        <span className='strength-row__title'>
                            <Localize i18n_default_text='Matches / Differs' />
                        </span>
                        <label className='strength-row__selector'>
                            <Localize i18n_default_text='Digit' />
                            <select value={matchDigit} onChange={e => setMatchDigit(Number(e.target.value))}>
                                {DIGIT_OPTIONS.map(d => (
                                    <option key={d} value={d}>
                                        {d}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                    <StatBar stat={matches} />
                    <StatBar stat={differs} />
                </div>
            </div>

            <p className='market-tool__footnote'>
                <Localize i18n_default_text="Each tick's last digit is independent. Readings inside the shaded band are ordinary randomness, not a pattern." />
            </p>
        </div>
    );
};

export default MarketTool;
