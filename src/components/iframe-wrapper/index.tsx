import React, { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import Button from '@/components/shared_ui/button';
import './iframe-wrapper.scss';

type TPatientLoad = {
    /** Whether the frame's tab is on screen. Only that time counts towards the limit. */
    isVisible: boolean;
    loadingText: string;
    failedText: string;
    retryText: string;
};

type TIframeWrapperProps = {
    src: string;
    title: string;
    className?: string;
    // Lets the caller talk to the framed page (postMessage) - optional
    frameRef?: React.Ref<HTMLIFrameElement>;
    fallbackMessage?: string;
    // Optional iframe sandbox (omitted = no sandbox, as for TradingView)
    sandbox?: string;
    // Called when the framed page has loaded - optional
    onLoad?: () => void;
    // For a heavy page on a slow connection: shows a loading state, allows
    // PATIENT_LOAD_TIMEOUT_MS of on-screen time, keeps the frame loading even
    // past that, and offers "try again" instead of the link - optional
    patientLoad?: TPatientLoad;
};

type TLoadStatus = 'loading' | 'loaded' | 'failed';

// If the iframe hasn't fired onLoad within this window (or fires onError),
// we swap it for a plain fallback link instead of leaving a blank rectangle.
const LOAD_TIMEOUT_MS = 15000;
// charts.deriv.com measured from a cold cache: load at 8-10 s on a fast line,
// 14 s on slow 4G, 43 s on weak 3G - on a desktop CPU, so longer on a phone.
export const PATIENT_LOAD_TIMEOUT_MS = 60000;

const isPageVisible = () => document.visibilityState !== 'hidden';

/**
 * Generic third-party iframe embed with a built-in load-failure fallback.
 * Not specific to any one embedded page (TradingView, DTrader, ...) - callers
 * supply src/title.
 */
const IframeWrapper = ({
    src,
    title,
    className,
    frameRef,
    fallbackMessage = 'Charts are temporarily unavailable',
    sandbox,
    onLoad,
    patientLoad,
}: TIframeWrapperProps) => {
    const is_patient = !!patientLoad;
    const limit_ms = is_patient ? PATIENT_LOAD_TIMEOUT_MS : LOAD_TIMEOUT_MS;

    const [status, setStatus] = useState<TLoadStatus>('loading');
    const [attempt, setAttempt] = useState(0);
    const [is_page_visible, setIsPageVisible] = useState(isPageVisible);
    const remaining_ms_ref = useRef(limit_ms);
    const attempt_ref = useRef(attempt);
    attempt_ref.current = attempt;

    useEffect(() => {
        if (!is_patient) return undefined;
        const onVisibilityChange = () => setIsPageVisible(isPageVisible());
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, [is_patient]);

    // Every new load starts with the full allowance.
    useEffect(() => {
        remaining_ms_ref.current = limit_ms;
        setStatus('loading');
    }, [src, attempt, limit_ms]);

    // The countdown pauses, keeping what's left, whenever nobody can see the
    // frame: a hidden tab or a phone with the browser in the background says
    // nothing about whether the page can load.
    const is_counting = status === 'loading' && (!patientLoad || (patientLoad.isVisible && is_page_visible));

    useEffect(() => {
        if (!is_counting) return undefined;
        const started_at = Date.now();
        const timeout_id = setTimeout(() => setStatus('failed'), remaining_ms_ref.current);
        return () => {
            clearTimeout(timeout_id);
            remaining_ms_ref.current -= Date.now() - started_at;
        };
    }, [is_counting, src, attempt]);

    const handleLoad = () => {
        setStatus('loaded');
        onLoad?.();
        // A frame that can't reach its server still fires load, for the
        // browser's own error page, and a cross-origin frame can't be looked
        // into. This request fails in exactly that case (offline, DNS, dropped
        // connection), and only then: no-cors never fails on the response.
        if (!is_patient) return;
        const loaded_attempt = attempt;
        fetch(src, { mode: 'no-cors', cache: 'no-store' }).catch(() => {
            if (attempt_ref.current === loaded_attempt) setStatus('failed');
        });
    };

    const handleError = () => {
        setStatus('failed');
    };

    if (status === 'failed' && !patientLoad) {
        return (
            <div className={classNames('iframe-wrapper', 'iframe-wrapper--fallback', className)}>
                <p className='iframe-wrapper__fallback-message'>{fallbackMessage}</p>
                <a className='iframe-wrapper__fallback-link' href={src} target='_blank' rel='noopener noreferrer'>
                    {src}
                </a>
            </div>
        );
    }

    return (
        <div className={classNames('iframe-wrapper', className)}>
            {/* Stays in place past the time limit: removing it would end a load
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
            {patientLoad && status === 'loading' && (
                <div className='iframe-wrapper__status' role='status' aria-live='polite'>
                    <span className='iframe-wrapper__spinner' aria-hidden='true' />
                    <span className='iframe-wrapper__status-text'>{patientLoad.loadingText}</span>
                </div>
            )}
            {patientLoad && status === 'failed' && (
                <div className='iframe-wrapper__status iframe-wrapper__status--failed' role='alert'>
                    <p className='iframe-wrapper__status-text'>{patientLoad.failedText}</p>
                    <Button primary has_effect onClick={() => setAttempt(current => current + 1)}>
                        {patientLoad.retryText}
                    </Button>
                </div>
            )}
        </div>
    );
};

export default IframeWrapper;
