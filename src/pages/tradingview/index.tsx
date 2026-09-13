import { useEffect, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import IframeWrapper from '@/components/iframe-wrapper';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import './tradingview.scss';

// Deriv's own hosted TradingView Charting Library instance: no licence/API key
// needed, works logged out, read-only (not a trading terminal). ?theme=dark is
// honoured; ?symbol=/?interval=/?chart_type= are ignored by this endpoint.
const TRADINGVIEW_SRC = 'https://charts.deriv.com/deriv?theme=dark';

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
    const is_active = active_tab === DBOT_TABS.TRADINGVIEW;
    const [has_opened, setHasOpened] = useState(false);

    useEffect(() => {
        if (is_active && !has_opened) {
            setHasOpened(true);
        }
    }, [is_active, has_opened]);

    return (
        <div className={classNames('tradingview-panel', { 'tradingview-panel--active': is_active })}>
            {has_opened && (
                <div className='tradingview-tab-panel'>
                    <IframeWrapper
                        src={TRADINGVIEW_SRC}
                        title='TradingView Charts'
                        className='tradingview-container'
                    />
                </div>
            )}
        </div>
    );
});

export default TradingViewPanel;
