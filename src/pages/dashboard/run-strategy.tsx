import { observer } from 'mobx-react-lite';
import TradeAnimation from '@/components/trade-animation';
import { RUN_BAR_HIDDEN_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { useDevice } from '@deriv-com/ui';

// Desktop Run controls while the run panel is CLOSED: a compact Run +
// Execution dock at the right end of the nav tab row (main.scss .run-dock),
// over the row's empty end - not over tab content, and taking no height, so
// every tab starts directly below the nav row. While the panel is open, the
// Run bar sits at the top of the panel instead (run-panel.tsx); exactly one
// of the two renders at a time, so there is only ever one Run button.
//
// isDesktop here MUST come from @deriv-com/ui's useDevice() (min-width:
// 1280px), the exact same hook/breakpoint run-panel.tsx uses to gate the
// panel's bar and .controls__section (`!isDesktop && ... &&
// <MobileDrawerFooter />`) - not the project's own isDesktop()/
// DesktopWrapper (which flips at ~601px). Same hook value both places: the
// phone/tablet Run bar and these desktop controls are mutually exclusive.
const RunStrategy = observer(() => {
    const { dashboard, run_panel } = useStore();
    const { active_tab, active_tour } = dashboard;
    const { is_drawer_open } = run_panel;
    const { isDesktop } = useDevice();

    // Prefer not rendering at all over hiding with CSS, so a hidden button
    // can never be clicked - matches the same rule applied to the mobile
    // .controls__section in run-panel.tsx.
    if (!isDesktop || RUN_BAR_HIDDEN_TABS.includes(active_tab)) return null;
    // The open panel carries the bar - unless the panel itself isn't
    // rendered (the Bot Builder tour, run-panel.tsx).
    if (is_drawer_open && active_tour !== 'bot_builder') return null;

    return (
        <div className='run-dock' data-testid='dt_run_strategy'>
            {/* Below the dock: to its left it would cover the nav tabs. */}
            <TradeAnimation className='run-dock__animation' tooltip_alignment='bottom' />
        </div>
    );
});

export default RunStrategy;
