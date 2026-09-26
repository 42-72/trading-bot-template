import React from 'react';
import classNames from 'classnames';
import Dialog from '@/components/shared_ui/dialog';
import Text from '@/components/shared_ui/text';
import { useStore } from '@/hooks/useStore';
import { LegacyPlay1pxIcon } from '@deriv/quill-icons/Legacy';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
/* [AI] - Analytics event tracking removed - see migrate-docs/MONITORING_PACKAGES.md for re-implementation guide */
/* [/AI] */

type TGuideList = {
    content?: string;
    id: number;
    src?: string;
    subtype?: string;
    type: string;
    url?: string;
    imageclass?: string;
};

type TGuideContent = {
    guide_tab_content: TGuideList[];
    video_tab_content: TGuideList[];
    is_dialog_open: boolean;
};

// The "Step-by-step guides" section used to live here, driven by
// guide_tab_content (user_guide_content() in tutorials/constants.ts) -
// every entry in it launched one of the two tours, both now removed, so
// that data source is permanently empty and the section is gone with it.
// guide_tab_content stays as a prop (tutorials.tsx still passes it) so
// that file doesn't need touching, but it's otherwise unused here now.
const GuideContent = ({ guide_tab_content, video_tab_content, is_dialog_open }: TGuideContent) => {
    const { isDesktop } = useDevice();
    const { dashboard } = useStore();
    const { dialog_options, onCloseDialog: onOkButtonClick, showVideoDialog } = dashboard;

    const has_guide_content = guide_tab_content.length > 0 || video_tab_content.length > 0;

    return React.useMemo(
        () =>
            has_guide_content && (
                <div className='tutorials-wrap'>
                    {video_tab_content && video_tab_content.length > 0 && (
                        <div className='tutorials-wrap__group'>
                            <div className='tutorials-wrap__group__title'>
                                <Text
                                    align='left'
                                    weight='bold'
                                    color='prominent'
                                    lineHeight='s'
                                    size={isDesktop ? 's' : 'xs'}
                                >
                                    <Localize i18n_default_text='Videos on Deriv Bot' />
                                </Text>
                            </div>

                            <div className='tutorials-wrap__group__guides'>
                                {video_tab_content?.map(({ content, src, url, id }) => {
                                    return (
                                        <div className='tutorials-wrap__group__cards' key={id}>
                                            <div
                                                className={classNames('tutorials-wrap__placeholder', {
                                                    'tutorials-wrap__placeholder--disabled': !url,
                                                })}
                                                style={{
                                                    backgroundImage: `url(${src})`,
                                                }}
                                            >
                                                <div className='tutorials-wrap__placeholder__button-group'>
                                                    <LegacyPlay1pxIcon
                                                        className='tutorials-wrap__placeholder__button-group--play'
                                                        width='42px'
                                                        height='42px'
                                                        onClick={() => {
                                                            showVideoDialog({
                                                                type: 'url',
                                                                url,
                                                            });
                                                            /* [AI] - Analytics event tracking removed - see migrate-docs/MONITORING_PACKAGES.md for re-implementation guide */
                                                            /* [/AI] */
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                            <div className='tutorials-wrap__placeholder__description'>
                                                <Text
                                                    align='left'
                                                    color='prominent'
                                                    lineHeight='s'
                                                    size={isDesktop ? 's' : 'xs'}
                                                >
                                                    {content}
                                                </Text>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <Dialog
                        title={dialog_options.title}
                        is_visible={is_dialog_open}
                        cancel_button_text={localize('Cancel')}
                        onCancel={onOkButtonClick}
                        confirm_button_text={localize('OK')}
                        onConfirm={onOkButtonClick}
                        is_mobile_full_width
                        className={'dc-dialog'}
                        has_close_icon
                        onClose={onOkButtonClick}
                        login={() => {}}
                    >
                        <iframe width='100%' height='100%' src={dialog_options.url} frameBorder='0' allowFullScreen />
                    </Dialog>
                </div>
            ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [guide_tab_content, video_tab_content, is_dialog_open]
    );
};

export default GuideContent;
