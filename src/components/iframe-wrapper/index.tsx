import React, { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import Button from '@/components/shared_ui/button';
import './iframe-wrapper.scss';

type TReadySignal = {
    /** The framed page has said it is ready. The load event doesn't mean that. */
    isReady: boolean;
    slowText: string;
    reloadText: string;
};

type TPatientLoad = {
    /** Whether the frame's tab is on screen. Only that time counts towards the limits. */
    isVisible: boolean;
    /** Leave out if the caller shows its own loading state. */
    loadingText?: string;
    failedText: string;
    retryText: string;
    /** For a page that reports when it is ready: adds the "still loading" bar. */
    readySignal?: TReadySignal;
    /** Called when the trader asks for a fresh frame (Try again, Reload). */
    onRetry?: () => void;
};

type TIframeWrapperProps = {
    src: string;
    title: string;
    className?: string;
    // Lets the caller talk to the framed page (postMessage) - optional
    frameRef?: React.Ref<HTMLIFrameElement>;
    // Optional iframe sandbox (omitted = no sandbox, as for TradingView)
    sandbox?: string;
    // Called on every load event, and a frame can have several - optional
    onLoad?: () => void;
    // Pages here are heavy and connections slow: PATIENT_LOAD_TIMEOUT_MS of
    // on-screen time, and the frame keeps loading even past that.
    patientLoad: TPatientLoad;
};

type TLoadStatus = 'loading' | 'loaded' | 'failed';

// charts.deriv.com measured from a cold cache: load at 8-10 s on a fast line,
// 14 s on slow 4G, 43 s on weak 3G - on a desktop CPU, so longer on a phone.
export const PATIENT_LOAD_TIMEOUT_MS = 60000;
// With a readySignal: not ready by now gets the "still loading" bar.
export const SLOW_LOAD_NOTICE_MS = 15000;

const isPageVisible = () => document.visibilityState !== 'hidden';

/**
 * Runs onElapsed after ms of is_counting time. The countdown pauses, keeping
 * what's left, whenever is_counting is false: a hidden tab or a phone with the
 * browser in the background says nothing about whether the page can load.
 */
const useOnScreenTimeout = (is_counting: boolean, ms: number, restart_key: string, onElapsed: () => void) => {
    const remaining_ms_ref = useRef(ms);
    const on_elapsed_ref = useRef(onElapsed);
    on_elapsed_ref.current = onElapsed;

    // Every new load starts with the full allowance.
    useEffect(() => {
        remaining_ms_ref.current = ms;
    }, [ms, restart_key]);

    useEffect(() => {
        if (!is_counting) return undefined;
        const started_at = Date.now();
        const timeout_id = setTimeout(() => on_elapsed_ref.current(), remaining_ms_ref.current);
        return () => {
            clearTimeout(timeout_id);
            remaining_ms_ref.current -= Date.now() - started_at;
        };
    }, [is_counting, restart_key]);
};

/**
 * Generic third-party iframe embed. Not specific to any one embedded page
 * (TradingView, DTrader, ...) - callers supply src/title. It never removes a
 * frame on its own: messages lie over it, and a late load or ready clears them.
 */
const IframeWrapper = ({ src, title, className, frameRef, sandbox, onLoad, patientLoad }: TIframeWrapperProps) => {
    const { readySignal: ready_signal } = patientLoad;
    const has_ready_signal = !!ready_signal;
    const is_ready = !!ready_signal?.isReady;

    const [status, setStatus] = useState<TLoadStatus>('loading');
    const [is_slow, setIsSlow] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [is_page_visible, setIsPageVisible] = useState(isPageVisible);
    const attempt_ref = useRef(attempt);
    attempt_ref.current = attempt;
    const has_loaded_ref = useRef(false);

    useEffect(() => {
        const onVisibilityChange = () => setIsPageVisible(isPageVisible());
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, []);

    useEffect(() => {
        has_loaded_ref.current = false;
        setStatus('loading');
        setIsSlow(false);
    }, [src, attempt]);

    // A page that isn't ready can't get there offline. Back online, it may still.
    useEffect(() => {
        if (!has_ready_signal) return undefined;
        const onOffline = () => setStatus('failed');
        const onOnline = () =>
            setStatus(current => {
                if (current !== 'failed') return current;
                return has_loaded_ref.current ? 'loaded' : 'loading';
            });
        if (navigator.onLine === false) onOffline();
        window.addEventListener('offline', onOffline);
        window.addEventListener('online', onOnline);
        return () => {
            window.removeEventListener('offline', onOffline);
            window.removeEventListener('online', onOnline);
        };
    }, [has_ready_signal, attempt]);

    const is_on_screen = patientLoad.isVisible && is_page_visible;
    const restart_key = `${src} ${attempt}`;

    useOnScreenTimeout(status === 'loading' && is_on_screen, PATIENT_LOAD_TIMEOUT_MS, restart_key, () =>
        setStatus('failed')
    );
    useOnScreenTimeout(
        has_ready_signal && !is_ready && !is_slow && is_on_screen,
        SLOW_LOAD_NOTICE_MS,
        restart_key,
        () => setIsSlow(true)
    );

    const handleLoad = () => {
        has_loaded_ref.current = true;
        setStatus('loaded');
        onLoad?.();
        if (is_ready) return;
        // A frame that can't reach its server still fires load, for the
        // browser's own error page, and a cross-origin frame can't be looked
        // into. This request fails in exactly that case (offline, DNS, dropped
        // connection), and only then: no-cors never fails on the response.
        const loaded_attempt = attempt;
        fetch(src, { mode: 'no-cors', cache: 'no-store' }).catch(() => {
            if (attempt_ref.current === loaded_attempt) setStatus('failed');
        });
    };

    const handleError = () => {
        setStatus('failed');
    };

    const retry = () => {
        patientLoad.onRetry?.();
        setAttempt(current => current + 1);
    };

    // A page that says it is ready has answered every doubt about it.
    const has_failed = status === 'failed' && !is_ready;

    return (
        <div className={classNames('iframe-wrapper', className)}>
            {/* Stays in place past every limit: removing it would end a load
                that is only slow, and a late load event still clears the message. */}
            <iframe
                key={attempt}
                ref={frameRef}
                src={src}
                title={title}
                sandbox={sandbox}
                className='iframe-wrapper__frame'
                frameBorder='0'
                allowFullScreen
                loading='eager'
                referrerPolicy='no-referrer-when-downgrade'
                allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; display-capture'
                onLoad={handleLoad}
                onError={handleError}
            />
            {patientLoad.loadingText && status === 'loading' && (
                <div className='iframe-wrapper__status' role='status' aria-live='polite'>
                    <span className='iframe-wrapper__spinner' aria-hidden='true' />
                    <span className='iframe-wrapper__status-text'>{patientLoad.loadingText}</span>
                </div>
            )}
            {ready_signal && is_slow && !is_ready && !has_failed && (
                <div className='iframe-wrapper__slow' role='status' aria-live='polite'>
                    <span>{ready_signal.slowText}</span>
                    <button type='button' className='iframe-wrapper__slow-reload' onClick={retry}>
                        {ready_signal.reloadText}
                    </button>
                </div>
            )}
            {has_failed && (
                <div className='iframe-wrapper__status iframe-wrapper__status--failed' role='alert'>
                    <p className='iframe-wrapper__status-text'>{patientLoad.failedText}</p>
                    <Button primary has_effect onClick={retry}>
                        {patientLoad.retryText}
                    </Button>
                </div>
            )}
        </div>
    );
};

export default IframeWrapper;
