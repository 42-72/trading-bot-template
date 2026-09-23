import { useEffect, useReducer, useRef } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import { countDigits, createEmptyCounts, getLastDigit } from '@/utils/digit-stats';

export type TDirection = 'R' | 'F';

type TState = {
    digits: number[];
    counts: number[];
    directions: TDirection[];
    lastDigit: number | null;
    lastDirection: TDirection | null;
    /** Bumped on every accepted tick - a cheap, always-unique key for the UI's pulse animation. */
    lastTickAt: number | null;
    currentQuote: number | null;
};

type TAction =
    | { type: 'RESET' }
    | { type: 'SEED'; digits: number[]; directions: TDirection[]; currentQuote: number | null; windowSize: number }
    | { type: 'PUSH'; digit: number; direction: TDirection; quote: number; windowSize: number };

const initialState: TState = {
    digits: [],
    counts: createEmptyCounts(),
    directions: [],
    lastDigit: null,
    lastDirection: null,
    lastTickAt: null,
    currentQuote: null,
};

// Reducer, not several useState calls: digits/counts/directions/lastDigit
// must always change together in one commit, or the UI could render a
// percentage from one tick paired with a highlighted digit from another.
function reducer(state: TState, action: TAction): TState {
    switch (action.type) {
        case 'RESET':
            return initialState;
        case 'SEED': {
            // One-time O(n) pass over the seed window (ticks_history) - not
            // "per tick", so this doesn't conflict with the no-recount rule below.
            const digits = action.digits.slice(-action.windowSize);
            const directions = action.directions.slice(-action.windowSize);
            return {
                digits,
                counts: countDigits(digits),
                directions,
                lastDigit: digits.length ? digits[digits.length - 1] : null,
                lastDirection: directions.length ? directions[directions.length - 1] : null,
                lastTickAt: digits.length ? Date.now() : null,
                currentQuote: action.currentQuote,
            };
        }
        case 'PUSH': {
            // Incremental: push the new digit, evict the oldest once over
            // the window size, adjust only the two affected counts. Never
            // recounts the whole buffer.
            const counts = state.counts.slice();
            counts[action.digit] += 1;
            const digits = state.digits.concat(action.digit);
            if (digits.length > action.windowSize) {
                const evicted = digits.shift() as number;
                counts[evicted] -= 1;
            }
            const directions = state.directions.concat(action.direction);
            if (directions.length > action.windowSize) directions.shift();
            return {
                digits,
                counts,
                directions,
                lastDigit: action.digit,
                lastDirection: action.direction,
                lastTickAt: Date.now(),
                currentQuote: action.quote,
            };
        }
        default:
            return state;
    }
}

type TTicksHistoryResponse = {
    error?: { message?: string; code?: string };
    history?: { prices?: (string | number)[]; times?: number[] };
    pip_size?: number | string;
    subscription?: { id?: string };
};

/**
 * Streams the last `windowSize` digits (and price directions) for `symbol`
 * over the app's existing, shared Deriv WebSocket (api_base.api -
 * see api-base.ts) - this hook never opens a socket of its own.
 *
 * Re-subscribes whenever `symbol` or `windowSize` changes (clearing the
 * buffer first, so digits from two symbols/windows are never mixed) and
 * whenever the connection transitions back to OPENED after having dropped (a
 * dead subscription from before the drop is never silently reused). Always
 * unsubscribes both the local message listener and the server-side
 * subscription (via `forget`) on cleanup - a leaked tick stream per
 * symbol/window switch is exactly the bug this guards against.
 */
export const useDigitAnalysis = (symbol: string, windowSize: number) => {
    const [state, dispatch] = useReducer(reducer, initialState);
    const { connectionStatus } = useApiBase();
    // pip_size is cached ONLY from the ticks_history response, never from a
    // streamed `tick` (documented optional/not guaranteed there).
    const pipSizeRef = useRef<number | null>(null);
    const subscriptionIdRef = useRef<string | null>(null);
    const messageSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
    // Previous quote, to derive each new tick's R/F direction against - seeded
    // from the last historical price so the first live tick's direction is
    // still relative to something real, not treated as a fresh start.
    const previousQuoteRef = useRef<number | null>(null);

    useEffect(() => {
        if (connectionStatus !== CONNECTION_STATUS.OPENED) return undefined;

        let cancelled = false;

        const cleanupSubscription = () => {
            messageSubscriptionRef.current?.unsubscribe();
            messageSubscriptionRef.current = null;
            if (subscriptionIdRef.current) {
                api_base.api?.send({ forget: subscriptionIdRef.current });
                subscriptionIdRef.current = null;
            }
        };

        const start = async () => {
            cleanupSubscription();
            dispatch({ type: 'RESET' });
            pipSizeRef.current = null;
            previousQuoteRef.current = null;

            if (!api_base.api) return;

            // Registered before the history/subscribe request resolves, so
            // no tick arriving in that gap is missed.
            messageSubscriptionRef.current = api_base.api.onMessage().subscribe((message: unknown) => {
                const data = (message as { data?: { msg_type?: string; tick?: { symbol?: string; quote?: unknown } } })
                    ?.data;
                if (data?.msg_type !== 'tick' || !data.tick) return;
                // Guards against a stray tick for a symbol this hook has
                // already moved away from (e.g. mid-switch race).
                if (data.tick.symbol !== symbol) return;
                if (pipSizeRef.current === null) return; // history hasn't resolved yet

                const quote = Number(data.tick.quote);
                const digit = getLastDigit(quote, pipSizeRef.current);
                const direction: TDirection =
                    previousQuoteRef.current === null || quote >= previousQuoteRef.current ? 'R' : 'F';
                previousQuoteRef.current = quote;
                dispatch({ type: 'PUSH', digit, direction, quote, windowSize });
            });

            try {
                const response = (await api_base.api.send({
                    ticks_history: symbol,
                    end: 'latest',
                    count: windowSize,
                    style: 'ticks',
                    subscribe: 1,
                })) as unknown as TTicksHistoryResponse;

                if (response?.error) {
                    console.error('[DigitAnalysis] ticks_history error:', response.error);
                    return;
                }

                const resolvedPipSize = Number(response?.pip_size ?? 0);
                const subscriptionId = response?.subscription?.id ?? null;

                if (cancelled) {
                    // This effect instance was torn down (symbol/window
                    // change or unmount) before the response arrived - forget
                    // the now-unwanted subscription by its own id rather than
                    // leaking it; do not touch subscriptionIdRef, which may
                    // already belong to a newer, still-active request.
                    if (subscriptionId) api_base.api?.send({ forget: subscriptionId });
                    return;
                }

                pipSizeRef.current = resolvedPipSize;
                subscriptionIdRef.current = subscriptionId;

                const prices = (response?.history?.prices ?? []).map(Number);
                const seedDigits = prices.map(price => getLastDigit(price, resolvedPipSize));
                // Direction needs a previous price, so it's one entry shorter
                // than the digit window - the very first historical price has
                // nothing before it to compare against.
                const seedDirections: TDirection[] = prices
                    .slice(1)
                    .map((price, i) => (price >= prices[i] ? 'R' : 'F'));

                previousQuoteRef.current = prices.length ? prices[prices.length - 1] : null;

                dispatch({
                    type: 'SEED',
                    digits: seedDigits,
                    directions: seedDirections,
                    currentQuote: previousQuoteRef.current,
                    windowSize,
                });
            } catch (error) {
                console.error('[DigitAnalysis] Failed to subscribe to ticks_history:', error);
            }
        };

        start();

        return () => {
            cancelled = true;
            cleanupSubscription();
        };
    }, [symbol, windowSize, connectionStatus]);

    return {
        digits: state.digits,
        counts: state.counts,
        directions: state.directions,
        lastDigit: state.lastDigit,
        lastDirection: state.lastDirection,
        lastTickAt: state.lastTickAt,
        currentQuote: state.currentQuote,
        n: state.digits.length,
        pipSize: pipSizeRef.current,
        isLive: connectionStatus === CONNECTION_STATUS.OPENED,
    };
};
