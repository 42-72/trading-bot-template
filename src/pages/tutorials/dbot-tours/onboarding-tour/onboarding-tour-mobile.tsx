import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import ProgressBarTracker from '@/components/shared_ui/progress-bar-tracker';
import Text from '@/components/shared_ui/text';
import { useStore } from '@/hooks/useStore';
import { getSetting } from '@/utils/settings';
import { LegacyClose1pxIcon } from '@deriv/quill-icons/Legacy';
import { localize } from '@deriv-com/translations';
import TourButton from '../common/tour-button';
import { DBOT_ONBOARDING_MOBILE, TMobileTourConfig } from '../tour-content';

const default_tour_data = {
    content: [],
    header: '',
    img: '',
    tour_step_key: 1,
};

type TTourData = TMobileTourConfig & {
    img: string;
    tour_step_key: number;
};

// TEMPORARY DIAGNOSTIC - not a fix. Gated behind ?tourdebug=1 so it never
// shows for real users; remove this whole block once the real-device
// measurement it's for has been taken. Read via document.querySelector
// rather than refs so it can find the slider/button regardless of exactly
// where in the tree they render, and so it still shows something (n/a)
// before the tour has mounted at all.
const isTourDebugEnabled = () => {
    if (typeof window === 'undefined') return false;
    try {
        return new URLSearchParams(window.location.search).get('tourdebug') === '1';
    } catch {
        return false;
    }
};

const TourDebugOverlay = () => {
    const [lines, setLines] = React.useState<string[]>([]);
    const probe_ref = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const read = () => {
            const slider = document.querySelector('.dbot-slider') as HTMLElement | null;
            const start_btn = document.querySelector('[data-testid="next-onboard-tour"]') as HTMLElement | null;
            const vv = window.visualViewport;
            const slider_rect = slider?.getBoundingClientRect();
            const btn_rect = start_btn?.getBoundingClientRect();
            const slider_css = slider ? getComputedStyle(slider) : null;
            const safe_area_bottom = probe_ref.current ? getComputedStyle(probe_ref.current).paddingBottom : 'n/a';

            const fmt = (n?: number) => (n === undefined ? 'n/a' : n.toFixed(1));

            setLines([
                `win.innerHeight: ${window.innerHeight}`,
                `doc.clientHeight: ${document.documentElement.clientHeight}`,
                `vv.height: ${vv ? fmt(vv.height) : 'n/a'}`,
                `vv.offsetTop: ${vv ? fmt(vv.offsetTop) : 'n/a'}`,
                `screen.height: ${window.screen.height}`,
                `dpr: ${window.devicePixelRatio}`,
                `slider.top: ${fmt(slider_rect?.top)}`,
                `slider.bottom: ${fmt(slider_rect?.bottom)}`,
                `slider.height: ${fmt(slider_rect?.height)}`,
                `startBtn.top: ${fmt(btn_rect?.top)}`,
                `startBtn.bottom: ${fmt(btn_rect?.bottom)}`,
                `slider.css.height: ${slider_css?.height ?? 'n/a'}`,
                `slider.css.minHeight: ${slider_css?.minHeight ?? 'n/a'}`,
                `slider.css.bottom: ${slider_css?.bottom ?? 'n/a'}`,
                `slider.css.paddingBottom: ${slider_css?.paddingBottom ?? 'n/a'}`,
                `safeAreaBottom: ${safe_area_bottom}`,
            ]);
        };

        read();
        const interval_id = setInterval(read, 500);
        return () => clearInterval(interval_id);
    }, []);

    return (
        <>
            {/* Invisible probe purely to read env(safe-area-inset-bottom) back out as a computed pixel value. */}
            <div
                ref={probe_ref}
                style={{
                    position: 'fixed',
                    bottom: 0,
                    left: 0,
                    width: 0,
                    height: 0,
                    paddingBottom: 'env(safe-area-inset-bottom)',
                    pointerEvents: 'none',
                    visibility: 'hidden',
                }}
            />
            <div
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    zIndex: 99999,
                    background: '#000',
                    color: '#fff',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    padding: '6px',
                    pointerEvents: 'none',
                    whiteSpace: 'pre',
                    lineHeight: 1.4,
                }}
                data-testid='tour-debug-overlay'
            >
                {lines.join('\n')}
            </div>
        </>
    );
};

const OnboardingTourMobile = observer(() => {
    const { dashboard } = useStore();
    const { onCloseTour, onTourEnd, setTourActiveStep, active_tour, active_tab, setActiveTour } = dashboard;
    const [tour_step, setStep] = React.useState<number>(1);
    const [tour_data, setTourData] = React.useState<TTourData>(default_tour_data);
    const { content, header, img, media, tour_step_key } = tour_data;
    const start_button = tour_step === 1 ? localize('Start') : localize('Next');
    const tour_button_text = tour_step === 8 ? localize('Got it, thanks!') : start_button;
    const test_id = tour_step_key === 8 ? 'finish-onboard-tour' : 'next-onboard-tour';
    const hide_prev_button = [1, 2, 8];
    const is_tour_active = active_tour === 'onboarding';
    const is_tour_debug = isTourDebugEnabled();

    React.useEffect(() => {
        DBOT_ONBOARDING_MOBILE.forEach(data => {
            if (data.tour_step_key === tour_step) {
                setTourData(data);
            }
            setTourActiveStep(tour_step);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tour_step]);

    React.useEffect(() => {
        const checkTokenForTour = () => {
            const token = getSetting('onboard_tour_token');
            if (!token && active_tab === 0) {
                setActiveTour('onboarding');
            }
        };
        checkTokenForTour();
    }, [active_tab, active_tour]);

    if (!active_tour) {
        return is_tour_debug ? <TourDebugOverlay /> : null;
    }

    return (
        <>
            {is_tour_debug && <TourDebugOverlay />}
            <div
                className={classNames('dbot-slider', {
                    'dbot-slider--active': tour_step === 1,
                    'dbot-slider--tour-position': tour_step !== 1,
                })}
                data-testid='onboarding-tour-mobile'
            >
            {tour_step_key !== 1 && (
                <div className='dbot-slider__navbar'>
                    <Text
                        color='less-prominent'
                        weight='less-prominent'
                        lineHeight='s'
                        size='xxs'
                        data-testid='dbot-onboard-slider__navbar'
                    >{`${tour_step_key - 1}/7`}</Text>
                    <span onClick={onCloseTour}>
                        <LegacyClose1pxIcon
                            height='20px'
                            width='20px'
                            data-testid='exit-onboard-tour'
                            className='db-contract-card__result-icon'
                            color='secondary'
                        />
                    </span>
                </div>
            )}
            {header && (
                <Text
                    color='prominent'
                    weight='bold'
                    align='center'
                    className='dbot-slider__title'
                    as='span'
                    lineHeight='s'
                    size='xs'
                >
                    {localize(header)}
                </Text>
            )}
            {media && (
                <div className='dbot-slider__media'>
                    <video
                        autoPlay={true}
                        loop
                        controls
                        preload='auto'
                        playsInline
                        disablePictureInPicture
                        controlsList='nodownload'
                        src={media}
                    />
                </div>
            )}
            {img && (
                <div className='dbot-slider__image'>
                    <img src={img} />
                </div>
            )}

            {content && (
                <>
                    {content.map(data => {
                        return (
                            <Text
                                key={data}
                                align='center'
                                color='prominent'
                                className='dbot-slider__content'
                                as='div'
                                lineHeight='s'
                                size='xxs'
                            >
                                {data}
                            </Text>
                        );
                    })}
                </>
            )}
            <div className='dbot-slider__status'>
                <div className='dbot-slider__progress-bar'>
                    <ProgressBarTracker
                        step={tour_step}
                        steps_list={DBOT_ONBOARDING_MOBILE.map(v => v.tour_step_key.toString())}
                        onStepChange={setStep}
                    />
                </div>
                <div className='dbot-slider__button-group'>
                    {tour_step === 1 && (
                        <TourButton
                            onClick={() => {
                                onCloseTour();
                            }}
                            label={localize('Skip')}
                            data-testid='skip-onboard-tour'
                        />
                    )}
                    {!hide_prev_button.includes(tour_step) && (
                        <TourButton
                            onClick={() => {
                                setStep(tour_step - 1);
                            }}
                            label={localize('Previous')}
                            data-testid='prev-onboard-tour'
                        />
                    )}
                    <TourButton
                        type='danger'
                        onClick={() => {
                            setStep(tour_step + 1);
                            onTourEnd(tour_step, is_tour_active);
                        }}
                        label={tour_button_text}
                        data-testid={test_id}
                    />
                </div>
            </div>
            </div>
        </>
    );
});

export default OnboardingTourMobile;
