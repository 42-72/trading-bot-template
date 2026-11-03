import { act, renderHook } from '@testing-library/react';
import { STARTUP_WATCHDOG_MS, useStartupWatchdog } from '../useStartupWatchdog';

describe('useStartupWatchdog (bot area start-up safety net)', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.spyOn(console, 'info').mockImplementation(() => {});
    });
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('normal load: finishes in time - no retry, no message', () => {
        const retry = jest.fn();
        const { result, rerender } = renderHook(({ loading }) => useStartupWatchdog(loading, retry), {
            initialProps: { loading: true },
        });
        act(() => jest.advanceTimersByTime(2000));
        rerender({ loading: false });
        act(() => jest.advanceTimersByTime(STARTUP_WATCHDOG_MS * 3));
        expect(retry).not.toHaveBeenCalled();
        expect(result.current.has_failed).toBe(false);
    });

    it('still loading after 15 s: the start-up is retried once', () => {
        const retry = jest.fn();
        const { result } = renderHook(() => useStartupWatchdog(true, retry));
        act(() => jest.advanceTimersByTime(STARTUP_WATCHDOG_MS - 1));
        expect(retry).not.toHaveBeenCalled();
        act(() => jest.advanceTimersByTime(1));
        expect(retry).toHaveBeenCalledTimes(1);
        expect(result.current.has_failed).toBe(false);
    });

    it('the retry works: no message', () => {
        const retry = jest.fn();
        const { result, rerender } = renderHook(({ loading }) => useStartupWatchdog(loading, retry), {
            initialProps: { loading: true },
        });
        act(() => jest.advanceTimersByTime(STARTUP_WATCHDOG_MS));
        rerender({ loading: false });
        act(() => jest.advanceTimersByTime(STARTUP_WATCHDOG_MS * 2));
        expect(retry).toHaveBeenCalledTimes(1);
        expect(result.current.has_failed).toBe(false);
    });

    it('still loading 15 s after the retry: has_failed (the Reload message) - and no second retry', () => {
        const retry = jest.fn();
        const { result } = renderHook(() => useStartupWatchdog(true, retry));
        act(() => jest.advanceTimersByTime(STARTUP_WATCHDOG_MS));
        act(() => jest.advanceTimersByTime(STARTUP_WATCHDOG_MS));
        expect(result.current.has_failed).toBe(true);
        act(() => jest.advanceTimersByTime(STARTUP_WATCHDOG_MS * 4));
        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('writes [CT start] console lines for the retry and the failure', () => {
        renderHook(() => useStartupWatchdog(true, jest.fn()));
        act(() => jest.advanceTimersByTime(STARTUP_WATCHDOG_MS));
        act(() => jest.advanceTimersByTime(STARTUP_WATCHDOG_MS));
        const lines = (console.info as jest.Mock).mock.calls.map(([line]) => String(line));
        expect(lines).toEqual([
            '[CT start] bot area not ready after 15s - retrying the start-up once',
            '[CT start] bot area still not ready after the retry - showing the Reload message',
        ]);
    });
});
