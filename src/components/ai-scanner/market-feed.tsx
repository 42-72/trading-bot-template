import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { AI_SCANNER_TICK_WINDOW } from '@/constants/ai-engine';
import { useDigitAnalysis } from '@/hooks/useDigitAnalysis';
import { useAiScanner } from './use-ai-scanner';

/**
 * One market's live last-600-digit window for the AI Scanner, through Market
 * Tool's own useDigitAnalysis (retry/backoff, InternalServerError handling, no
 * overlapping subscriptions, forget on close, a stream shared on
 * AlreadySubscribed). Renders nothing; mounted per market only while the
 * scanner is scanning (ai-scanner.tsx).
 *
 * It also closes itself the moment the scan ends (are_feeds_wanted false -
 * e.g. the winner is picked) without waiting for the parent to unmount it:
 * the hook gets no symbol, which forgets the stream and clears its watchdog
 * and retry timers, so nothing more is sent and nothing re-subscribes.
 */
const MarketFeed = observer(({ symbol }: { symbol: string }) => {
    const ai_scanner = useAiScanner();
    const is_wanted = ai_scanner.are_feeds_wanted;
    const { digits, lastDigit, lastTickAt, status, n } = useDigitAnalysis(
        is_wanted ? symbol : '',
        AI_SCANNER_TICK_WINDOW
    );

    // Whether the window was already live before this tick: the first
    // lastTickAt after a (re)subscribe is the ticks_history seed, not a tick.
    const was_live_ref = useRef(false);

    // Counted only while open, so Run (which waits for every feed to close)
    // never waits on a feed that has already let go of its stream.
    useEffect(() => (is_wanted ? ai_scanner.registerFeed() : undefined), [ai_scanner, is_wanted]);

    useEffect(() => {
        if (is_wanted) ai_scanner.setFeedStatus(symbol, { status, n });
    }, [ai_scanner, symbol, status, n, is_wanted]);

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
});

export default MarketFeed;
