import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IframeWrapper, { PATIENT_LOAD_TIMEOUT_MS } from '..';

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

describe('IframeWrapper without patientLoad (DTrader): unchanged', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('no loading state of its own, fallback link at 15 s', () => {
        render(<IframeWrapper src={SRC} title='Chart' fallbackMessage='Unavailable' />);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        wait(14999);
        expect(frame()).toBeInTheDocument();
        wait(1);
        expect(screen.getByText('Unavailable')).toBeInTheDocument();
        expect(screen.getByRole('link')).toHaveAttribute('href', SRC);
        expect(screen.queryByTitle('Chart')).not.toBeInTheDocument();
    });

    it('calls onLoad and shows no fallback once loaded, without any extra request', () => {
        (global.fetch as jest.Mock).mockClear();
        const onLoad = jest.fn();
        render(<IframeWrapper src={SRC} title='Chart' onLoad={onLoad} />);
        fireEvent.load(frame());
        wait(60000);
        expect(onLoad).toHaveBeenCalledTimes(1);
        expect(global.fetch).not.toHaveBeenCalled();
        expect(frame()).toBeInTheDocument();
    });
});
