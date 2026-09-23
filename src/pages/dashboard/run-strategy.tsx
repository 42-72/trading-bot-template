import { observer } from 'mobx-react-lite';
import TradeAnimation from '@/components/trade-animation';
import { RUN_BAR_HIDDEN_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { useDevice } from '@deriv-com/ui';

// .toolbar__section is also used, unrelatedly, by the Bot Builder's own
// workspace toolbar (src/pages/bot-builder/toolbar/toolbar.tsx) - kept here
// for the Button's existing styling, but run-strategy-bar is the one this
// file's own CSS (main.scss) targets, so the two never collide.
//
// isDesktop here MUST come from @deriv-com/ui's useDevice() (min-width:
// 1280px), the exact same hook/breakpoint run-panel.tsx uses to gate
// .controls__section (`!isDesktop && ... && <MobileDrawerFooter />`) - not
// the project's own isDesktop()/DesktopWrapper (which flips at ~601px).
// Wrapping this component in <DesktopWrapper> alone (as before) left a
// 601-1279px gap where both this strip AND .controls__section rendered at
// once. Using the same hook value both places makes the two mutually
// exclusive by construction: exactly one Run button at every width.
const RunStrategy = observer(() => {
    const { dashboard } = useStore();
    const { active_tab } = dashboard;
    const { isDesktop } = useDevice();

    // Prefer not rendering at all over hiding with CSS, so a hidden button
    // can never be clicked - matches the same rule applied to the mobile
    // .controls__section in run-panel.tsx.
    if (!isDesktop || RUN_BAR_HIDDEN_TABS.includes(active_tab)) return null;

    return (
        <div className='toolbar__section run-strategy-bar' data-testid='dt_run_strategy'>
            <TradeAnimation className='toolbar__animation' />
        </div>
    );
});

export default RunStrategy;
