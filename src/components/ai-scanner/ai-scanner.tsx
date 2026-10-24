import { useCallback, useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { isAiScannerSymbol } from '@/constants/ai-engine';
import { useStore } from '@/hooks/useStore';
import { useSyntheticSymbols } from '@/hooks/useSyntheticSymbols';
import { useDevice } from '@deriv-com/ui';
import AiScannerButton from './ai-scanner-button';
import { getSafeBounds, isRunDrawerOpen, runBarTopBeside, TBounds, TPoint } from './ai-scanner-layout';
import AiScannerPanel from './ai-scanner-panel';
import MarketFeed from './market-feed';
import { useAiScanner } from './use-ai-scanner';
import './ai-scanner.scss';

// Desktop panel: 420 wide (was 360) and up to 70% of the window tall (was
// as tall as its content, ~600, squeezed into the room above the button) -
// never more than the window less 32px.
const PANEL_WIDTH = 420;
const PANEL_MAX_HEIGHT = 700;
const PANEL_HEIGHT_SHARE = 0.7;
const WINDOW_MARGIN = 32;
const GAP = 8;

type TLayout = { position: TPoint; size: number; bounds: TBounds };

/**
 * Desktop: beside the button (left of it when there's room - the default spot
 * is bottom-right), bottom-aligned with it; above / below it otherwise.
 * Always inside the safe area (never over the Run controls or the run panel
 * column). Mobile: the whole safe area - below the header, above the run bar.
 */
const panelStyle = (layout: TLayout | null, is_desktop: boolean, is_drawer_open: boolean): React.CSSProperties => {
    if (!is_desktop) {
        // Measured fresh: the button that reports `layout` is hidden while
        // the mobile panel is open. With the run drawer open (Run opens it)
        // the panel sits over it rather than vanishing; closed, the panel
        // ends above its toggle bar (getSafeBounds keeps 12px clear).
        const bounds = getSafeBounds({ ignore_run_drawer: isRunDrawerOpen(is_drawer_open) });
        return {
            top: bounds.top + GAP,
            left: bounds.left + GAP,
            right: window.innerWidth - bounds.right + GAP,
            bottom: window.innerHeight - bounds.bottom + GAP,
        };
    }
    if (!layout) return { visibility: 'hidden' };
    const { position, size, bounds } = layout;
    const max_height = Math.min(
        PANEL_MAX_HEIGHT,
        Math.round(window.innerHeight * PANEL_HEIGHT_SHARE),
        window.innerHeight - WINDOW_MARGIN
    );
    const width = Math.min(PANEL_WIDTH, bounds.right - bounds.left - 2 * GAP, window.innerWidth - WINDOW_MARGIN);

    const room_left = position.x - bounds.left - 2 * GAP;
    const room_right = bounds.right - (position.x + size) - 2 * GAP;
    if (room_left >= width || room_right >= width) {
        const left = room_left >= width ? position.x - GAP - width : position.x + size + GAP;
        const top_limit = (runBarTopBeside(left, left + width) ?? bounds.top) + GAP;
        const bottom_limit = bounds.bottom - GAP;
        const height = Math.min(max_height, bottom_limit - top_limit);
        const top = Math.min(Math.max(position.y + size - height, top_limit), bottom_limit - height);
        return { left, width, top, height };
    }

    const left = Math.min(Math.max(position.x, bounds.left + GAP), bounds.right - GAP - width);
    const room_above = position.y - bounds.top - 2 * GAP;
    const room_below = bounds.bottom - (position.y + size) - 2 * GAP;
    return room_above >= room_below
        ? { left, width, bottom: window.innerHeight - position.y + GAP, maxHeight: Math.min(room_above, max_height) }
        : { left, width, top: position.y + size + GAP, maxHeight: Math.min(room_below, max_height) };
};

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
    const [layout, setLayout] = useState<TLayout | null>(null);

    const markets = useMemo(
        () =>
            symbols
                .filter(symbol => isAiScannerSymbol(symbol.value, symbol.submarket))
                .map(symbol => ({ symbol: symbol.value, text: symbol.text, submarket: symbol.submarket })),
        [symbols]
    );
    useEffect(() => ai_scanner.setMarkets(markets), [ai_scanner, markets]);

    const onLayout = useCallback((next: TLayout) => setLayout(next), []);

    // Mobile panel: re-measure on resize / rotation, after the drawer's 0.3s
    // slide, and every half second while open (the toggle bar can move
    // without a resize). Re-renders only when the measured box changes.
    const [, setMobileBox] = useState('');
    const { is_drawer_open } = run_panel;
    const is_mobile_panel_open = !isDesktop && ai_scanner.is_panel_open;
    useEffect(() => {
        const measure = () => setMobileBox(JSON.stringify(panelStyle(null, false, is_drawer_open)));
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
            {shows_button && <AiScannerButton is_desktop={isDesktop} onLayout={onLayout} />}
            {ai_scanner.is_panel_open && (
                <AiScannerPanel
                    style={panelStyle(layout, isDesktop, run_panel.is_drawer_open)}
                    is_desktop={isDesktop}
                />
            )}
        </>
    );
});

export default AiScanner;
