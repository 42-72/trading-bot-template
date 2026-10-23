import { useEffect } from 'react';
import { AI_SCANNER_TICK_WINDOW } from '@/constants/ai-engine';
import { useDigitAnalysis } from '@/hooks/useDigitAnalysis';
import { useStore } from '@/hooks/useStore';

/**
 * One market's live last-600-digit window for the AI Scanner, through Market
 * Tool's own useDigitAnalysis (retry/backoff, InternalServerError handling, no
 * overlapping subscriptions, forget on unmount, a stream shared on
 * AlreadySubscribed). Renders nothing; mounted per market only while the
 * scanner is scanning or waiting (ai-scanner.tsx).
 */
const MarketFeed = ({ symbol }: { symbol: string }) => {
    const { ai_scanner } = useStore();
    const { digits, lastDigit, lastTickAt, status, n } = useDigitAnalysis(symbol, AI_SCANNER_TICK_WINDOW);

    useEffect(() => ai_scanner.registerFeed(), [ai_scanner]);

    useEffect(() => {
        ai_scanner.setFeedStatus(symbol, { status, n });
    }, [ai_scanner, symbol, status, n]);

    // lastTickAt changes on every accepted tick (and on the seed).
    useEffect(() => {
        if (lastTickAt === null || lastDigit === null) return;
        ai_scanner.onMarketTick(symbol, digits, lastDigit);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lastTickAt]);

    return null;
};

export default MarketFeed;
