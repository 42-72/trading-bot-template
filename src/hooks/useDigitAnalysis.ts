import { useEffect, useReducer, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import { silenceLog } from '@/utils/ai-silence-log';
import { countDigits, createEmptyCounts, getLastDigit } from '@/utils/digit-stats';

// No tick for this long after a subscription is considered live means the
// stream is dead (server-side drop, a stale subscription surviving a socket
// swap, etc.) even though nothing told us so - re-subscribing is cheaper
// and safer than waiting indefinitely for a tick that will never come.
// 3s: the bot engine's own forget_all 'ticks' (sent when Bot Builder's
// market changes and on every bot stop / restart) silently ends every tick
// stream on the shared socket, Market Tool's and the AI Scanner's alike, and
// this is how they come back. (1s) and Jump indices tick every second, the
// plain Volatility indices about every 2s.
const WATCHDOG_TIMEOUT_MS = 3000;

// Retry policy for a ticks_history subscribe that fails or never replies.
// Deriv's server intermittently answers a valid request with
// InternalServerError (seen on the authorized /demo socket; the identical
// payload succeeds on the public socket), and before this, one failure left
// the symbol blank forever. 4 attempts in total, waiting 1s, 2s, then 4s
// between them: a transient server fault normally clears within seconds,
// and the cap turns a real outage into a visible "couldn't load" within ~7s
// (fast errors) or ~47s (every attempt timing out) instead of an endless
// spinner.
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
// A request with no reply at all (the await would otherwise hang forever,
// with no watchdog armed) counts as a failed attempt after this long.
const REQUEST_TIMEOUT_MS = 10000;

/** idle: nothing to load yet (no symbol). failed: retries exhausted - the UI must say so. */
export type TStreamStatus = 'idle' | 'connecting' | 'retrying' | 'live' | 'failed';

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
    /**
     * +1 on every seed and every accepted tick, never reset (not even by a
     * re-subscribe's RESET), so a consumer can react to each update even
     * when two land in one render or share a millisecond.
     */
    updateCount: number;
    /** What the latest update was: the ticks_history seed, or a live tick. */
    lastUpdateKind: 'seed' | 'tick' | null;
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
    updateCount: 0,
    lastUpdateKind: null,
};

// Reducer, not several useState calls: digits/counts/directions/lastDigit
// must always change together in one commit, or the UI could render a
// percentage from one tick paired with a highlighted digit from another.
function reducer(state: TState, action: TAction): TState {
    switch (action.type) {
        case 'RESET':
            return { ...initialState, updateCount: state.updateCount };
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
                updateCount: state.updateCount + 1,
                lastUpdateKind: 'seed',
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
                updateCount: state.updateCount + 1,
                lastUpdateKind: 'tick',
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

/** Pulls .code/.message out of whatever shape the API/transport handed back, instead of logging an opaque "Object". */
const describeError = (error: unknown): { code?: string; message?: string } => {
    if (error && typeof error === 'object') {
        const err = error as { code?: unknown; message?: unknown; error?: { code?: unknown; message?: unknown } };
        return {
            code: (err.code ?? err.error?.code) as string | undefined,
            message: (err.message ?? err.error?.message) as string | undefined,
        };
    }
    return { message: String(error) };
};

/**
 * Streams the last `windowSize` digits (and price directions) for `symbol`
 * over the app's existing, shared Deriv WebSocket (api_base.api -
 * see api-base.ts) - this hook never opens a socket of its own.
 *
 * Re-subscribes whenever `symbol` or `windowSize` changes (clearing the
 * buffer first, so digits from two symbols/windows are never mixed),
 * whenever the connection transitions back to OPENED after having dropped,
 * and whenever `isAuthorized` flips (login completing, or an account
 * switch) - a subscribe sent while the socket is mid-authorize can be
 * silently dropped, and a dead subscription from before either transition
 * is never silently reused. A 10s no-tick watchdog re-subscribes a stream
 * that went quiet. A subscribe that fails or never replies is retried
 * (MAX_ATTEMPTS / RETRY_DELAYS_MS); after the last attempt `status` is
 * 'failed' and `retry()` starts over. Always unsubscribes both the local
 * message listener and the server-side subscription (via `forget`) on
 * cleanup - including a subscription that only arrives after the request
 * that asked for it was abandoned.
 */
export const useDigitAnalysis = (symbol: string, windowSize: number) => {
    const [state, dispatch] = useReducer(reducer, initialState);
    const { connectionStatus, isAuthorized } = useApiBase();
    // pip_size is cached ONLY from the ticks_history response, never from a
    // streamed `tick` (documented optional/not guaranteed there).
    const pipSizeRef = useRef<number | null>(null);
    const subscriptionIdRef = useRef<string | null>(null);
    const messageSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
    // Previous quote, to derive each new tick's R/F direction against - seeded
    // from the last historical price so the first live tick's direction is
    // still relative to something real, not treated as a fresh start.
    const previousQuoteRef = useRef<number | null>(null);
    // Epoch of the newest tick already in the window (seeded from the
    // history's last time). Two subscriptions to the same symbol on this
    // socket (Market Tool and the AI Scanner, say) deliver every tick twice,
    // and the listener below only filters by symbol - a tick that isn't newer
    // than this is a duplicate and never enters the window again.
    const lastEpochRef = useRef<number | null>(null);
    const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // [AI-SILENCE] (temporary): when this stream last delivered a live tick or seed.
    const lastAliveAtRef = useRef(0);
    // The ticks_history request still waiting for its reply, if any. Outlives
    // a single effect run on purpose: a re-run for the same symbol/window must
    // not subscribe again while an earlier request for it is unanswered.
    const inFlightRef = useRef<{ key: string; settled: Promise<void> } | null>(null);
    const [status, setStatus] = useState<TStreamStatus>('idle');
    // Bumped by retry() - an effect dependency, so a manual retry just starts over.
    const [retryNonce, setRetryNonce] = useState(0);

    useEffect(() => {
        if (connectionStatus !== CONNECTION_STATUS.OPENED) return undefined;
        // Market Tool mounts with symbol '' until its list loads - never send
        // ticks_history for that.
        if (!symbol) {
            setStatus('idle');
            return undefined;
        }

        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        const key = `${symbol}|${windowSize}`;

        const forget = (subscription_id?: string | null) => {
            if (subscription_id) api_base.api?.send({ forget: subscription_id });
        };

        const clearWatchdog = () => {
            if (watchdogRef.current) {
                clearTimeout(watchdogRef.current);
                watchdogRef.current = null;
            }
        };

        const clearRetry = () => {
            if (retryTimer) {
                clearTimeout(retryTimer);
                retryTimer = null;
            }
        };

        const cleanupSubscription = () => {
            clearWatchdog();
            clearRetry();
            messageSubscriptionRef.current?.unsubscribe();
            messageSubscriptionRef.current = null;
            forget(subscriptionIdRef.current);
            subscriptionIdRef.current = null;
        };

        // Re-armed on every tick and right after a successful (re)subscribe -
        // whichever fires last is always the most recent sign of life.
        const armWatchdog = () => {
            clearWatchdog();
            watchdogRef.current = setTimeout(() => {
                if (cancelled) return;
                console.warn(
                    `[DigitAnalysis] No tick for ${WATCHDOG_TIMEOUT_MS / 1000}s on ${symbol} - re-subscribing`
                );
                silenceLog(`watchdog ${symbol}: silent for ${Date.now() - lastAliveAtRef.current}ms - re-subscribing`);
                start();
            }, WATCHDOG_TIMEOUT_MS);
        };

        // Shared by a normal subscribe and the AlreadySubscribed fallback.
        const seed = (response: TTicksHistoryResponse) => {
            const resolvedPipSize = Number(response?.pip_size ?? 0);
            pipSizeRef.current = resolvedPipSize;

            const prices = (response?.history?.prices ?? []).map(Number);
            const seedDigits = prices.map(price => getLastDigit(price, resolvedPipSize));
            // Direction needs a previous price, so it's one entry shorter
            // than the digit window - the very first historical price has
            // nothing before it to compare against.
            const seedDirections: TDirection[] = prices.slice(1).map((price, i) => (price >= prices[i] ? 'R' : 'F'));

            previousQuoteRef.current = prices.length ? prices[prices.length - 1] : null;
            const times = response?.history?.times ?? [];
            lastEpochRef.current = times.length ? Number(times[times.length - 1]) : null;

            dispatch({
                type: 'SEED',
                digits: seedDigits,
                directions: seedDirections,
                currentQuote: previousQuoteRef.current,
                windowSize,
            });
            setStatus('live');
            lastAliveAtRef.current = Date.now();
            armWatchdog();
        };

        // true when the window was seeded and the shared stream is in use;
        // false sends the caller down the normal retry path.
        const seedFromSharedStream = async (): Promise<boolean> => {
            if (!api_base.api) return false;
            let timeout_id: ReturnType<typeof setTimeout> | undefined;
            try {
                const request = api_base.api.send({
                    ticks_history: symbol,
                    end: 'latest',
                    count: windowSize,
                    style: 'ticks',
                }) as unknown as Promise<TTicksHistoryResponse>;
                const timeout = new Promise<never>((_, reject) => {
                    timeout_id = setTimeout(() => reject({ error: { code: 'RequestTimeout' } }), REQUEST_TIMEOUT_MS);
                });
                const response = await Promise.race([request, timeout]);
                if (response?.error) throw response;
                if (cancelled) return true;
                console.warn(`[DigitAnalysis] ${symbol} is already streamed on this socket - sharing that stream`);
                seed(response);
                return true;
            } catch {
                return false;
            } finally {
                clearTimeout(timeout_id);
            }
        };

        const attempt = async (attempt_no: number) => {
            // Overlap guard: an earlier request for this same symbol/window (a
            // previous effect run, or an attempt that timed out) may still be
            // unanswered. If it later succeeded, the server would hold that
            // stream while we ask for another. Wait for it to settle first -
            // it forgets its own subscription when it's no longer wanted.
            const previous = inFlightRef.current;
            if (previous && previous.key === key) await previous.settled;
            if (cancelled || !api_base.api) return;

            // Set once this attempt's reply is no longer wanted (failed, timed
            // out or superseded): a subscription that still arrives is forgotten.
            let abandoned = false;
            const request = api_base.api.send({
                ticks_history: symbol,
                end: 'latest',
                count: windowSize,
                style: 'ticks',
                subscribe: 1,
            }) as unknown as Promise<TTicksHistoryResponse>;
            const entry = {
                key,
                settled: request.then(
                    response => {
                        if (abandoned) forget(response?.subscription?.id);
                    },
                    () => undefined
                ),
            };
            inFlightRef.current = entry;
            entry.settled.then(() => {
                if (inFlightRef.current === entry) inFlightRef.current = null;
            });

            let timeout_id: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<never>((_, reject) => {
                timeout_id = setTimeout(
                    () =>
                        reject({
                            error: { code: 'RequestTimeout', message: `no reply within ${REQUEST_TIMEOUT_MS / 1000}s` },
                        }),
                    REQUEST_TIMEOUT_MS
                );
            });

            try {
                // deriv-api rejects with the whole response when it carries an
                // error; a resolved response with .error is treated the same.
                const response = await Promise.race([request, timeout]);
                clearTimeout(timeout_id);
                if (response?.error) throw response;

                const subscription_id = response?.subscription?.id ?? null;
                if (cancelled) {
                    // Torn down (symbol/window change or unmount) while waiting -
                    // forget this subscription by its own id; never touch
                    // subscriptionIdRef, which may belong to a newer request.
                    abandoned = true;
                    forget(subscription_id);
                    return;
                }

                subscriptionIdRef.current = subscription_id;
                seed(response);
            } catch (error) {
                clearTimeout(timeout_id);
                abandoned = true;
                if (cancelled) return;

                const { code, message } = describeError(error);

                // Another consumer on this same socket (the AI Scanner, Market
                // Tool, the bot's own ticks service) already holds this
                // symbol's tick stream, so the server refuses a second one.
                // Seed the window from a plain, unsubscribed ticks_history and
                // read that existing stream - the listener above already
                // accepts every tick for this symbol. subscriptionIdRef stays
                // null: the stream isn't ours, so it's never forgotten from
                // here. If its owner forgets it, the watchdog goes off after
                // 10s and start() subscribes in our own right.
                if (code === 'AlreadySubscribed' && (await seedFromSharedStream())) return;
                console.error(
                    `[DigitAnalysis] ticks_history ${symbol} failed (attempt ${attempt_no}/${MAX_ATTEMPTS}): ` +
                        `${code ?? 'unknown'} - ${message ?? 'no message'}`,
                    error
                );

                if (attempt_no < MAX_ATTEMPTS) {
                    setStatus('retrying');
                    retryTimer = setTimeout(
                        () => {
                            retryTimer = null;
                            if (!cancelled) attempt(attempt_no + 1);
                        },
                        RETRY_DELAYS_MS[attempt_no - 1]
                    );
                } else {
                    setStatus('failed');
                }
            }
        };

        const start = () => {
            cleanupSubscription();
            dispatch({ type: 'RESET' });
            pipSizeRef.current = null;
            previousQuoteRef.current = null;
            lastEpochRef.current = null;
            setStatus('connecting');

            if (!api_base.api) return;

            // Registered before the history/subscribe request resolves, so
            // no tick arriving in that gap is missed. Kept across retries.
            messageSubscriptionRef.current = api_base.api.onMessage().subscribe((message: unknown) => {
                const data = (
                    message as {
                        data?: { msg_type?: string; tick?: { symbol?: string; quote?: unknown; epoch?: unknown } };
                    }
                )?.data;
                if (data?.msg_type !== 'tick' || !data.tick) return;
                // Guards against a stray tick for a symbol this hook has
                // already moved away from (e.g. mid-switch race).
                if (data.tick.symbol !== symbol) return;
                if (pipSizeRef.current === null) return; // history hasn't resolved yet

                const epoch = Number(data.tick.epoch);
                if (Number.isFinite(epoch)) {
                    if (lastEpochRef.current !== null && epoch <= lastEpochRef.current) return;
                    lastEpochRef.current = epoch;
                }

                const quote = Number(data.tick.quote);
                const digit = getLastDigit(quote, pipSizeRef.current);
                const direction: TDirection =
                    previousQuoteRef.current === null || quote >= previousQuoteRef.current ? 'R' : 'F';
                previousQuoteRef.current = quote;
                dispatch({ type: 'PUSH', digit, direction, quote, windowSize });
                lastAliveAtRef.current = Date.now();
                armWatchdog();
            });

            attempt(1);
        };

        start();

        return () => {
            cancelled = true;
            cleanupSubscription();
        };
    }, [symbol, windowSize, connectionStatus, isAuthorized, retryNonce]);

    return {
        digits: state.digits,
        counts: state.counts,
        directions: state.directions,
        lastDigit: state.lastDigit,
        lastDirection: state.lastDirection,
        lastTickAt: state.lastTickAt,
        currentQuote: state.currentQuote,
        updateCount: state.updateCount,
        lastUpdateKind: state.lastUpdateKind,
        n: state.digits.length,
        pipSize: pipSizeRef.current,
        isLive: connectionStatus === CONNECTION_STATUS.OPENED,
        isConnecting: status === 'connecting' || status === 'retrying',
        status,
        retry: () => setRetryNonce(nonce => nonce + 1),
    };
};
