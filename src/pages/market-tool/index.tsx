import { useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import { useDigitAnalysis } from '@/hooks/useDigitAnalysis';
import { useSyntheticSymbols } from '@/hooks/useSyntheticSymbols';
import {
    computeEvenOddStats,
    computeMatchesDiffersStats,
    computeOverUnderStats,
    computeRiseFallStats,
    computeStreak,
    DEFAULT_WINDOW_SIZE,
    DIGITS,
    MAX_WINDOW_SIZE,
    MIN_WINDOW_SIZE,
    rankDigits,
} from '@/utils/digit-stats';
import DigitCircle from './digit-circle';
import StatPanel from './stat-panel';
import TickRibbon from './tick-ribbon';
import './market-tool.scss';

type TTone = 'tone-green' | 'tone-red' | 'tone-blue' | 'tone-yellow';

const EVEN_ODD_TONE: Record<'Even' | 'Odd', TTone> = { Even: 'tone-green', Odd: 'tone-red' };
const OVER_UNDER_ROW_TONE: Record<'Over' | 'Under', TTone> = { Over: 'tone-green', Under: 'tone-yellow' };
// Chip colours for Over/Under deliberately differ from the row colours
// (O green, U red - not U yellow). Matches the spec exactly.
const OVER_UNDER_CHIP_TONE: Record<'Over' | 'Under', TTone> = { Over: 'tone-green', Under: 'tone-red' };
const MATCH_DIFFER_TONE: Record<'Match' | 'Differ', TTone> = { Match: 'tone-red', Differ: 'tone-blue' };
const RISE_FALL_TONE: Record<'Rise' | 'Fall', TTone> = { Rise: 'tone-green', Fall: 'tone-red' };

const MarketTool = () => {
    const symbols = useSyntheticSymbols();
    const [symbol, setSymbol] = useState('');
    const [windowInput, setWindowInput] = useState(String(DEFAULT_WINDOW_SIZE));
    const [windowSize, setWindowSize] = useState(DEFAULT_WINDOW_SIZE);
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

    // Debounced commit: typing 1000 -> 1500 shouldn't fire a resubscribe per keystroke.
    useEffect(() => {
        const parsed = Number(windowInput);
        if (windowInput.trim() === '' || !Number.isFinite(parsed)) return undefined;
        const clamped = Math.min(MAX_WINDOW_SIZE, Math.max(MIN_WINDOW_SIZE, Math.round(parsed)));
        const timer = setTimeout(() => setWindowSize(clamped), 500);
        return () => clearTimeout(timer);
    }, [windowInput]);

    const { digits, counts, directions, lastDigit, lastTickAt, currentQuote, pipSize, n, isLive } = useDigitAnalysis(
        symbol,
        windowSize
    );

    const ranks = useMemo(() => rankDigits(counts), [counts]);

    const { even, odd } = useMemo(() => computeEvenOddStats(counts, n), [counts, n]);
    const { over, under } = useMemo(() => computeOverUnderStats(counts, n, barrier), [counts, n, barrier]);
    const { matches, differs } = useMemo(
        () => computeMatchesDiffersStats(counts, n, matchDigit),
        [counts, n, matchDigit]
    );
    const { rise, fall } = useMemo(() => computeRiseFallStats(directions), [directions]);

    // Chronological (oldest -> newest) outcome sequences - the basis for
    // both the streak badge and the chip history. Purely descriptive of
    // what already happened; never a forward-looking claim.
    const evenOddOutcomes = useMemo(
        (): ('Even' | 'Odd')[] => digits.map(d => (d % 2 === 0 ? 'Even' : 'Odd')),
        [digits]
    );
    const overUnderOutcomes = useMemo(
        (): ('Over' | 'Under' | null)[] => digits.map(d => (d > barrier ? 'Over' : d < barrier ? 'Under' : null)),
        [digits, barrier]
    );
    const matchDifferOutcomes = useMemo(
        (): ('Match' | 'Differ')[] => digits.map(d => (d === matchDigit ? 'Match' : 'Differ')),
        [digits, matchDigit]
    );
    const riseFallOutcomes = useMemo(
        (): ('Rise' | 'Fall')[] => directions.map(d => (d === 'R' ? 'Rise' : 'Fall')),
        [directions]
    );

    const evenOddStreak = useMemo(() => computeStreak(evenOddOutcomes), [evenOddOutcomes]);
    const overUnderStreak = useMemo(() => computeStreak(overUnderOutcomes), [overUnderOutcomes]);
    const matchDifferStreak = useMemo(() => computeStreak(matchDifferOutcomes), [matchDifferOutcomes]);
    const riseFallStreak = useMemo(() => computeStreak(riseFallOutcomes), [riseFallOutcomes]);

    const digitStatsList = DIGITS.map(digit => ({
        digit,
        pct: n > 0 ? (counts[digit] / n) * 100 : 0,
    }));

    const ribbonDigits = digits.slice(-40);

    const quoteText = currentQuote !== null && pipSize !== null ? currentQuote.toFixed(pipSize) : null;
    const quoteMain = quoteText ? quoteText.slice(0, -1) : '—';
    const quoteLastDigit = quoteText ? quoteText.slice(-1) : '';

    const tickCountLabel = n >= windowSize ? 'Full' : n > 0 ? `${n} of ${windowSize}` : 'Waiting…';

    return (
        <div className='market-tool'>
            <div className='market-tool__controls'>
                <div className='market-tool__control'>
                    <label htmlFor='market-tool-symbol'>Volatility index</label>
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

                <div className='market-tool__control'>
                    <label htmlFor='market-tool-ticks'>Ticks</label>
                    <input
                        id='market-tool-ticks'
                        type='number'
                        min={MIN_WINDOW_SIZE}
                        max={MAX_WINDOW_SIZE}
                        value={windowInput}
                        onChange={e => setWindowInput(e.target.value)}
                    />
                    <span className='market-tool__control-hint'>{tickCountLabel}</span>
                </div>

                <div className='market-tool__price'>
                    <span
                        className={classNames('market-tool__live-label', { 'market-tool__live-label--live': isLive })}
                    >
                        <span className='market-tool__live-dot' aria-hidden='true' />
                        Live price
                    </span>
                    <span className='market-tool__quote'>
                        {quoteMain}
                        <span className='market-tool__quote-digit'>{quoteLastDigit}</span>
                    </span>
                </div>
            </div>

            <TickRibbon digits={ribbonDigits} />

            <div className='market-tool__circles' role='list' aria-label='Last digit distribution'>
                {digitStatsList.map(({ digit, pct }) => (
                    <DigitCircle
                        key={digit}
                        digit={digit}
                        pct={pct}
                        hasData={n > 0}
                        rank={ranks.get(digit)}
                        isLatest={lastDigit === digit}
                        bounceKey={lastDigit === digit ? lastTickAt : null}
                    />
                ))}
            </div>

            <div className='market-tool__panels'>
                <StatPanel
                    title='Over / Under'
                    picker={{ value: barrier, onChange: setBarrier, ariaLabel: 'Barrier digit' }}
                    rows={[
                        { label: `Over ${barrier}`, pct: over.pHat * 100, hasData: n > 0, tone: 'tone-green' },
                        { label: `Under ${barrier}`, pct: under.pHat * 100, hasData: n > 0, tone: 'tone-yellow' },
                    ]}
                    streak={
                        overUnderStreak && {
                            label: overUnderStreak.label,
                            count: overUnderStreak.count,
                            tone: OVER_UNDER_ROW_TONE[overUnderStreak.label],
                        }
                    }
                    chips={overUnderOutcomes
                        .filter((o): o is 'Over' | 'Under' => o !== null)
                        .map(o => ({ text: o === 'Over' ? 'O' : 'U', tone: OVER_UNDER_CHIP_TONE[o] }))}
                />

                <StatPanel
                    title='Match / Differ'
                    picker={{ value: matchDigit, onChange: setMatchDigit, ariaLabel: 'Match digit' }}
                    rows={[
                        { label: `Matches ${matchDigit}`, pct: matches.pHat * 100, hasData: n > 0, tone: 'tone-red' },
                        { label: `Differs ${matchDigit}`, pct: differs.pHat * 100, hasData: n > 0, tone: 'tone-blue' },
                    ]}
                    streak={
                        matchDifferStreak && {
                            label: matchDifferStreak.label,
                            count: matchDifferStreak.count,
                            tone: MATCH_DIFFER_TONE[matchDifferStreak.label],
                        }
                    }
                    chips={matchDifferOutcomes.map(o => ({
                        text: o === 'Match' ? 'M' : 'D',
                        tone: MATCH_DIFFER_TONE[o],
                    }))}
                />

                <StatPanel
                    title='Even / Odd'
                    rows={[
                        { label: 'Even', pct: even.pHat * 100, hasData: n > 0, tone: 'tone-green' },
                        { label: 'Odd', pct: odd.pHat * 100, hasData: n > 0, tone: 'tone-red' },
                    ]}
                    streak={
                        evenOddStreak && {
                            label: evenOddStreak.label,
                            count: evenOddStreak.count,
                            tone: EVEN_ODD_TONE[evenOddStreak.label],
                        }
                    }
                    chips={evenOddOutcomes.map(o => ({ text: o === 'Even' ? 'E' : 'O', tone: EVEN_ODD_TONE[o] }))}
                />

                <StatPanel
                    title='Rise / Fall'
                    rows={[
                        { label: 'Rise', pct: rise.pHat * 100, hasData: directions.length > 0, tone: 'tone-green' },
                        { label: 'Fall', pct: fall.pHat * 100, hasData: directions.length > 0, tone: 'tone-red' },
                    ]}
                    streak={
                        riseFallStreak && {
                            label: riseFallStreak.label,
                            count: riseFallStreak.count,
                            tone: RISE_FALL_TONE[riseFallStreak.label],
                        }
                    }
                    chips={riseFallOutcomes.map(o => ({ text: o === 'Rise' ? 'R' : 'F', tone: RISE_FALL_TONE[o] }))}
                />
            </div>

            <p className='market-tool__footnote'>Each tick&rsquo;s last digit is independent of the one before it.</p>
        </div>
    );
};

export default MarketTool;
