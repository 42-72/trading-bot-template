import TradeAnimation from '@/components/trade-animation';
import { useDevice } from '@deriv-com/ui';

// The desktop Run bar. Mounted once and never moved: the same element in the
// same spot on every tab, run panel open or closed (main.scss
// .run-strategy-bar), so there is only ever this one Run button on desktop.
//
// isDesktop here MUST come from @deriv-com/ui's useDevice() (min-width:
// 1280px), the exact same hook/breakpoint run-panel.tsx uses to gate
// .controls__section (`!isDesktop && ... && <MobileDrawerFooter />`) - not
// the project's own isDesktop()/DesktopWrapper (which flips at ~601px). Same
// hook value both places: the phone/tablet Run bar and this one are mutually
// exclusive.
const RunStrategy = () => {
    const { isDesktop } = useDevice();

    // Prefer not rendering at all over hiding with CSS, so a hidden button
    // can never be clicked - matches the same rule applied to the mobile
    // .controls__section in run-panel.tsx.
    if (!isDesktop) return null;

    return (
        <div className='run-strategy-bar' data-testid='dt_run_strategy'>
            {/* Below the bar: to its left it would cover tab content, above it the nav tabs. */}
            <TradeAnimation tooltip_alignment='bottom' />
        </div>
    );
};

export default RunStrategy;
