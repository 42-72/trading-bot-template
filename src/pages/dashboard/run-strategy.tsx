import { observer } from 'mobx-react-lite';
import TradeAnimation from '@/components/trade-animation';
import { RUN_BAR_HIDDEN_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';

// .toolbar__section is also used, unrelatedly, by the Bot Builder's own
// workspace toolbar (src/pages/bot-builder/toolbar/toolbar.tsx) - kept here
// for the Button's existing styling, but run-strategy-bar is the one this
// file's own CSS (main.scss) targets, so the two never collide.
const RunStrategy = observer(() => {
    const { dashboard } = useStore();
    const { active_tab } = dashboard;

    // Prefer not rendering at all over hiding with CSS, so a hidden button
    // can never be clicked - matches the same rule applied to the mobile
    // .controls__section in run-panel.tsx.
    if (RUN_BAR_HIDDEN_TABS.includes(active_tab)) return null;

    return (
        <div className='toolbar__section run-strategy-bar' data-testid='dt_run_strategy'>
            <TradeAnimation className='toolbar__animation' />
        </div>
    );
});

export default RunStrategy;
