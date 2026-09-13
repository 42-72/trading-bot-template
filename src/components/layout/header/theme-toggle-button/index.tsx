import { observer } from 'mobx-react-lite';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { StandaloneMoonBoldIcon, StandaloneSunBrightBoldIcon } from '@deriv/quill-icons';
import { useTranslations } from '@deriv-com/translations';
import './theme-toggle-button.scss';

// Desktop's equivalent of the "Dark theme" row in the mobile hamburger drawer
// (use-mobile-menu-config.tsx) - the drawer itself is mobile-only (MobileMenu
// returns null on desktop), and desktop currently has no other menu surface
// to put a toggle inside, so this renders as a standalone icon button in the
// header instead. Both share the same source of truth (useThemeSwitcher), so
// toggling in one place is reflected correctly if the other is ever visible
// too (e.g. resizing across the breakpoint).
const ThemeToggleButton = observer(() => {
    const { localize } = useTranslations();
    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();
    const label = is_dark_mode_on ? localize('Switch to light theme') : localize('Switch to dark theme');

    return (
        <button type='button' className='theme-toggle-button' onClick={toggleTheme} aria-label={label} title={label}>
            {is_dark_mode_on ? (
                <StandaloneMoonBoldIcon fill='var(--text-general)' iconSize='sm' />
            ) : (
                <StandaloneSunBrightBoldIcon fill='var(--text-general)' iconSize='sm' />
            )}
        </button>
    );
});

export default ThemeToggleButton;
