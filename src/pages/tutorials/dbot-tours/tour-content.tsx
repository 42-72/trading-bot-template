import React from 'react';
import { isDbotRTL } from '@/external/bot-skeleton/utils/workspace';
import { LabelPairedCircleCheckMdFillIcon } from '@deriv/quill-icons/LabelPaired';
import { Localize, localize } from '@deriv-com/translations';

type TJoyrideConfig = Record<
    'showProgress' | 'spotlightClicks' | 'disableBeacon' | 'disableOverlay' | 'disableCloseOnEsc',
    boolean
> & {
    placement?: 'bottom' | 'top' | 'left' | 'right';
};

const joyride_props: TJoyrideConfig = {
    showProgress: false,
    spotlightClicks: false,
    disableBeacon: true,
    disableOverlay: true,
    disableCloseOnEsc: true,
};

const Step1 = ({ show_label = false }) => (
    <div className='joyride-content'>
        {show_label && (
            <div className='joyride-content__left'>
                <Localize i18n_default_text='Step 1 :' />
            </div>
        )}
        <div className='joyride-content__left'>
            <Localize
                i18n_default_text={'First, set the <0>Trade parameters</0> block.'}
                components={[<strong key={0} />]}
            />
        </div>
        <div className='joyride-content__left joyride-content__sub-title'>
            <Localize i18n_default_text='<0>1. Trade parameters:<0>' components={[<strong key={0} />]} />
        </div>
        <div className='joyride-content__left'>
            <ul>
                <li>
                    <Localize
                        i18n_default_text='First, set <0>Market</0> to Derived > Continuous Indices > Volatility 100 (1s) Index.'
                        components={[<strong key={0} />]}
                    />
                </li>
                <li>
                    <Localize
                        i18n_default_text='Then, set <0>Trade type</0> to Up/Down > Rise/Fall.'
                        components={[<strong key={0} />]}
                    />
                </li>
                <li>
                    <Localize
                        i18n_default_text='For <0>Contract type,</0> set it to Both.'
                        components={[<strong key={0} />]}
                    />
                </li>
                <li>
                    <Localize
                        i18n_default_text='For <0>Default candle interval,</0> set it to 1 minute'
                        components={[<strong key={0} />]}
                    />
                </li>
            </ul>
        </div>
    </div>
);

const Step1A = () => (
    <div className='joyride-content'>
        <div className='joyride-content__left'>
            <Localize
                i18n_default_text='For <0>Trade options</0>, set it as below:'
                components={[<strong key={0} />]}
            />
        </div>
        <div className='joyride-content__left'>
            <ul>
                <li>
                    <Localize i18n_default_text='<0>Duration</0>: Ticks 1' components={[<strong key={0} />]} />
                </li>
                <li>
                    <Localize
                        i18n_default_text='<0>Stake: USD</0> 10 (min: 0.35 - max: 50000)'
                        components={[<strong key={0} />]}
                    />
                </li>
            </ul>
        </div>
    </div>
);

const Step2 = ({ show_label = false }) => (
    <div className='joyride-content'>
        {show_label && (
            <div className='joyride-content__left'>
                <Localize i18n_default_text='Step 2 :' />
            </div>
        )}

        <div className='joyride-content__left'>
            <Localize
                i18n_default_text='Then, set the <0>Purchase conditions</0> block.'
                components={[<strong key={0} />]}
            />
        </div>
        <div className='joyride-content__left joyride-content__sub-title'>
            <Localize i18n_default_text='<0>2. Purchase conditions</0>:' components={[<strong key={0} />]} />
        </div>
        <div className='joyride-content__left'>
            <ul>
                <li>
                    <Localize i18n_default_text='<0>Purchase</0>: Rise' components={[<strong key={0} />]} />
                </li>
            </ul>
        </div>
    </div>
);

const Step3 = ({ show_label = false }) => (
    <div className='joyride-content'>
        {show_label && (
            <div className='joyride-content__left joyride-content__left__step-three'>
                <Localize i18n_default_text='Step 3 :' />
            </div>
        )}

        <div className='joyride-content__left'>
            <Localize
                i18n_default_text='The third block is <0>optional</0>. You may use this block if you want to sell your contract before it expires. For now, leave the block as it is. '
                components={[<strong key={0} />]}
            />
        </div>
    </div>
);

const Step4 = ({ show_label = false }) => (
    <div className='joyride-content'>
        {show_label && (
            <div className='joyride-content__left'>
                <Localize i18n_default_text='Step 4 :' />
            </div>
        )}

        <div className='joyride-content__left'>
            <Localize
                i18n_default_text='Next, go to <0>Utility tab</0> under the Blocks menu. Tap the drop-down arrow and hit <0>Loops</0>.'
                components={[<strong key={0} />]}
            />
        </div>
        <div className='joyride-content__left'>
            <ul>
                <li>
                    <Localize
                        i18n_default_text='Look for the <0>Repeat While/Until</0>, and click the + icon to add the block to the workspace area.'
                        components={[<strong key={0} />]}
                    />
                </li>
                <li>
                    <Localize
                        i18n_default_text='Choose <0>until</0> as the repeat option.'
                        components={[<strong key={0} />]}
                    />
                </li>
            </ul>
            <div className='joyride-content__left joyride-content__with-icon'>
                <div className='joyride-content__with-icon__left'>
                    <LabelPairedCircleCheckMdFillIcon className='db-contract-card__result-icon' fill='#4bb4b3' />
                </div>
                <div className='joyride-content__with-icon__right'>
                    <Localize
                        i18n_default_text='Pro tip: You can also click and drag out the desired block'
                        components={[<strong key={0} />]}
                    />
                </div>
            </div>
        </div>
        <div>
            <video autoPlay loop controls playsInline preload='auto' disablePictureInPicture controlsList='nodownload'>
                <source src={'/assets/videos/bot-builder-tour-step-4.mp4'} type='video/mp4' />
            </video>
        </div>
    </div>
);

const Step5 = ({ show_label = false }) => (
    <div className='joyride-content'>
        {show_label && (
            <div className='joyride-content__left'>
                <Localize i18n_default_text='Step 5 :' />
            </div>
        )}

        <div className='joyride-content__left'>
            <Localize
                i18n_default_text='Now, tap the <0>Analysis</0> drop-down arrow and hit <0>Contract</0>.'
                components={[<strong key={0} />]}
            />
        </div>
        <div className='joyride-content__left'>
            <ul>
                <li>
                    <Localize
                        i18n_default_text='Go to the <0>Last trade result</0> block and click + icon to add the <0>Result is Win</0> block to the workspace.'
                        components={[<strong key={0} />]}
                    />
                </li>
                <li>
                    <Localize
                        i18n_default_text='Then, drag the <0>Result is win</0> into the empty slot next to <0>repeat until</0> block.'
                        components={[<strong key={0} />]}
                    />
                </li>
                <li>
                    <Localize
                        i18n_default_text='Now, go to the <0>Restart trading conditions</0> block.'
                        components={[<strong key={0} />]}
                    />
                </li>
                <li>
                    <Localize
                        i18n_default_text='Drag the <0>Trade again</0> block and add it into the <0>do</0> part of the <0>Repeat until</0> block.'
                        components={[<strong key={0} />]}
                    />
                </li>
            </ul>
        </div>
        <div>
            <video autoPlay loop controls playsInline preload='auto' disablePictureInPicture controlsList='nodownload'>
                <source src={'/assets/videos/bot-builder-tour-step-5.mp4'} type='video/mp4' />
            </video>
        </div>
    </div>
);

const Step6 = ({ show_label = false }) => (
    <div className='joyride-content'>
        {show_label && (
            <div className='joyride-content__left'>
                <Localize i18n_default_text='Step 6 :' />
            </div>
        )}

        <div className='joyride-content__left'>
            <Localize
                i18n_default_text='Finally, drag and add the whole <0>Repeat</0> block to the <0>Restart trading conditions</0> block.'
                components={[<strong key={0} />]}
            />
        </div>
    </div>
);

export const BOT_BUILDER_TOUR = [
    {
        target: '.animation__wrapper',
        content: <Step1 show_label />,
        placement: isDbotRTL() ? 'right' : 'left',
        ...joyride_props,
    },
    {
        target: '.animation__wrapper',
        content: <Step1A />,
        placement: isDbotRTL() ? 'right' : 'left',
        ...joyride_props,
    },
    {
        target: '.animation__wrapper',
        content: <Step2 show_label />,
        placement: isDbotRTL() ? 'right' : 'left',
        ...joyride_props,
    },
    {
        target: '.animation__wrapper',
        content: <Step3 show_label />,
        placement: isDbotRTL() ? 'right' : 'left',
        ...joyride_props,
    },
    {
        target: '.animation__wrapper',
        content: <Step4 show_label />,
        placement: isDbotRTL() ? 'right' : 'left',
        ...joyride_props,
    },
    {
        target: '.animation__wrapper',
        content: <Step5 show_label />,
        placement: isDbotRTL() ? 'right' : 'left',
        ...joyride_props,
    },
    {
        target: '.animation__wrapper',
        content: <Step6 show_label />,
        locale: { last: localize('Next') },
        ...joyride_props,
    },
];

export type TMobileTourConfig = {
    header: React.ReactElement;
    content: Array<React.ReactElement>;
    tour_step_key: number;
    img?: string;
    media?: string;
};

export const BOT_BUILDER_MOBILE: TMobileTourConfig[] = [
    {
        header: <Localize i18n_default_text='Step 1' />,
        content: [
            <span key='step-1-wrapper'>
                <Localize key='step-1' i18n_default_text='First, click the Import icon on the tool bar.' />
            </span>,
        ],
        tour_step_key: 1,
    },
    {
        header: <Localize i18n_default_text='Step 2' />,
        content: [
            <span key='step-2-wrapper'>
                <Localize
                    key='step-2'
                    i18n_default_text='Next, import your bot directly from your mobile device or from Google Drive.'
                />
            </span>,
        ],
        tour_step_key: 2,
    },
    {
        header: <Localize i18n_default_text='Step 3' />,
        content: [
            <span key='step-3-wrapper'>
                <Localize
                    key='step-3'
                    i18n_default_text='Once imported, you will see a preview of the bot on the workspace. Click run to start trading with this bot.'
                />
            </span>,
        ],
        tour_step_key: 3,
    },
];

export const getTourDialogInfo = (is_mobile: boolean) => {
    return is_mobile ? (
        <Localize
            key='tour-dialog-info-mobile'
            i18n_default_text='Here’s a quick guide on how to use Deriv Bot on the go.'
        />
    ) : (
        <Localize key='tour-dialog-info-desktop' i18n_default_text='Learn how to build a bot with a simple strategy.' />
    );
};

export const getTourDialogAction = (is_mobile: boolean) => {
    if (is_mobile) {
        return (
            <Localize
                key='tour-dialog-action-mobile'
                i18n_default_text='You can import a bot from your mobile device or from Google drive, see a preview in the bot builder, and start trading by running the bot.'
            />
        );
    }
    return '';
};

export const getBotBuilderTourHeader = (is_mobile: boolean) => {
    if (is_mobile) {
        return <Localize key='tour_header-mobile' i18n_default_text='Bot Builder guide' />;
    }
    return <Localize key='tour_header-desktop' i18n_default_text="Let's build a Bot!" />;
};
