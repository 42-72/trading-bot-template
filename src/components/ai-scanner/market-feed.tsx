import { useEffect, useRef } from 'react';
import { AI_SCANNER_TICK_WINDOW } from '@/constants/ai-engine';
import { useDigitAnalysis } from '@/hooks/useDigitAnalysis';
import { useAiScanner } from './use-ai-scanner';

/**
 * One market's live last-600-digit window for the AI Scanner, through Market
 * Tool's own useDigitAnalysis (retry/backoff, InternalServerError handling, no
 * overlapping subscriptions, forget on unmount, a stream shared on
 * AlreadySubscribed). Renders nothing; mounted per market only while the
 * scanner is scanning or waiting (ai-scanner.tsx).
 */
const MarketFeed = ({ symbol }: { symbol: string }) => {
    const ai_scanner = useAiScanner();
    const { digits, lastDigit, lastTickAt, status, n } = useDigitAnalysis(symbol, AI_SCANNER_TICK_WINDOW);

    // Whether the window was already live before this tick: the first
    // lastTickAt after a (re)subscribe is the ticks_history seed, not a tick.
    const was_live_ref = useRef(false);

    useEffect(() => ai_scanner.registerFeed(), [ai_scanner]);

    useEffect(() => {
        ai_scanner.setFeedStatus(symbol, { status, n });
    }, [ai_scanner, symbol, status, n]);

    // lastTickAt changes on every accepted tick (and on the seed).
    useEffect(() => {
        if (lastTickAt === null || lastDigit === null) {
            was_live_ref.current = false;
            return;
        }
        const is_seed = !was_live_ref.current;
        was_live_ref.current = true;
        ai_scanner.onMarketTick(symbol, digits, lastDigit, is_seed);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lastTickAt]);

    return null;
};

export default MarketFeed;
