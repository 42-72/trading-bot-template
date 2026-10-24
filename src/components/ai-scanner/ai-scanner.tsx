import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { isAiScannerSymbol } from '@/constants/ai-engine';
import { useStore } from '@/hooks/useStore';
import { useSyntheticSymbols } from '@/hooks/useSyntheticSymbols';
import { useDevice } from '@deriv-com/ui';
import AiScannerButton from './ai-scanner-button';
import { getSafeBounds, isRunDrawerOpen } from './ai-scanner-layout';
import AiScannerPanel from './ai-scanner-panel';
import MarketFeed from './market-feed';
import { useAiScanner } from './use-ai-scanner';
import './ai-scanner.scss';

// The panel's box; inside it the panel is as tall as its content and
// centred (ai-scanner.scss: height fit-content, margin auto), never taller
// than the box - then only its middle scrolls.
const PANEL_WIDTH = 420;
const WINDOW_GAP = 16; // laptop: the window less 32px
const BAR_GAP = 12; // phone: below the header, above the run drawer toggle bar
const SIDE_GAP = 8;

/**
 * Laptop: the middle of the whole window, over the Run bar and the run panel,
 * wherever the AI button is. Phone / tablet: the middle of the free space
 * between the header and the run drawer's toggle bar (measured live); with
 * the drawer open (Run opens it) over the drawer, as before.
 */
const panelStyle = (is_desktop: boolean, is_drawer_open: boolean): React.CSSProperties => {
    if (is_desktop) {
        return {
            top: WINDOW_GAP,
            bottom: WINDOW_GAP,
            left: 0,
            right: 0,
            width: Math.min(PANEL_WIDTH, window.innerWidth - 2 * WINDOW_GAP),
            maxHeight: window.innerHeight - 2 * WINDOW_GAP,
        };
    }
    // getSafeBounds ends 4px above the toggle bar (12px less clampToBounds'
    // 8) and right at the header's bottom.
    const bounds = getSafeBounds({ ignore_run_drawer: isRunDrawerOpen(is_drawer_open) });
    const top = bounds.top + BAR_GAP;
    const bottom = window.innerHeight - bounds.bottom + SIDE_GAP;
    return {
        top,
        left: bounds.left + SIDE_GAP,
        right: window.innerWidth - bounds.right + SIDE_GAP,
        bottom,
        maxHeight: window.innerHeight - top - bottom,
    };
};

// The button reports where it sits; the panel no longer depends on it.
const ignoreButtonLayout = () => undefined;

/**
 * The AI Scanner, app-wide (mounted from Layout): the floating button, its
 * panel, and - only while scanning or waiting - one live tick feed per
 * market. The pipeline itself is AiScannerStore.
 */
const AiScanner = observer(() => {
    const { run_panel } = useStore();
    const ai_scanner = useAiScanner();
    const { isDesktop } = useDevice();
    const symbols = useSyntheticSymbols();

    const markets = useMemo(
        () =>
            symbols
                .filter(symbol => isAiScannerSymbol(symbol.value, symbol.submarket))
                .map(symbol => ({ symbol: symbol.value, text: symbol.text, submarket: symbol.submarket })),
        [symbols]
    );
    useEffect(() => ai_scanner.setMarkets(markets), [ai_scanner, markets]);

    // Mobile panel: re-measure on resize / rotation, after the drawer's 0.3s
    // slide, and every half second while open (the toggle bar can move
    // without a resize). Re-renders only when the measured box changes.
    const [, setMobileBox] = useState('');
    const { is_drawer_open } = run_panel;
    const is_mobile_panel_open = !isDesktop && ai_scanner.is_panel_open;
    useEffect(() => {
        const measure = () => setMobileBox(JSON.stringify(panelStyle(false, is_drawer_open)));
        window.addEventListener('resize', measure);
        if (!is_mobile_panel_open) return () => window.removeEventListener('resize', measure);
        const settle = setTimeout(measure, 350);
        const poll = setInterval(measure, 500);
        return () => {
            window.removeEventListener('resize', measure);
            clearTimeout(settle);
            clearInterval(poll);
        };
    }, [is_mobile_panel_open, is_drawer_open]);

    // The mobile run drawer covers the screen when open: the button stays out
    // of its way. The PANEL stays open - Run opens the drawer, and the panel
    // must keep showing the run until the trader closes it.
    const is_hidden = !isDesktop && run_panel.is_drawer_open;
    // On mobile the panel fills the safe area, so the button would sit on it.
    const shows_button = !is_hidden && (isDesktop || !ai_scanner.is_panel_open);

    return (
        <>
            {ai_scanner.are_feeds_wanted &&
                ai_scanner.scan_markets.map(market => <MarketFeed key={market.symbol} symbol={market.symbol} />)}
            {shows_button && <AiScannerButton is_desktop={isDesktop} onLayout={ignoreButtonLayout} />}
            {ai_scanner.is_panel_open && (
                <AiScannerPanel style={panelStyle(isDesktop, run_panel.is_drawer_open)} is_desktop={isDesktop} />
            )}
        </>
    );
});

export default AiScanner;
