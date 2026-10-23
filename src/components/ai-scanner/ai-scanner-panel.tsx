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

const STAGES: { stage: TAiScannerStage; label: () => string }[] = [
    { stage: 'scanning', label: () => localize('Scanning all markets') },
    { stage: 'loading', label: () => localize('Condition met - loading the engine') },
    { stage: 'waiting', label: () => localize('Waiting for the entry point') },
    { stage: 'starting', label: () => localize('Entry hit - pressing Run') },
    { stage: 'running', label: () => localize('Running') },
];

const stageIndex = (stage: TAiScannerStage) => {
    if (stage === 'stopping' || stage === 'stopped') return STAGES.length;
    return STAGES.findIndex(item => item.stage === stage);
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
            {localize('Scanning… {{remaining}} left', { remaining: formatRemaining(deadline - now) })}
        </p>
    );
};

const OverUnderForm = observer(() => {
    const ai_scanner = useAiScanner();
    const { form, form_errors, start_blocker, can_start, can_use_test_strategy, use_test_strategy } = ai_scanner;

    return (
        <form
            className='ai-scanner-panel__form'
            onSubmit={event => {
                event.preventDefault();
                ai_scanner.start();
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
                {localize('Scan & Run replaces the bot open in Bot Builder. Your current workspace is kept in Recent.')}
            </p>
            {start_blocker && <p className='ai-scanner-panel__blocker'>{start_blocker}</p>}
            <button type='submit' className='ai-scanner-panel__primary' disabled={!can_start}>
                {localize('Scan & Run')}
            </button>
        </form>
    );
});

const clockTime = (ms: number) => {
    const date = new Date(ms);
    return [date.getHours(), date.getMinutes(), date.getSeconds()].map(part => String(part).padStart(2, '0')).join(':');
};

/** Real numbers only: markets checked, when, and the nearest market with its strategy's own reason. */
const ScanProgress = observer(() => {
    const { scan_progress } = useAiScanner();
    if (!scan_progress) return <p className='ai-scanner-panel__meta'>{localize('Waiting for the first check…')}</p>;
    return (
        <div className='ai-scanner-panel__progress'>
            <p className='ai-scanner-panel__meta'>
                {localize('{{count}} markets · last check {{time}}', {
                    count: scan_progress.checked,
                    time: clockTime(scan_progress.last_check_at),
                })}
            </p>
            {scan_progress.closest && (
                <p className='ai-scanner-panel__closest'>
                    {localize('Closest')}: {scan_progress.closest.text} — {scan_progress.closest.reason}
                </p>
            )}
        </div>
    );
});

const RunStatus = observer(() => {
    const ai_scanner = useAiScanner();
    const { stage, locked, target, message, feed_status, markets, final_profit, scan_deadline } = ai_scanner;
    if (!locked) return null;
    const setup = OVER_UNDER_SETUPS[locked.strategy];
    const current = stageIndex(stage);
    const live = markets.filter(market => feed_status[market.symbol]?.status === 'live').length;
    const failed = markets.filter(market => feed_status[market.symbol]?.status === 'failed').length;

    return (
        <div className='ai-scanner-panel__status'>
            {stage === 'scanning' && scan_deadline !== null && <ScanCountdown deadline={scan_deadline} />}
            {stage === 'scanning' && <ScanProgress />}
            {(stage === 'loading' || stage === 'waiting') && target && (
                <div className='ai-scanner-panel__locked'>
                    <p className='ai-scanner-panel__headline'>{target.text}</p>
                    <p className='ai-scanner-panel__locked-stage'>
                        {stage === 'loading' ? localize('Loading the engine…') : localize('Waiting for entry')}
                    </p>
                    <p className='ai-scanner-panel__locked-reason'>{target.reason}</p>
                </div>
            )}
            <ol className='ai-scanner-panel__stages'>
                {STAGES.map((item, index) => (
                    <li
                        key={item.stage}
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
                        total: markets.length,
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
            {stage === 'stopped' && final_profit !== null && (
                <p
                    className={clsx('ai-scanner-panel__result', {
                        'ai-scanner-panel__result--profit': final_profit > 0,
                        'ai-scanner-panel__result--loss': final_profit < 0,
                    })}
                >
                    {localize('Total profit/loss')}: {money(final_profit)}
                </p>
            )}

            {stage === 'stopped' ? (
                <button type='button' className='ai-scanner-panel__primary' onClick={ai_scanner.dismiss}>
                    {localize('New scan')}
                </button>
            ) : (
                <button
                    type='button'
                    className='ai-scanner-panel__secondary'
                    onClick={ai_scanner.cancel}
                    disabled={stage === 'stopping'}
                >
                    {stage === 'stopping' ? localize('Stopping...') : localize('Cancel')}
                </button>
            )}
        </div>
    );
});

type TAiScannerPanel = { style: React.CSSProperties; is_desktop: boolean };

const AiScannerPanel = observer(({ style, is_desktop }: TAiScannerPanel) => {
    const ai_scanner = useAiScanner();
    const { active_tab, locked, stage, message } = ai_scanner;
    const shows_status = !!locked && stage !== 'idle';

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
                {/* Why the last scan ended (e.g. no market qualified) - above the
                    form, which keeps its values for the next Load & Run. */}
                {!shows_status && message && <p className='ai-scanner-panel__message'>{message}</p>}
                {shows_status ? <RunStatus /> : <OverUnderForm />}
            </div>
        </section>
    );
});

export default AiScannerPanel;
