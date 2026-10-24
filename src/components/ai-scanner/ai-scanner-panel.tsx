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
import type { TAiScannerForm, TAiScannerStage } from '@/stores/ai-scanner-store';
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
    { key: 'qualified', label: () => localize('Waiting for entry') },
    { key: 'starting', label: () => localize('Entry hit - pressing Run') },
    { key: 'running', label: () => localize('Running') },
];

// 'Waiting for entry' is part of scanning: at least one market qualified.
const stageIndex = (stage: TAiScannerStage, has_qualified: boolean) => {
    if (stage === 'checking') return 0;
    if (stage === 'scanning') return has_qualified ? 1 : 0;
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

/** "Scanning… 3:42 left", re-rendered every second from the store's deadline. */
const ScanCountdown = ({ deadline }: { deadline: number }) => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    return (
        <p className='ai-scanner-panel__headline'>
            {deadline > now
                ? localize('Scanning… {{remaining}} left', { remaining: formatRemaining(deadline - now) })
                : localize('Past 5:00 - still scanning while a market is qualified')}
        </p>
    );
};

const OverUnderForm = observer(() => {
    const ai_scanner = useAiScanner();
    const { form, form_errors, start_blocker, can_start, can_use_test_strategy, use_test_strategy } = ai_scanner;

    return (
        // Enter in a field starts the scan, like the Scan button.
        <form
            className='ai-scanner-panel__form'
            onSubmit={event => {
                event.preventDefault();
                if (can_start) ai_scanner.start();
            }}
        >
            <StrategyPicker />
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

/**
 * Real numbers only: markets checked and when; every qualified market with
 * its strategy's own reason, or - with none qualified - the nearest one.
 */
const ScanProgress = observer(() => {
    const { scan_progress, qualified } = useAiScanner();
    if (!scan_progress) return <p className='ai-scanner-panel__meta'>{localize('Waiting for the first check…')}</p>;
    return (
        <div className='ai-scanner-panel__progress'>
            <p className='ai-scanner-panel__meta'>
                {localize('{{count}} markets · last check {{time}}', {
                    count: scan_progress.checked,
                    time: clockTime(scan_progress.last_check_at),
                })}
            </p>
            {qualified.length > 0 && (
                <div className='ai-scanner-panel__qualified'>
                    <p className='ai-scanner-panel__qualified-title'>
                        {localize('Waiting for entry on')}: {qualified.map(market => market.text).join(', ')}
                    </p>
                    {qualified.map(market => (
                        <p key={market.symbol} className='ai-scanner-panel__qualified-reason'>
                            {market.text}: {market.reason}
                        </p>
                    ))}
                </div>
            )}
            {qualified.length === 0 && scan_progress.closest && (
                <p className='ai-scanner-panel__closest'>
                    {localize('Closest')}: {scan_progress.closest.text} — {scan_progress.closest.reason}
                </p>
            )}
        </div>
    );
});

const RunStatus = observer(() => {
    const ai_scanner = useAiScanner();
    const { stage, locked, target, message, feed_status, scan_markets, scan_deadline, qualified } = ai_scanner;
    if (!locked) return null;
    const setup = OVER_UNDER_SETUPS[locked.strategy];
    const current = stageIndex(stage, qualified.length > 0);
    const live = scan_markets.filter(market => feed_status[market.symbol]?.status === 'live').length;
    const failed = scan_markets.filter(market => feed_status[market.symbol]?.status === 'failed').length;

    return (
        <div className='ai-scanner-panel__status'>
            {stage === 'checking' && (
                <p className='ai-scanner-panel__headline'>{localize('Checking which markets offer this trade…')}</p>
            )}
            {stage === 'scanning' && scan_deadline !== null && <ScanCountdown deadline={scan_deadline} />}
            {stage === 'scanning' && <ScanProgress />}
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

            {target && (
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
                    {setup.label}
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

            {message && <p className='ai-scanner-panel__message'>{message}</p>}
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
                <button
                    type='button'
                    role='tab'
                    aria-selected={active_tab === 'over_under'}
                    className={clsx('ai-scanner-panel__tab', {
                        'ai-scanner-panel__tab--active': active_tab === 'over_under',
                    })}
                    onClick={() => ai_scanner.setActiveTab('over_under')}
                >
                    {localize('Over/Under')}
                </button>
                <button type='button' role='tab' aria-selected={false} className='ai-scanner-panel__tab' disabled>
                    {localize('Even/Odd')}
                    <span className='ai-scanner-panel__soon'>{localize('coming soon')}</span>
                </button>
            </div>

            <div className='ai-scanner-panel__body'>
                {/* Why the last scan or run ended (no market qualified, Run
                    failed, Scan stopped, take profit...) - above the form,
                    which keeps its values for the next Scan. */}
                {!shows_status && message && <p className='ai-scanner-panel__message'>{message}</p>}
                {!shows_status && <LastResult />}
                {shows_status ? <RunStatus /> : <OverUnderForm />}
                <ScannerButtons />
            </div>
        </section>
    );
});

export default AiScannerPanel;
