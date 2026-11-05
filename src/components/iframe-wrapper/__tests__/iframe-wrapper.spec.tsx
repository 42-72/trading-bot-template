import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IframeWrapper, { PATIENT_LOAD_TIMEOUT_MS, SLOW_LOAD_NOTICE_MS } from '..';

const SRC = 'https://charts.deriv.com/deriv?theme=dark';
const patient = (isVisible = true) => ({
    isVisible,
    loadingText: 'Loading chart',
    failedText: "Chart couldn't load",
    retryText: 'Try again',
});
const frame = () => screen.getByTitle('Chart') as HTMLIFrameElement;
const wait = (ms: number) => act(() => jest.advanceTimersByTime(ms));
const setPageHidden = (is_hidden: boolean) => {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (is_hidden ? 'hidden' : 'visible'),
    });
    act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
    });
};

describe('IframeWrapper with patientLoad (TradingView)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
        jest.useRealTimers();
        setPageHidden(false);
        jest.restoreAllMocks();
    });

    it('allows at least 30 s', () => {
        expect(PATIENT_LOAD_TIMEOUT_MS).toBeGreaterThanOrEqual(30000);
    });

    it('shows a loading state until the frame has loaded', () => {
        render(<IframeWrapper src={SRC} title='Chart' patientLoad={patient()} />);
        expect(screen.getByText('Loading chart')).toBeInTheDocument();
        fireEvent.load(frame());
        expect(screen.queryByText('Loading chart')).not.toBeInTheDocument();
    });

    it('does not give up at the old 15 s, nor any time before the limit', () => {
        render(<IframeWrapper src={SRC} title='Chart' patientLoad={patient()} />);
        wait(PATIENT_LOAD_TIMEOUT_MS - 1);
        expect(screen.getByText('Loading chart')).toBeInTheDocument();
        expect(screen.queryByText("Chart couldn't load")).not.toBeInTheDocument();
    });

    it('at the limit: says so with Try again, and no raw link', () => {
        render(<IframeWrapper src={SRC} title='Chart' patientLoad={patient()} />);
        wait(PATIENT_LOAD_TIMEOUT_MS);
        expect(screen.getByText("Chart couldn't load")).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.queryByText(SRC)).not.toBeInTheDocument();
    });

    it('never stops a slow load: the frame survives the limit and a late load clears the message', () => {
        render(<IframeWrapper src={SRC} title='Chart' patientLoad={patient()} />);
        const the_frame = frame();
        wait(PATIENT_LOAD_TIMEOUT_MS + 5000);
        expect(frame()).toBe(the_frame);
        fireEvent.load(the_frame);
        expect(screen.queryByText("Chart couldn't load")).not.toBeInTheDocument();
    });

    it('Try again reloads the frame and gives it the full time again', async () => {
        const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
        render(<IframeWrapper src={SRC} title='Chart' patientLoad={patient()} />);
        const first_frame = frame();
        wait(PATIENT_LOAD_TIMEOUT_MS);
        await user.click(screen.getByRole('button', { name: 'Try again' }));
        expect(frame()).not.toBe(first_frame);
        expect(frame().src).toBe(SRC);
        expect(screen.getByText('Loading chart')).toBeInTheDocument();
        wait(PATIENT_LOAD_TIMEOUT_MS - 1);
        expect(screen.queryByText("Chart couldn't load")).not.toBeInTheDocument();
        wait(1);
        expect(screen.getByText("Chart couldn't load")).toBeInTheDocument();
    });

    it('time only counts while the tab is showing, and resumes where it stopped', () => {
        const { rerender } = render(<IframeWrapper src={SRC} title='Chart' patientLoad={patient(true)} />);
        wait(PATIENT_LOAD_TIMEOUT_MS - 1000);
        rerender(<IframeWrapper src={SRC} title='Chart' patientLoad={patient(false)} />);
        wait(PATIENT_LOAD_TIMEOUT_MS * 5);
        expect(screen.queryByText("Chart couldn't load")).not.toBeInTheDocument();
        rerender(<IframeWrapper src={SRC} title='Chart' patientLoad={patient(true)} />);
        wait(999);
        expect(screen.queryByText("Chart couldn't load")).not.toBeInTheDocument();
        wait(1);
        expect(screen.getByText("Chart couldn't load")).toBeInTheDocument();
    });

    it('a frame opened while its tab is hidden has not used any time', () => {
        const { rerender } = render(<IframeWrapper src={SRC} title='Chart' patientLoad={patient(false)} />);
        wait(PATIENT_LOAD_TIMEOUT_MS * 2);
        rerender(<IframeWrapper src={SRC} title='Chart' patientLoad={patient(true)} />);
        wait(PATIENT_LOAD_TIMEOUT_MS - 1);
        expect(screen.queryByText("Chart couldn't load")).not.toBeInTheDocument();
    });

    it('time stops while the browser itself is in the background (phone)', () => {
        render(<IframeWrapper src={SRC} title='Chart' patientLoad={patient()} />);
        wait(PATIENT_LOAD_TIMEOUT_MS - 1000);
        setPageHidden(true);
        wait(PATIENT_LOAD_TIMEOUT_MS * 5);
        expect(screen.queryByText("Chart couldn't load")).not.toBeInTheDocument();
        setPageHidden(false);
        wait(1000);
        expect(screen.getByText("Chart couldn't load")).toBeInTheDocument();
    });

    it('a load event from the browser error page (server unreachable) is a real failure', async () => {
        (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Failed to fetch'));
        render(<IframeWrapper src={SRC} title='Chart' patientLoad={patient()} />);
        fireEvent.load(frame());
        expect(global.fetch).toHaveBeenCalledWith(SRC, { mode: 'no-cors', cache: 'no-store' });
        expect(await screen.findByText("Chart couldn't load")).toBeInTheDocument();
    });

    it('a reachable server keeps the chart on screen', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({});
        render(<IframeWrapper src={SRC} title='Chart' patientLoad={patient()} />);
        fireEvent.load(frame());
        await act(async () => {
            await Promise.resolve();
        });
        expect(screen.queryByText("Chart couldn't load")).not.toBeInTheDocument();
    });

    it('a check that fails late cannot fail the newer attempt', async () => {
        const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
        let failOldCheck: (reason: Error) => void = () => undefined;
        (global.fetch as jest.Mock)
            .mockReturnValueOnce(
                new Promise((_resolve, reject) => {
                    failOldCheck = reject;
                })
            )
            .mockRejectedValueOnce(new TypeError('Failed to fetch'));
        render(<IframeWrapper src={SRC} title='Chart' patientLoad={patient()} />);
        fireEvent.load(frame()); // its check stays pending
        fireEvent.load(frame()); // its check fails, which offers Try again
        await user.click(await screen.findByRole('button', { name: 'Try again' }));
        expect(screen.getByText('Loading chart')).toBeInTheDocument();
        await act(async () => {
            failOldCheck(new TypeError('Failed to fetch'));
            await Promise.resolve();
        });
        expect(screen.getByText('Loading chart')).toBeInTheDocument();
        expect(screen.queryByText("Chart couldn't load")).not.toBeInTheDocument();
    });
});

describe('IframeWrapper with readySignal (DTrader)', () => {
    const load = (isReady = false, isVisible = true, onRetry?: () => void) => ({
        isVisible,
        failedText: 'Unavailable',
        retryText: 'Try again',
        readySignal: { isReady, slowText: 'Still loading', reloadText: 'Reload DTrader' },
        onRetry,
    });
    const reload = () => screen.queryByRole('button', { name: 'Reload DTrader' });
    const unavailable = () => screen.queryByText('Unavailable');
    const setOnline = (is_online: boolean) => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => is_online });
        act(() => {
            window.dispatchEvent(new Event(is_online ? 'online' : 'offline'));
        });
    };

    beforeEach(() => {
        jest.useFakeTimers();
        (global.fetch as jest.Mock).mockClear();
    });
    afterEach(() => {
        jest.useRealTimers();
        setOnline(true);
        jest.restoreAllMocks();
    });

    it('shows nothing of its own at first, and the bar exactly at 15 s', () => {
        render(<IframeWrapper src={SRC} title='Chart' patientLoad={load()} />);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        wait(SLOW_LOAD_NOTICE_MS - 1);
        expect(reload()).not.toBeInTheDocument();
        wait(1);
        expect(screen.getByText('Still loading')).toBeInTheDocument();
        expect(reload()).toBeInTheDocument();
    });

    it('never removes or replaces the frame on its own, at any limit', () => {
        render(<IframeWrapper src={SRC} title='Chart' patientLoad={load()} />);
        const the_frame = frame();
        wait(SLOW_LOAD_NOTICE_MS);
        expect(frame()).toBe(the_frame);
        wait(PATIENT_LOAD_TIMEOUT_MS * 3);
        expect(frame()).toBe(the_frame);
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('a load event is not ready: the bar still comes, and hides at ready', () => {
        const { rerender } = render(<IframeWrapper src={SRC} title='Chart' patientLoad={load()} />);
        fireEvent.load(frame());
        wait(SLOW_LOAD_NOTICE_MS);
        expect(reload()).toBeInTheDocument();
        rerender(<IframeWrapper src={SRC} title='Chart' patientLoad={load(true)} />);
        expect(reload()).not.toBeInTheDocument();
    });

    it('no bar when ready comes in time, and a load event alone never fails it', () => {
        const { rerender } = render(<IframeWrapper src={SRC} title='Chart' patientLoad={load()} />);
        wait(SLOW_LOAD_NOTICE_MS - 1);
        rerender(<IframeWrapper src={SRC} title='Chart' patientLoad={load(true)} />);
        wait(PATIENT_LOAD_TIMEOUT_MS * 2);
        expect(reload()).not.toBeInTheDocument();
        expect(unavailable()).not.toBeInTheDocument();
    });

    it('a frame that reloads itself is normal: a second load changes nothing', async () => {
        render(<IframeWrapper src={SRC} title='Chart' patientLoad={load()} />);
        const the_frame = frame();
        fireEvent.load(the_frame);
        wait(12000);
        fireEvent.load(the_frame); // its own reload
        wait(PATIENT_LOAD_TIMEOUT_MS * 2);
        await act(async () => {
            await Promise.resolve();
        });
        expect(frame()).toBe(the_frame);
        expect(unavailable()).not.toBeInTheDocument();
        expect(reload()).toBeInTheDocument();
    });

    it('loaded but never ready stays on the bar, not the failure screen', () => {
        render(<IframeWrapper src={SRC} title='Chart' patientLoad={load()} />);
        fireEvent.load(frame());
        wait(PATIENT_LOAD_TIMEOUT_MS * 3);
        expect(unavailable()).not.toBeInTheDocument();
        expect(reload()).toBeInTheDocument();
    });

    it('no load event at all by 60 s: the failure screen with Try again, frame still there', () => {
        render(<IframeWrapper src={SRC} title='Chart' patientLoad={load()} />);
        const the_frame = frame();
        wait(PATIENT_LOAD_TIMEOUT_MS - 1);
        expect(unavailable()).not.toBeInTheDocument();
        wait(1);
        expect(unavailable()).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
        expect(reload()).not.toBeInTheDocument();
        expect(frame()).toBe(the_frame);
    });

    it('a late load or ready clears the failure screen', () => {
        const { rerender } = render(<IframeWrapper src={SRC} title='Chart' patientLoad={load()} />);
        wait(PATIENT_LOAD_TIMEOUT_MS);
        fireEvent.load(frame());
        expect(unavailable()).not.toBeInTheDocument();

        rerender(<IframeWrapper key='next' src={SRC} title='Chart' patientLoad={load()} />);
        wait(PATIENT_LOAD_TIMEOUT_MS);
        expect(unavailable()).toBeInTheDocument();
        rerender(<IframeWrapper key='next' src={SRC} title='Chart' patientLoad={load(true)} />);
        expect(unavailable()).not.toBeInTheDocument();
    });

    it('a load event from the browser error page is a real failure', async () => {
        (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Failed to fetch'));
        render(<IframeWrapper src={SRC} title='Chart' patientLoad={load()} />);
        fireEvent.load(frame());
        expect(await screen.findByText('Unavailable')).toBeInTheDocument();
    });

    it('going offline before ready is a failure, and coming back clears it', () => {
        render(<IframeWrapper src={SRC} title='Chart' patientLoad={load()} />);
        setOnline(false);
        expect(unavailable()).toBeInTheDocument();
        setOnline(true);
        expect(unavailable()).not.toBeInTheDocument();
    });

    it('going offline once ready changes nothing, and a later load asks no question', () => {
        render(<IframeWrapper src={SRC} title='Chart' patientLoad={load(true)} />);
        setOnline(false);
        expect(unavailable()).not.toBeInTheDocument();
        fireEvent.load(frame());
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('Reload makes a fresh frame at the same address, with the full time again', async () => {
        const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
        const onRetry = jest.fn();
        render(<IframeWrapper src={SRC} title='Chart' patientLoad={load(false, true, onRetry)} />);
        const first_frame = frame();
        wait(SLOW_LOAD_NOTICE_MS);
        await user.click(reload() as HTMLElement);
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(frame()).not.toBe(first_frame);
        expect(frame().src).toBe(SRC);
        expect(reload()).not.toBeInTheDocument();
        wait(SLOW_LOAD_NOTICE_MS - 1);
        expect(reload()).not.toBeInTheDocument();
        wait(1);
        expect(reload()).toBeInTheDocument();
    });

    it('time on another tab does not count towards the bar', () => {
        const { rerender } = render(<IframeWrapper src={SRC} title='Chart' patientLoad={load(false, true)} />);
        wait(SLOW_LOAD_NOTICE_MS - 1000);
        rerender(<IframeWrapper src={SRC} title='Chart' patientLoad={load(false, false)} />);
        wait(SLOW_LOAD_NOTICE_MS * 5);
        rerender(<IframeWrapper src={SRC} title='Chart' patientLoad={load(false, true)} />);
        wait(999);
        expect(reload()).not.toBeInTheDocument();
        wait(1);
        expect(reload()).toBeInTheDocument();
    });
});
