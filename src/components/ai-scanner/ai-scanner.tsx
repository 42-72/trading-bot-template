import { useCallback, useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { isAiScannerSymbol } from '@/constants/ai-engine';
import { useStore } from '@/hooks/useStore';
import { useSyntheticSymbols } from '@/hooks/useSyntheticSymbols';
import { useDevice } from '@deriv-com/ui';
import AiScannerButton from './ai-scanner-button';
import { getSafeBounds, TBounds, TPoint } from './ai-scanner-layout';
import AiScannerPanel from './ai-scanner-panel';
import MarketFeed from './market-feed';
import { useAiScanner } from './use-ai-scanner';
import './ai-scanner.scss';

const PANEL_WIDTH = 360;
const GAP = 8;

type TLayout = { position: TPoint; size: number; bounds: TBounds };

/**
 * Desktop: next to the button, opening toward the side with more room, kept
 * inside the safe area (never over the Run bar or the run panel column).
 * Mobile: the whole safe area - below the header, above the run bar.
 */
const panelStyle = (layout: TLayout | null, is_desktop: boolean): React.CSSProperties => {
    if (!is_desktop) {
        // Measured fresh: the button that reports `layout` is hidden while
        // the mobile panel is open.
        const bounds = getSafeBounds();
        return {
            top: bounds.top + GAP,
            left: bounds.left + GAP,
            right: window.innerWidth - bounds.right + GAP,
            bottom: window.innerHeight - bounds.bottom + GAP,
        };
    }
    if (!layout) return { visibility: 'hidden' };
    const { position, size, bounds } = layout;
    const width = Math.min(PANEL_WIDTH, bounds.right - bounds.left - 2 * GAP);
    const left = Math.min(Math.max(position.x, bounds.left + GAP), bounds.right - GAP - width);
    const room_above = position.y - bounds.top - 2 * GAP;
    const room_below = bounds.bottom - (position.y + size) - 2 * GAP;
    return room_above >= room_below
        ? { left, width, bottom: window.innerHeight - position.y + GAP, maxHeight: room_above }
        : { left, width, top: position.y + size + GAP, maxHeight: room_below };
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

    // Mobile panel: re-measure on resize / rotation.
    const [, setViewportNonce] = useState(0);
    useEffect(() => {
        const onResize = () => setViewportNonce(nonce => nonce + 1);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    // The mobile run drawer covers the screen when open - stay out of its way.
    const is_hidden = !isDesktop && run_panel.is_drawer_open;
    // On mobile the panel fills the safe area, so the button would sit on it.
    const shows_button = !is_hidden && (isDesktop || !ai_scanner.is_panel_open);

    return (
        <>
            {ai_scanner.are_feeds_wanted &&
                ai_scanner.markets.map(market => <MarketFeed key={market.symbol} symbol={market.symbol} />)}
            {shows_button && <AiScannerButton is_desktop={isDesktop} onLayout={onLayout} />}
            {!is_hidden && ai_scanner.is_panel_open && (
                <AiScannerPanel style={panelStyle(layout, isDesktop)} is_desktop={isDesktop} />
            )}
        </>
    );
});

export default AiScanner;
