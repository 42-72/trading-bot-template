import { useEffect, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import IframeWrapper from '@/components/iframe-wrapper';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import './tradingview.scss';

/**
 * Rendered as an always-mounted sibling of the Tabs component (see main.tsx),
 * not as a tab's children - the Tabs component unmounts inactive tabs'
 * content entirely, which would destroy the iframe (and the user's chart
 * state) every time they switched away. Visibility is controlled with CSS
 * instead, so the iframe - once opened - survives tab switches.
 */
const TradingViewPanel = observer(() => {
    const { dashboard } = useStore();
    const { active_tab } = dashboard;
    const { is_dark_mode_on } = useThemeSwitcher();
    const is_active = active_tab === DBOT_TABS.TRADINGVIEW;
    const [has_opened, setHasOpened] = useState(false);

    useEffect(() => {
        if (is_active && !has_opened) {
            setHasOpened(true);
        }
    }, [is_active, has_opened]);

    // Deriv's own hosted TradingView Charting Library instance: no licence/
    // API key needed, works logged out, read-only (not a trading terminal).
    // ?theme= follows the site's own theme - useThemeSwitcher is the same
    // source of truth <body>'s theme--dark/theme--light classes and both
    // theme toggles use, so switching the site theme reloads the chart to
    // match rather than needing its own separate toggle (the in-chart one
    // lived in the banner we crop out, and is unreachable anyway - the
    // iframe is cross-origin). ?symbol=/?interval=/?chart_type= are ignored
    // by this endpoint. The iframe is keyed on theme so switching forces a
    // clean remount/reload instead of relying on an in-place src update.
    const theme = is_dark_mode_on ? 'dark' : 'light';

    return (
        <div className={classNames('tradingview-panel', { 'tradingview-panel--active': is_active })}>
            {has_opened && (
                <div className='tradingview-tab-panel'>
                    <IframeWrapper
                        key={theme}
                        src={`https://charts.deriv.com/deriv?theme=${theme}`}
                        title='TradingView Charts'
                        className='tradingview-container'
                    />
                </div>
            )}
        </div>
    );
});

export default TradingViewPanel;
