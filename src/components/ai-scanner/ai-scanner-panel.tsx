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
import { useStore } from '@/hooks/useStore';
import type { TAiScannerForm, TAiScannerStage } from '@/stores/ai-scanner-store';
import { localize } from '@deriv-com/translations';

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
    const { ai_scanner } = useStore();
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
    {
        key: 'entry_wait_seconds',
        label: () => localize('Entry wait (seconds)'),
        hint: () => localize('Back to scanning after this'),
    },
];

const OverUnderForm = observer(() => {
    const { ai_scanner } = useStore();
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
                {localize('Load & Run replaces the bot open in Bot Builder. Your current workspace is kept in Recent.')}
            </p>
            {start_blocker && <p className='ai-scanner-panel__blocker'>{start_blocker}</p>}
            <button type='submit' className='ai-scanner-panel__primary' disabled={!can_start}>
                {localize('Load & Run')}
            </button>
        </form>
    );
});

const RunStatus = observer(() => {
    const { ai_scanner } = useStore();
    const { stage, locked, target, message, feed_status, markets, final_profit } = ai_scanner;
    if (!locked) return null;
    const setup = OVER_UNDER_SETUPS[locked.strategy];
    const current = stageIndex(stage);
    const live = markets.filter(market => feed_status[market.symbol]?.status === 'live').length;
    const failed = markets.filter(market => feed_status[market.symbol]?.status === 'failed').length;

    return (
        <div className='ai-scanner-panel__status'>
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
                <dt>{localize('Entry wait')}</dt>
                <dd>{locked.entry_wait_seconds}s</dd>
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
    const { ai_scanner } = useStore();
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
                {shows_status ? <RunStatus /> : <OverUnderForm />}
                {!shows_status && message && <p className='ai-scanner-panel__message'>{message}</p>}
            </div>
        </section>
    );
});

export default AiScannerPanel;
