// TODO: Complete MobX integration for popup functionality
// Some code is kept commented out pending popup integration
import React from 'react';
import { observer } from 'mobx-react-lite';
import GoogleDrive from '@/components/load-modal/google-drive';
import Dialog from '@/components/shared_ui/dialog';
import MobileFullPageModal from '@/components/shared_ui/mobile-full-page-modal';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import {
    DerivLightBotBuilderIcon,
    DerivLightGoogleDriveIcon,
    DerivLightLocalDeviceIcon,
    DerivLightMyComputerIcon,
    DerivLightQuickStrategyIcon,
} from '@deriv/quill-icons/Illustration';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
/* [AI] - Analytics event tracking removed - see migrate-docs/MONITORING_PACKAGES.md for re-implementation guide */
/* [/AI] */

type TCardProps = {
    is_mobile: boolean;
};

type TCard = {
    id: string;
    icon: React.ReactElement;
    title: React.ReactElement;
    description: React.ReactElement;
    // No callback: the card is shown but can't be pressed.
    callback?: () => void;
};

const Cards = observer(({ is_mobile }: TCardProps) => {
    const { dashboard, load_modal, quick_strategy } = useStore();
    const { toggleLoadModal, setActiveTabIndex } = load_modal;
    const { isDesktop } = useDevice();
    const { onCloseDialog, dialog_options, is_dialog_open, setActiveTab, setPreviewOnPopup } = dashboard;
    const { setFormVisibility } = quick_strategy;

    const openFileLoader = () => {
        toggleLoadModal();
        setActiveTabIndex(is_mobile ? 0 : 1);
        setActiveTab(DBOT_TABS.BOT_BUILDER);
    };

    const cards: TCard[] = [
        {
            id: 'my-computer',
            icon: is_mobile ? <DerivLightLocalDeviceIcon /> : <DerivLightMyComputerIcon />,
            title: <Localize i18n_default_text='My computer' />,
            description: <Localize i18n_default_text='Load a bot file (XML) from your device' />,
            callback: openFileLoader,
        },
        {
            id: 'google-drive',
            icon: <DerivLightGoogleDriveIcon />,
            title: <Localize i18n_default_text='Google Drive' />,
            description: <Localize i18n_default_text='Import bots from your Google Drive' />,
        },
        {
            id: 'bot-builder',
            icon: <DerivLightBotBuilderIcon />,
            title: <Localize i18n_default_text='Bot Builder' />,
            description: <Localize i18n_default_text='Build your own bot with blocks' />,
            callback: () => setActiveTab(DBOT_TABS.BOT_BUILDER),
        },
        {
            id: 'quick-strategy',
            icon: <DerivLightQuickStrategyIcon />,
            title: <Localize i18n_default_text='Quick strategy' />,
            description: <Localize i18n_default_text='Start fast with a ready-made strategy' />,
            callback: () => {
                setActiveTab(DBOT_TABS.BOT_BUILDER);
                setFormVisibility(true);
            },
        },
    ];

    return (
        <div className='dashboard-cards' id='tab__dashboard__table__tiles'>
            {cards.map(({ id, icon, title, description, callback }) => {
                const class_name = `dashboard-card dashboard-card--${id}`;
                const content = (
                    <React.Fragment>
                        <span className='dashboard-card__icon'>{icon}</span>
                        <span className='dashboard-card__title'>{title}</span>
                        <span className='dashboard-card__description'>{description}</span>
                    </React.Fragment>
                );

                if (!callback) {
                    return (
                        <div key={id} id={id} className={`${class_name} dashboard-card--unavailable`}>
                            {content}
                        </div>
                    );
                }

                return (
                    <button key={id} id={id} type='button' className={class_name} onClick={callback}>
                        <span className='dashboard-card__arrow' aria-hidden='true'>
                            <svg viewBox='0 0 24 24' width='16' height='16'>
                                <path d='M7 17 17 7M8 7h9v9' />
                            </svg>
                        </span>
                        {content}
                        <span className='dashboard-card__open'>
                            <Localize i18n_default_text='Open' /> <span aria-hidden='true'>→</span>
                        </span>
                    </button>
                );
            })}

            {!isDesktop ? (
                <Dialog
                    title={dialog_options.title}
                    is_visible={is_dialog_open}
                    onCancel={onCloseDialog}
                    is_mobile_full_width
                    className='dc-dialog__wrapper--google-drive'
                    has_close_icon
                >
                    <GoogleDrive />
                </Dialog>
            ) : (
                <MobileFullPageModal
                    is_modal_open={is_dialog_open}
                    className='load-strategy__wrapper'
                    header={localize('Load strategy')}
                    onClickClose={() => {
                        setPreviewOnPopup(false);
                        onCloseDialog();
                    }}
                    height_offset='80px'
                >
                    <div label='Google Drive' className='google-drive-label'>
                        <GoogleDrive />
                    </div>
                </MobileFullPageModal>
            )}
        </div>
    );
});

export default Cards;
