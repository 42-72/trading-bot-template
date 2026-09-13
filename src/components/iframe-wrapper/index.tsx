import React, { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import './iframe-wrapper.scss';

type TIframeWrapperProps = {
    src: string;
    title: string;
    className?: string;
};

// If the iframe hasn't fired onLoad within this window (or fires onError),
// we swap it for a plain fallback link instead of leaving a blank rectangle.
const LOAD_TIMEOUT_MS = 15000;

/**
 * Generic third-party iframe embed with a built-in load-failure fallback.
 * Not specific to any one embedded page (TradingView, DTrader, ...) - callers
 * supply src/title.
 */
const IframeWrapper = ({ src, title, className }: TIframeWrapperProps) => {
    const [has_failed, setHasFailed] = useState(false);
    const has_loaded_ref = useRef(false);

    useEffect(() => {
        has_loaded_ref.current = false;
        setHasFailed(false);

        const timeout_id = setTimeout(() => {
            if (!has_loaded_ref.current) {
                setHasFailed(true);
            }
        }, LOAD_TIMEOUT_MS);

        return () => clearTimeout(timeout_id);
    }, [src]);

    const handleLoad = () => {
        has_loaded_ref.current = true;
    };

    const handleError = () => {
        setHasFailed(true);
    };

    if (has_failed) {
        return (
            <div className={classNames('iframe-wrapper', 'iframe-wrapper--fallback', className)}>
                <p className='iframe-wrapper__fallback-message'>Charts are temporarily unavailable</p>
                <a
                    className='iframe-wrapper__fallback-link'
                    href={src}
                    target='_blank'
                    rel='noopener noreferrer'
                >
                    {src}
                </a>
            </div>
        );
    }

    return (
        <div className={classNames('iframe-wrapper', className)}>
            <iframe
                src={src}
                title={title}
                className='iframe-wrapper__frame'
                frameBorder='0'
                allowFullScreen
                loading='eager'
                referrerPolicy='no-referrer-when-downgrade'
                allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; display-capture'
                onLoad={handleLoad}
                onError={handleError}
            />
        </div>
    );
};

export default IframeWrapper;
