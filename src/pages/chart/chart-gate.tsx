import { ReactNode, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import { ct_perf } from '@/utils/ct-perf';
import { localize } from '@deriv-com/translations';
import './chart.scss';

/** AI Scanner stages in which a tick can start a run at any moment. */
const AI_SCANNER_BUSY_STAGES = ['checking', 'scanning', 'starting'];

/**
 * Starting the chart (SmartCharts' chart engine) blocks the page for a few
 * hundred ms. While a bot or the AI Scanner is busy it waits for a safe
 * moment: right after a buy is confirmed, when the result is at least a tick
 * away. Until then a light placeholder shows, with "Open now". With nothing
 * running the chart starts at once, as before.
 */
export const useSafeChartStart = () => {
    const { run_panel, ai_scanner } = useStore();
    const is_ai_busy = AI_SCANNER_BUSY_STAGES.includes(ai_scanner?.stage ?? 'idle');
    const is_busy = !!run_panel?.is_running || is_ai_busy;
    const is_safe_moment = run_panel?.is_running && run_panel.contract_stage === contract_stages.PURCHASE_RECEIVED;
    const [can_start, setCanStart] = useState(!is_busy);

    useEffect(() => {
        if (can_start) return;
        if (!is_busy || (is_safe_moment && !is_ai_busy)) {
            if (is_busy) ct_perf.mark('chart started between trades');
            setCanStart(true);
        }
    }, [can_start, is_busy, is_safe_moment, is_ai_busy]);

    return { can_start, startNow: () => setCanStart(true) };
};

/** Renders the chart (and loads its code) only at a safe moment - see useSafeChartStart. */
const ChartGate = observer(({ children }: { children: ReactNode }) => {
    const { can_start, startNow } = useSafeChartStart();
    if (can_start) return <>{children}</>;
    return (
        <div className='chart-deferred' data-testid='dt_chart_deferred'>
            <p className='chart-deferred__text'>
                {localize('The chart opens between trades, so it never slows the bot down.')}
            </p>
            <button type='button' className='chart-deferred__button' onClick={startNow}>
                {localize('Open now')}
            </button>
        </div>
    );
});

export default ChartGate;
