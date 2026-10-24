import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { observer } from 'mobx-react-lite';
import {
    AI_SCANNER_CURRENCY,
    AI_SCANNER_MIN_STAKE,
    contractWinRate,
    OVER_UNDER_SETUPS,
    TOverUnderSetup,
    TOverUnderStrategyId,
} from '@/constants/ai-engine';
import type { TAiScannerForm, TAiScannerStage, TAiScannerTab, TArmedMarket } from '@/stores/ai-scanner-store';
import { localize } from '@deriv-com/translations';
import { useAiScanner } from './use-ai-scanner';

// Contract facts only - the panel never shows a confidence, a score or
// anything implying the scanner's condition improves these odds.
const winRateLine = (setup: TOverUnderSetup) =>
    `${setup.label} ${setup.first_barrier}: ${contractWinRate(setup, setup.first_barrier)}% · ${localize(
        'after a loss'
    )} ${setup.label} ${setup.recovery_barrier}: ${contractWinRate(setup, setup.recovery_barrier)}%`;

const STAGES: { key: string; label: () => string }[] = [
    { key: 'scanning', label: () => localize('Scanning all markets') },
    { key: 'armed', label: () => localize('Armed - waiting for entry') },
    { key: 'starting', label: () => localize('Entry hit - pressing Run') },
    { key: 'running', label: () => localize('Running') },
];

// 'Armed' is part of scanning: at least one market armed.
const stageIndex = (stage: TAiScannerStage, has_armed: boolean) => {
    if (stage === 'checking') return 0;
    if (stage === 'scanning') return has_armed ? 1 : 0;
    if (stage === 'starting') return 2;
    if (stage === 'running') return 3;
    return STAGES.length;
};

const money = (value: number) => `${value.toFixed(2)} ${AI_SCANNER_CURRENCY}`;

const StrategyPicker = observer(() => {
    const ai_scanner = useAiScanner();
    return (
        <div className='ai-scanner-panel__strategies' role='radiogroup' aria-label={localize('Strategy')}>
            {(Object.keys(OVER_UNDER_SETUPS) as TOverUnderStrategyId[]).map(id => {
                const setup = OVER_UNDER_SETUPS[id];
                const is_selected = ai_scanner.form.strategy === id;
                return (
                    <button
                        key={id}
                        type='button'
                        role='radio'
                        aria-checked={is_selected}
                        className={clsx('ai-scanner-panel__strategy', {
                            'ai-scanner-panel__strategy--selected': is_selected,
                        })}
                        onClick={() => ai_scanner.setFormField('strategy', id)}
                    >
                        <span className='ai-scanner-panel__strategy-name'>{setup.label}</span>
                        <span className='ai-scanner-panel__strategy-detail'>
                            {localize('First')} {setup.label} {setup.first_barrier} · {localize('recovery')}{' '}
                            {setup.label} {setup.recovery_barrier}
                        </span>
                        <span className='ai-scanner-panel__strategy-detail'>{winRateLine(setup)}</span>
                    </button>
                );
            })}
        </div>
    );
});

// Contract facts only, as for Over/Under: each side wins half the time.
const EVEN_ODD_TITLE = () => localize('Even/Odd — the AI picks the side');
const EVEN_ODD_FACTS = () => localize('Even or Odd: 50% each · payout about 95%');

/** The Even/Odd tab's one card - there is nothing to choose; the AI picks the side per market. */
const EvenOddCard = () => (
    <div className='ai-scanner-panel__strategies ai-scanner-panel__strategies--single'>
        <div className='ai-scanner-panel__strategy ai-scanner-panel__strategy--selected'>
            <span className='ai-scanner-panel__strategy-name'>{EVEN_ODD_TITLE()}</span>
            <span className='ai-scanner-panel__strategy-detail'>{EVEN_ODD_FACTS()}</span>
        </div>
    </div>
);

const FIELDS: { key: Exclude<keyof TAiScannerForm, 'strategy'>; label: () => string; hint: () => string }[] = [
    {
        key: 'stake',
        label: () => `${localize('Stake')} (${AI_SCANNER_CURRENCY})`,
        hint: () => `${localize('Min')} ${AI_SCANNER_MIN_STAKE.toFixed(2)}`,
    },
    { key: 'martingale', label: () => localize('Martingale'), hint: () => localize('Stake × this after a loss') },
    { key: 'take_profit', label: () => `${localize('Take profit')} (${AI_SCANNER_CURRENCY})`, hint: () => '' },
    { key: 'stop_loss', label: () => `${localize('Stop loss')} (${AI_SCANNER_CURRENCY})`, hint: () => '' },
];

const formatRemaining = (ms: number) => {
    const total_seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(total_seconds / 60)}:${String(total_seconds % 60).padStart(2, '0')}`;
};

/** The time now, re-read every second - for the countdowns. */
const useNow = () => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    return now;
};

/** "Scanning… 3:42 left" - shown while nothing is armed. */
const ScanCountdown = ({ deadline }: { deadline: number }) => {
    const now = useNow();
    return (
        <p className='ai-scanner-panel__headline'>
            {localize('Scanning… {{remaining}} left', { remaining: formatRemaining(deadline - now) })}
        </p>
    );
};

/** One armed market: its own clock, its live reason, and whether the condition still holds. */
const ArmedMarket = ({ armed }: { armed: TArmedMarket }) => {
    const now = useNow();
    return (
        <div className='ai-scanner-panel__armed' data-testid={`ai-scanner-armed-${armed.symbol}`}>
            <p className='ai-scanner-panel__armed-head'>
                <span className='ai-scanner-panel__armed-name'>
                    {armed.text}
                    {armed.side && ` — ${armed.side.toUpperCase()}`}
                </span>
                <span className='ai-scanner-panel__armed-clock'>
                    {localize('{{remaining}} left', { remaining: formatRemaining(armed.expires_at - now) })}
                </span>
            </p>
            <span
                className={clsx('ai-scanner-panel__tag', {
                    'ai-scanner-panel__tag--met': armed.still_met,
                    'ai-scanner-panel__tag--changed': !armed.still_met,
                })}
            >
                {armed.still_met ? localize('Conditions still met') : localize('Conditions changed since it qualified')}
            </span>
            <p className='ai-scanner-panel__armed-reason'>{armed.reason}</p>
        </div>
    );
};

const OverUnderForm = observer(() => {
    const ai_scanner = useAiScanner();
    const { form, form_errors, start_blocker, can_start, can_use_test_strategy, use_test_strategy, active_tab } =
        ai_scanner;

    return (
        // Enter in a field starts the scan, like the Scan button.
        <form
            className='ai-scanner-panel__form'
            onSubmit={event => {
                event.preventDefault();
                if (can_start) ai_scanner.start();
            }}
        >
            {active_tab === 'even_odd' ? <EvenOddCard /> : <StrategyPicker />}
            <div className='ai-scanner-panel__fields'>
                {FIELDS.map(({ key, label, hint }) => {
                    const error = form[key].trim() !== '' ? form_errors[key] : undefined;
                    return (
                        <label key={key} className='ai-scanner-panel__field'>
                            <span className='ai-scanner-panel__field-label'>{label()}</span>
                            <input
                                className={clsx('ai-scanner-panel__input', { 'ai-scanner-panel__input--error': error })}
                                inputMode='decimal'
                                autoComplete='off'
                                value={form[key]}
                                onChange={event => ai_scanner.setFormField(key, event.target.value)}
                            />
                            <span
                                className={clsx('ai-scanner-panel__field-hint', {
                                    'ai-scanner-panel__field-hint--error': error,
                                })}
                            >
                                {error ?? hint()}
                            </span>
                        </label>
                    );
                })}
            </div>
            {can_use_test_strategy && (
                <label className='ai-scanner-panel__test'>
                    <input
                        type='checkbox'
                        checked={use_test_strategy}
                        onChange={event => ai_scanner.setUseTestStrategy(event.target.checked)}
                    />
                    <span>
                        {localize(
                            'TEST strategy (demo only): qualifies the first market at once and enters on the next tick - for checking the pipeline.'
                        )}
                    </span>
                </label>
            )}
            <p className='ai-scanner-panel__notice'>
                {localize(
                    'When an entry hits, the engine bot replaces the bot open in Bot Builder. Your current workspace is kept in Recent.'
                )}
            </p>
            {start_blocker && <p className='ai-scanner-panel__blocker'>{start_blocker}</p>}
        </form>
    );
});

const clockTime = (ms: number) => {
    const date = new Date(ms);
    return [date.getHours(), date.getMinutes(), date.getSeconds()].map(part => String(part).padStart(2, '0')).join(':');
};

/** Short market names for the dots: "V10 (1s)", "J25". */
export const shortMarketName = (symbol: string, text: string) => {
    const volatility = /^1HZ(\d+)V$/.exec(symbol);
    if (volatility) return `V${volatility[1]} (1s)`;
    const jump = /^JD(\d+)$/.exec(symbol);
    if (jump) return `J${jump[1]}`;
    return text;
};

type TDotState = 'scanning' | 'armed' | 'changed' | 'entry';

const DOT_LABEL: Record<TDotState, () => string> = {
    scanning: () => localize('scanning'),
    armed: () => localize('armed'),
    changed: () => localize('armed - conditions changed'),
    entry: () => localize('entry hit'),
};

/**
 * One dot per market this scan covers (those that passed contracts_for), in
 * its real state: grey scanning, green armed (with the side on Even/Odd),
 * amber armed but conditions changed (Over/Under), bright and pulsing for the
 * entry hit. The name shows on hover, and on tap (phones have no hover).
 */
export const MarketDots = observer(() => {
    const { scan_markets, armed, target, stage } = useAiScanner();
    const [shown, setShown] = useState<string | null>(null);
    if (scan_markets.length === 0) return null;
    const entry_symbol = ['starting', 'running', 'stopping'].includes(stage) ? target?.symbol : undefined;

    const dots = scan_markets.map(market => {
        const armed_market = armed.find(item => item.symbol === market.symbol);
        let state: TDotState = 'scanning';
        if (market.symbol === entry_symbol) state = 'entry';
        else if (armed_market) state = armed_market.still_met || armed_market.side ? 'armed' : 'changed';
        const side = market.symbol === entry_symbol ? target?.side : armed_market?.side;
        const name = shortMarketName(market.symbol, market.text);
        const label = `${name} — ${DOT_LABEL[state]()}${side ? ` ${side.toUpperCase()}` : ''}`;
        return { symbol: market.symbol, state, label };
    });
    const shown_dot = dots.find(dot => dot.symbol === shown);

    return (
        <div className='ai-scanner-panel__dots-wrap'>
            <ul className='ai-scanner-panel__dots' aria-label={localize('Markets')}>
                {dots.map(dot => (
                    <li key={dot.symbol}>
                        <button
                            type='button'
                            className={`ai-scanner-panel__dot ai-scanner-panel__dot--${dot.state}`}
                            title={dot.label}
                            aria-label={dot.label}
                            data-testid={`ai-scanner-dot-${dot.symbol}`}
                            onClick={() => setShown(current => (current === dot.symbol ? null : dot.symbol))}
                        />
                    </li>
                ))}
            </ul>
            {shown_dot && <p className='ai-scanner-panel__dot-label'>{shown_dot.label}</p>}
        </div>
    );
});

/**
 * Real numbers only: markets checked and when (always); every armed market
 * with its own clock and live reason, or - with none armed - the nearest one.
 */
const ScanProgress = observer(() => {
    const { scan_progress, armed, drop_notices } = useAiScanner();
    if (!scan_progress) return <p className='ai-scanner-panel__meta'>{localize('Waiting for the first check…')}</p>;
    return (
        <div className='ai-scanner-panel__progress'>
            <p className='ai-scanner-panel__meta'>
                {localize('{{count}} markets · last check {{time}}', {
                    count: scan_progress.checked,
                    time: clockTime(scan_progress.last_check_at),
                })}
            </p>
            <MarketDots />
            {armed.length > 0 && (
                <div className='ai-scanner-panel__qualified'>
                    <p className='ai-scanner-panel__qualified-title'>{localize('Armed - waiting for entry')}</p>
                    {armed.map(market => (
                        <ArmedMarket key={market.symbol} armed={market} />
                    ))}
                </div>
            )}
            {drop_notices.map(notice => (
                <p key={notice.id} className='ai-scanner-panel__dropped' role='status'>
                    {notice.text}
                </p>
            ))}
            {armed.length === 0 && scan_progress.closest && (
                <p className='ai-scanner-panel__closest'>
                    {localize('Closest')}: {scan_progress.closest.text} — {scan_progress.closest.reason}
                </p>
            )}
        </div>
    );
});

const RunStatus = observer(() => {
    const ai_scanner = useAiScanner();
    const { stage, locked, target, feed_status, scan_markets, scan_deadline, armed } = ai_scanner;
    if (!locked) return null;
    const is_even_odd = locked.tab === 'even_odd';
    const setup = OVER_UNDER_SETUPS[locked.strategy];
    const current = stageIndex(stage, armed.length > 0);
    const live = scan_markets.filter(market => feed_status[market.symbol]?.status === 'live').length;
    const failed = scan_markets.filter(market => feed_status[market.symbol]?.status === 'failed').length;

    return (
        <div className='ai-scanner-panel__status'>
            {stage === 'checking' && (
                <p className='ai-scanner-panel__headline'>{localize('Checking which markets offer this trade…')}</p>
            )}
            {stage === 'scanning' && scan_deadline !== null && armed.length === 0 && (
                <ScanCountdown deadline={scan_deadline} />
            )}
            {stage === 'scanning' && <ScanProgress />}
            {['starting', 'running', 'stopping'].includes(stage) && <MarketDots />}
            <ol className='ai-scanner-panel__stages'>
                {STAGES.map((item, index) => (
                    <li
                        key={item.key}
                        className={clsx('ai-scanner-panel__stage', {
                            'ai-scanner-panel__stage--done': index < current,
                            'ai-scanner-panel__stage--current': index === current,
                        })}
                    >
                        {item.label()}
                    </li>
                ))}
            </ol>

            {stage === 'scanning' && (
                <p className='ai-scanner-panel__meta'>
                    {localize('{{live}} of {{total}} markets live (last 600 ticks each)', {
                        live,
                        total: scan_markets.length,
                    })}
                    {failed > 0 && ` · ${localize('{{failed}} could not load', { failed })}`}
                </p>
            )}

            {target && is_even_odd && (
                <dl className='ai-scanner-panel__facts'>
                    <dt>{localize('Market')}</dt>
                    <dd>{target.text}</dd>
                    <dt>{localize('Side')}</dt>
                    <dd>{(target.side ?? 'even').toUpperCase()}</dd>
                    <dt>{localize('Win rate')}</dt>
                    <dd>{EVEN_ODD_FACTS()}</dd>
                    <dt>{localize('Reason')}</dt>
                    <dd>{target.reason}</dd>
                </dl>
            )}
            {target && !is_even_odd && (
                <dl className='ai-scanner-panel__facts'>
                    <dt>{localize('Market')}</dt>
                    <dd>{target.text}</dd>
                    <dt>{localize('Direction')}</dt>
                    <dd>{setup.label}</dd>
                    <dt>{localize('Barriers')}</dt>
                    <dd>
                        {setup.label} {setup.first_barrier} · {localize('recovery')} {setup.label}{' '}
                        {setup.recovery_barrier}
                    </dd>
                    <dt>{localize('Win rate')}</dt>
                    <dd>{winRateLine(setup)}</dd>
                    <dt>{localize('Reason')}</dt>
                    <dd>{target.reason}</dd>
                </dl>
            )}

            <dl className='ai-scanner-panel__facts ai-scanner-panel__facts--locked'>
                <dt>{localize('Locked for this run')}</dt>
                <dd>
                    {is_even_odd ? localize('Even/Odd') : setup.label}
                    {locked.use_test_strategy && ` · ${localize('TEST strategy')}`}
                </dd>
                <dt>{localize('Stake')}</dt>
                <dd>{money(locked.stake)}</dd>
                <dt>{localize('Martingale')}</dt>
                <dd>× {locked.martingale}</dd>
                <dt>{localize('Take profit')}</dt>
                <dd>{money(locked.take_profit)}</dd>
                <dt>{localize('Stop loss')}</dt>
                <dd>{money(locked.stop_loss)}</dd>
            </dl>
        </div>
    );
});

/** The last run's result, shown above the form once the bot has stopped. */
const LastResult = observer(() => {
    const { stage, final_profit } = useAiScanner();
    if (stage !== 'stopped' || final_profit === null) return null;
    return (
        <p
            className={clsx('ai-scanner-panel__result', {
                'ai-scanner-panel__result--profit': final_profit > 0,
                'ai-scanner-panel__result--loss': final_profit < 0,
            })}
        >
            {localize('Total profit/loss')}: {money(final_profit)}
        </p>
    );
});

/**
 * Two buttons, one under the other.
 *  - Top, the only one the trader presses: "Scan" (ready), "Stop scan"
 *    (checking / scanning, also while waiting for an entry), "Scan" disabled
 *    from the entry hit until the bot stops (a running bot is stopped with
 *    the normal Stop button).
 *  - Bottom, "Load & Run": a status light only - always disabled, out of the
 *    tab order, no handler. Lit with "Loading…" from the entry hit until Run
 *    is pressed, "Running" while the bot runs, greyed otherwise.
 */
export const ScannerButtons = observer(() => {
    const ai_scanner = useAiScanner();
    const { stage, can_start } = ai_scanner;
    const is_scanning = stage === 'checking' || stage === 'scanning';
    const is_engine_busy = stage === 'starting' || stage === 'running' || stage === 'stopping';

    let status_label = localize('Load & Run');
    if (stage === 'starting') status_label = localize('Loading…');
    if (stage === 'running' || stage === 'stopping') status_label = localize('Running');

    return (
        <div className='ai-scanner-panel__buttons'>
            {is_scanning ? (
                <button type='button' className='ai-scanner-panel__secondary' onClick={ai_scanner.cancel}>
                    {localize('Stop scan')}
                </button>
            ) : (
                <button
                    type='button'
                    className='ai-scanner-panel__primary'
                    disabled={is_engine_busy || !can_start}
                    onClick={ai_scanner.start}
                >
                    {localize('Scan')}
                </button>
            )}
            <button
                type='button'
                className={clsx('ai-scanner-panel__status-light', {
                    'ai-scanner-panel__status-light--lit': is_engine_busy,
                })}
                disabled
                tabIndex={-1}
                aria-disabled='true'
                aria-live='polite'
                data-testid='ai-scanner-status-light'
            >
                {status_label}
            </button>
        </div>
    );
});

const TABS: { id: TAiScannerTab; label: () => string }[] = [
    { id: 'over_under', label: () => localize('Over/Under') },
    { id: 'even_odd', label: () => localize('Even/Odd') },
];

type TAiScannerPanel = { style: React.CSSProperties; is_desktop: boolean };

const AiScannerPanel = observer(({ style, is_desktop }: TAiScannerPanel) => {
    const ai_scanner = useAiScanner();
    const { active_tab, locked, stage, message } = ai_scanner;
    // Idle and stopped show the form (kept, ready for the next Scan).
    const shows_status = !!locked && !['idle', 'stopped'].includes(stage);

    return (
        <section
            className={clsx('ai-scanner-panel', { 'ai-scanner-panel--mobile': !is_desktop })}
            style={style}
            aria-label={localize('AI Scanner')}
        >
            <header className='ai-scanner-panel__header'>
                <span className='ai-scanner-panel__title'>
                    <span className='ai-scanner-panel__badge'>AI</span>
                    {localize('AI Scanner')}
                </span>
                <button
                    type='button'
                    className='ai-scanner-panel__close'
                    aria-label={localize('Close')}
                    onClick={() => ai_scanner.setPanelOpen(false)}
                >
                    ×
                </button>
            </header>

            <div className='ai-scanner-panel__tabs' role='tablist'>
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        type='button'
                        role='tab'
                        aria-selected={active_tab === tab.id}
                        className={clsx('ai-scanner-panel__tab', {
                            'ai-scanner-panel__tab--active': active_tab === tab.id,
                        })}
                        // The tab is part of a run: fixed while one is going.
                        disabled={ai_scanner.is_active && active_tab !== tab.id}
                        onClick={() => ai_scanner.setActiveTab(tab.id)}
                    >
                        {tab.label()}
                    </button>
                ))}
            </div>

            {/* Only the middle scrolls. */}
            <div className='ai-scanner-panel__body'>{shows_status ? <RunStatus /> : <OverUnderForm />}</div>

            {/* Pinned: the last result / message line, then the two buttons -
                always visible, however long the middle is. */}
            <footer className='ai-scanner-panel__footer'>
                {message && <p className='ai-scanner-panel__message'>{message}</p>}
                {!shows_status && <LastResult />}
                <ScannerButtons />
            </footer>
        </section>
    );
});

export default AiScannerPanel;
