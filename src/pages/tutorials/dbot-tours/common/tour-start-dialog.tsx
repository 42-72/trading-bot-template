import React from 'react';
import { observer } from 'mobx-react-lite';
import Dialog from '@/components/shared_ui/dialog';
import Text from '@/components/shared_ui/text';
import { useStore } from '@/hooks/useStore';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import { getBotBuilderTourHeader, getTourDialogAction, getTourDialogInfo } from '../tour-content';
import { setTourSettings, tour_list } from '../utils';
import './tour-start-dialog.scss';

// Bot Builder's own tour dialog - the onboarding tour used this too (its
// content branched on active_tab === DASHBOARD), but that tour is gone, so
// this now only ever shows for active_tab === BOT_BUILDER.
const TourStartDialog = observer(() => {
    const { dashboard } = useStore();
    const { active_tab, is_tour_dialog_visible, setTourDialogVisibility, setActiveTour, setShowMobileTourDialog } =
        dashboard;
    const { isDesktop } = useDevice();
    const tour_token = 'bot_builder_token';
    const toggleTour = () => {
        if (!isDesktop) setShowMobileTourDialog(false);
        setTourDialogVisibility(false);
        setActiveTour('');
        setTourSettings(new Date().getTime(), tour_token);
    };

    const tour_dialog_info = getTourDialogInfo(!isDesktop);
    const tour_dialog_action = getTourDialogAction(!isDesktop);
    const [is_tour_open, setIsTourOpen] = React.useState(false);

    React.useEffect(() => {
        if (is_tour_dialog_visible) {
            setIsTourOpen(true);
        } else {
            setIsTourOpen(false);
        }
    }, [is_tour_dialog_visible]);

    const getTourContent = () => {
        return (
            <>
                <div className='dc-dialog__content__description__text'>{tour_dialog_info}</div>
                {tour_dialog_action && (
                    <div className='dc-dialog__content__description__text'>{tour_dialog_action}</div>
                )}
                <div className='dc-dialog__content__description__text'>
                    <Localize
                        key={0}
                        i18n_default_text={'Note: You can find this tutorial in the <0>Tutorials</0> tab.'}
                        components={[<strong key={0} />]}
                    />
                </div>
            </>
        );
    };

    const onHandleConfirm = () => {
        setActiveTour(tour_list[active_tab]);
        if (!isDesktop) setShowMobileTourDialog(false);
        setTourDialogVisibility(false);
        setTourSettings(new Date().getTime(), tour_token);
    };
    const header_text_size = isDesktop ? 's' : 'xs';
    const content_text_size = isDesktop ? 'xs' : 'xxs';

    const tour_headers = getBotBuilderTourHeader(!isDesktop);
    return (
        <div>
            <Dialog
                is_visible={is_tour_open}
                cancel_button_text={localize('Skip')}
                onCancel={() => toggleTour()}
                confirm_button_text={localize('Start')}
                onConfirm={onHandleConfirm}
                is_mobile_full_width
                className={'dc-dialog tour-dialog'}
                has_close_icon={false}
                portal_element_id='modal_root'
            >
                <div className='dc-dialog__content__header'>
                    <Text weight='bold' color='prominent' size={header_text_size}>
                        {tour_headers}
                    </Text>
                </div>
                <div className='dc-dialog__content__description'>
                    <Text size={content_text_size} color='prominent'>
                        {getTourContent()}
                    </Text>
                </div>
            </Dialog>
        </div>
    );
});

export default TourStartDialog;
