import { observer } from 'mobx-react-lite';
import TradeAnimation from '@/components/trade-animation';
import { RUN_BAR_HIDDEN_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { useDevice } from '@deriv-com/ui';

// The desktop Run bar. Never moved: the same element in the same spot on every
// tab that has it, run panel open or closed (main.scss .run-strategy-bar), so
// there is only ever this one Run button on desktop. Tbots and DTrader have
// neither it nor the run panel.
//
// isDesktop here MUST come from @deriv-com/ui's useDevice() (min-width:
// 1280px), the exact same hook/breakpoint run-panel.tsx uses to gate
// .controls__section (`!isDesktop && ... && <MobileDrawerFooter />`) - not
// the project's own isDesktop()/DesktopWrapper (which flips at ~601px). Same
// hook value both places: the phone/tablet Run bar and this one are mutually
// exclusive.
const RunStrategy = observer(() => {
    const { dashboard } = useStore();
    const { active_tab } = dashboard;
    const { isDesktop } = useDevice();

    // Prefer not rendering at all over hiding with CSS, so a hidden button
    // can never be clicked - matches the same rule applied to the mobile
    // .controls__section in run-panel.tsx.
    if (!isDesktop || RUN_BAR_HIDDEN_TABS.includes(active_tab)) return null;

    return (
        <div className='run-strategy-bar' data-testid='dt_run_strategy'>
            {/* Below the bar: to its left it would cover tab content, above it the nav tabs. */}
            <TradeAnimation tooltip_alignment='bottom' />
        </div>
    );
});

export default RunStrategy;
