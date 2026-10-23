import { act, renderHook } from '@testing-library/react';
import { useDigitAnalysis } from '../useDigitAnalysis';

jest.mock('@/hooks/useApiBase', () => ({
    useApiBase: jest.fn(),
}));

jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: { api: null },
}));

// Import after mocking
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';

type TDeferred = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };

const history = (symbol: string, id = `sub-${symbol}`) => ({
    msg_type: 'history',
    echo_req: { ticks_history: symbol },
    history: { prices: [100.12, 100.15, 100.11], times: [1, 2, 3] },
    pip_size: 2,
    subscription: { id },
});
const apiError = (code: string) => ({ msg_type: 'history', error: { code, message: code.toLowerCase() } });

let send: jest.Mock;
// Each ticks_history call gets a deferred the test settles by hand.
let pending: TDeferred[];

const ticksHistoryCalls = () => send.mock.calls.filter(([req]) => 'ticks_history' in req);
const forgetCalls = () => send.mock.calls.filter(([req]) => 'forget' in req).map(([req]) => req.forget);

// Let resolved promises run their continuations (inside act, so state updates flush).
const flush = async () => {
    await act(async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve();
    });
};
const advance = async (ms: number) => {
    await act(async () => {
        jest.advanceTimersByTime(ms);
    });
    await flush();
};

describe('useDigitAnalysis', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        pending = [];
        send = jest.fn(req => {
            if ('ticks_history' in req) {
                return new Promise((resolve, reject) => pending.push({ resolve, reject }));
            }
            return Promise.resolve({});
        });
        (api_base as unknown as { api: unknown }).api = {
            send,
            onMessage: () => ({ subscribe: () => ({ unsubscribe: jest.fn() }) }),
        };
        (useApiBase as jest.Mock).mockReturnValue({ connectionStatus: 'opened', isAuthorized: true });
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('never sends ticks_history while the symbol is empty', async () => {
        const { result } = renderHook(() => useDigitAnalysis('', 1000));
        await flush();
        expect(ticksHistoryCalls()).toHaveLength(0);
        expect(result.current.status).toBe('idle');
    });

    it('retries after a server error and goes live when a later attempt succeeds', async () => {
        const { result } = renderHook(() => useDigitAnalysis('R_100', 1000));
        await flush();
        expect(ticksHistoryCalls()).toHaveLength(1);

        pending[0].reject(apiError('InternalServerError'));
        await flush();
        expect(result.current.status).toBe('retrying');

        await advance(1000);
        expect(ticksHistoryCalls()).toHaveLength(2);

        pending[1].resolve(history('R_100'));
        await flush();
        expect(result.current.status).toBe('live');
        expect(result.current.n).toBe(3);
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining('InternalServerError - internalservererror'),
            expect.anything()
        );
    });

    it('gives up after 4 attempts (1s, 2s, 4s apart) and reports failed', async () => {
        const { result } = renderHook(() => useDigitAnalysis('R_100', 1000));
        await flush();

        const delays = [1000, 2000, 4000];
        for (let i = 0; i < 4; i++) {
            pending[i].reject(apiError('InternalServerError'));
            await flush();
            if (i < 3) {
                await advance(delays[i] - 1);
                expect(ticksHistoryCalls()).toHaveLength(i + 1); // not before the delay
                await advance(1);
                expect(ticksHistoryCalls()).toHaveLength(i + 2);
            }
        }

        expect(result.current.status).toBe('failed');
        await advance(60000);
        expect(ticksHistoryCalls()).toHaveLength(4); // no further automatic attempts
    });

    it('treats a request with no reply as a failed attempt and forgets its late subscription', async () => {
        const { result } = renderHook(() => useDigitAnalysis('R_100', 1000));
        await flush();

        await advance(10000); // request timeout
        expect(result.current.status).toBe('retrying');

        // The abandoned request answers late: its stream must not be left open.
        pending[0].resolve(history('R_100', 'late-sub'));
        await flush();
        expect(forgetCalls()).toContain('late-sub');

        await advance(1000);
        expect(ticksHistoryCalls()).toHaveLength(2);
        pending[1].resolve(history('R_100'));
        await flush();
        expect(result.current.status).toBe('live');
    });

    it('retry() after failure starts a fresh round of attempts', async () => {
        const { result } = renderHook(() => useDigitAnalysis('R_100', 1000));
        await flush();
        for (let i = 0; i < 4; i++) {
            pending[i].reject(apiError('InternalServerError'));
            await flush();
            if (i < 3) await advance([1000, 2000, 4000][i]);
        }
        expect(result.current.status).toBe('failed');

        act(() => result.current.retry());
        await flush();
        expect(ticksHistoryCalls()).toHaveLength(5);
        pending[4].resolve(history('R_100'));
        await flush();
        expect(result.current.status).toBe('live');
    });

    it('does not re-subscribe the same symbol while an earlier request for it is unanswered', async () => {
        const { rerender } = renderHook(() => useDigitAnalysis('R_100', 1000));
        await flush();
        expect(ticksHistoryCalls()).toHaveLength(1);

        // Login completing re-runs the effect for the same symbol/window.
        (useApiBase as jest.Mock).mockReturnValue({ connectionStatus: 'opened', isAuthorized: false });
        rerender();
        await flush();
        expect(ticksHistoryCalls()).toHaveLength(1); // waits instead of overlapping

        pending[0].resolve(history('R_100', 'first-sub'));
        await flush();
        expect(forgetCalls()).toContain('first-sub'); // superseded stream closed first
        expect(ticksHistoryCalls()).toHaveLength(2); // only then the new request
    });

    it('with nothing else subscribed, sends exactly one subscribing request and owns its stream', async () => {
        const { result, unmount } = renderHook(() => useDigitAnalysis('R_100', 1000));
        await flush();
        pending[0].resolve(history('R_100', 'own-sub'));
        await flush();
        expect(result.current.status).toBe('live');
        expect(ticksHistoryCalls()).toHaveLength(1);
        expect(ticksHistoryCalls()[0][0]).toMatchObject({ ticks_history: 'R_100', subscribe: 1 });
        unmount();
        expect(forgetCalls()).toEqual(['own-sub']);
    });

    it('on AlreadySubscribed, seeds without subscribing and never forgets the shared stream', async () => {
        const { result, unmount } = renderHook(() => useDigitAnalysis('1HZ100V', 600));
        await flush();
        pending[0].reject(apiError('AlreadySubscribed'));
        await flush();

        expect(ticksHistoryCalls()).toHaveLength(2);
        const seedRequest = ticksHistoryCalls()[1][0];
        expect(seedRequest).toMatchObject({ ticks_history: '1HZ100V', count: 600 });
        expect(seedRequest).not.toHaveProperty('subscribe');

        const { subscription, ...unsubscribed } = history('1HZ100V'); // eslint-disable-line @typescript-eslint/no-unused-vars
        pending[1].resolve(unsubscribed);
        await flush();
        expect(result.current.status).toBe('live');
        expect(result.current.n).toBe(3);

        unmount();
        expect(forgetCalls()).toHaveLength(0);
    });

    it('re-subscribes in its own right once a shared stream goes quiet', async () => {
        const { result } = renderHook(() => useDigitAnalysis('1HZ100V', 600));
        await flush();
        pending[0].reject(apiError('AlreadySubscribed'));
        await flush();
        pending[1].resolve({ ...history('1HZ100V'), subscription: undefined });
        await flush();

        await advance(10000); // watchdog: the owner forgot its stream
        expect(ticksHistoryCalls()).toHaveLength(3);
        expect(ticksHistoryCalls()[2][0]).toMatchObject({ subscribe: 1 });
        pending[2].resolve(history('1HZ100V', 'now-ours'));
        await flush();
        expect(result.current.status).toBe('live');
    });

    it('falls back to the normal retry path when the unsubscribed seed also fails', async () => {
        const { result } = renderHook(() => useDigitAnalysis('1HZ100V', 600));
        await flush();
        pending[0].reject(apiError('AlreadySubscribed'));
        await flush();
        pending[1].reject(apiError('InternalServerError'));
        await flush();
        expect(result.current.status).toBe('retrying');
        await advance(1000);
        expect(ticksHistoryCalls()).toHaveLength(3);
    });
});
