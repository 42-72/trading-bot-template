import { useEffect, useReducer, useRef } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import { countDigits, createEmptyCounts, getLastDigit, MAX_BUFFER } from '@/utils/digit-stats';

type TState = {
    digits: number[];
    counts: number[];
    lastDigit: number | null;
    /** Bumped on every accepted tick - a cheap, always-unique key for the UI's pulse animation. */
    lastTickAt: number | null;
};

type TAction = { type: 'RESET' } | { type: 'SEED'; digits: number[] } | { type: 'PUSH'; digit: number };

const initialState: TState = { digits: [], counts: createEmptyCounts(), lastDigit: null, lastTickAt: null };

// Reducer, not several useState calls: digits/counts/lastDigit must always
// change together in one commit, or the UI could render a percentage from
// one tick paired with a highlighted digit from another.
function reducer(state: TState, action: TAction): TState {
    switch (action.type) {
        case 'RESET':
            return initialState;
        case 'SEED': {
            // One-time O(n) pass over the seed window (ticks_history) - not
            // "per tick", so this doesn't conflict with the no-recount rule below.
            const digits = action.digits.slice(-MAX_BUFFER);
            return {
                digits,
                counts: countDigits(digits),
                lastDigit: digits.length ? digits[digits.length - 1] : null,
                lastTickAt: digits.length ? Date.now() : null,
            };
        }
        case 'PUSH': {
            // Incremental: push the new digit, evict the oldest once over
            // MAX_BUFFER, adjust only the two affected counts. Never
            // recounts the whole buffer.
            const counts = state.counts.slice();
            counts[action.digit] += 1;
            const digits = state.digits.concat(action.digit);
            if (digits.length > MAX_BUFFER) {
                const evicted = digits.shift() as number;
                counts[evicted] -= 1;
            }
            return { digits, counts, lastDigit: action.digit, lastTickAt: Date.now() };
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
 * Streams the last MAX_BUFFER digits for `symbol` over the app's existing,
 * shared Deriv WebSocket (api_base.api - see api-base.ts) - this hook never
 * opens a socket of its own.
 *
 * Re-subscribes whenever `symbol` changes (clearing the buffer first, so
 * digits from two symbols are never mixed) and whenever the connection
 * transitions back to OPENED after having dropped (a dead subscription from
 * before the drop is never silently reused). Always unsubscribes both the
 * local message listener and the server-side subscription (via `forget`) on
 * cleanup - a leaked tick stream per symbol switch is exactly the bug this
 * guards against.
 */
export const useDigitAnalysis = (symbol: string) => {
    const [state, dispatch] = useReducer(reducer, initialState);
    const { connectionStatus } = useApiBase();
    // pip_size is cached ONLY from the ticks_history response, never from a
    // streamed `tick` (documented optional/not guaranteed there).
    const pipSizeRef = useRef<number | null>(null);
    const subscriptionIdRef = useRef<string | null>(null);
    const messageSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

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
                dispatch({ type: 'PUSH', digit: getLastDigit(data.tick.quote as string | number, pipSizeRef.current) });
            });

            try {
                const response = (await api_base.api.send({
                    ticks_history: symbol,
                    end: 'latest',
                    count: MAX_BUFFER,
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
                    // This effect instance was torn down (symbol change or
                    // unmount) before the response arrived - forget the
                    // now-unwanted subscription by its own id rather than
                    // leaking it; do not touch subscriptionIdRef, which may
                    // already belong to a newer, still-active request.
                    if (subscriptionId) api_base.api?.send({ forget: subscriptionId });
                    return;
                }

                pipSizeRef.current = resolvedPipSize;
                subscriptionIdRef.current = subscriptionId;

                const prices = response?.history?.prices ?? [];
                const seedDigits = prices.map(price => getLastDigit(price, resolvedPipSize));
                dispatch({ type: 'SEED', digits: seedDigits });
            } catch (error) {
                console.error('[DigitAnalysis] Failed to subscribe to ticks_history:', error);
            }
        };

        start();

        return () => {
            cancelled = true;
            cleanupSubscription();
        };
    }, [symbol, connectionStatus]);

    return {
        digits: state.digits,
        counts: state.counts,
        lastDigit: state.lastDigit,
        lastTickAt: state.lastTickAt,
        n: state.digits.length,
        pipSize: pipSizeRef.current,
        isLive: connectionStatus === CONNECTION_STATUS.OPENED,
    };
};
