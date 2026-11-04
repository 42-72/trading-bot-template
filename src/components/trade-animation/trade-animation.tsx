import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { LabelPairedPlayLgFillIcon, LabelPairedSquareLgFillIcon } from '@deriv/quill-icons/LabelPaired';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
/* [AI] - Analytics event tracking removed - see migrate-docs/MONITORING_PACKAGES.md for re-implementation guide */
/* [/AI] */
import Button from '../shared_ui/button';
import Tooltip from '../shared_ui/tooltip/tooltip';
import ExecutionModeSwitch from './execution-mode-switch';
import './run-panel-tooltip.scss';

type TTradeAnimation = {
    className?: string;
    /** Fixed side for the "no bot yet" tooltip, instead of working it out from the position. */
    tooltip_alignment?: 'top' | 'bottom' | 'left' | 'right';
};

/**
 * The Run bar: [ Run / Stop ][ Execution  NORMAL ◯ ]. No run-status text here -
 * the Run button turning into Stop, the summary card, Journal and Transactions
 * show how a run is going.
 */
const TradeAnimation = observer(({ className, tooltip_alignment }: TTradeAnimation) => {
    const { dashboard, run_panel, blockly_store } = useStore();
    const { active_tab } = dashboard;
    const { has_saved_bots } = blockly_store;
    const { isDesktop, isMobile } = useDevice();
    // The desktop bar never remounts, so it reads this fresh on every render
    // (each tab change); below 1280px it stays as it was.
    const has_active_bot = isDesktop ? blockly_store.hasWorkspaceBlocks() : blockly_store.has_active_bot;

    const { contract_stage, is_stop_button_visible, is_stop_button_disabled, onRunButtonClick, onStopBotClick } =
        run_panel;
    const [shouldDisable, setShouldDisable] = React.useState(false);
    const is_unavailable_for_payment_agent = false;

    // Get the load_modal store to monitor strategy deletions
    const { load_modal } = useStore();
    const { dashboard_strategies, is_delete_modal_open } = load_modal;

    // Track previous state of delete modal to detect when it closes
    const prevDeleteModalOpen = React.useRef(is_delete_modal_open);

    // Check for saved bots whenever the component renders or when strategies are deleted
    React.useEffect(() => {
        const checkBots = async () => {
            await blockly_store.checkForSavedBots();
        };
        checkBots();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dashboard_strategies, is_delete_modal_open, is_stop_button_visible]);

    // Force re-render when delete modal is closed (which happens after deletion)
    React.useEffect(() => {
        // If delete modal was open and is now closed, force a re-check
        if (prevDeleteModalOpen.current && !is_delete_modal_open) {
            const checkBotsAfterDelete = async () => {
                // Small delay to ensure the deletion has completed
                await new Promise(resolve => setTimeout(resolve, 100));
                await blockly_store.checkForSavedBots();
                // Force component to re-render
                if (!is_stop_button_visible) {
                    setShouldDisable(true);
                    setTimeout(() => setShouldDisable(false), 0);
                }
            };
            checkBotsAfterDelete();
        }
        // Update ref for next render
        prevDeleteModalOpen.current = is_delete_modal_open;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [is_delete_modal_open, is_stop_button_visible]);

    React.useEffect(() => {
        if (shouldDisable) {
            setTimeout(() => {
                setShouldDisable(false);
            }, 1000);
        }
    }, [shouldDisable, is_stop_button_visible]);

    // Check if there are no active or saved bots
    const has_no_bots = !has_active_bot && !has_saved_bots;
    const is_bot_builder_tab = active_tab === DBOT_TABS.BOT_BUILDER;

    // Bots aren't started from the Dashboard, loaded or not. Only Run: once a
    // bot or the AI Scanner is running, Stop works here as everywhere. A scanner
    // run starts through the store, not this button.
    const is_run_locked = active_tab === DBOT_TABS.DASHBOARD && !is_stop_button_visible;

    // Disable the RUN button if:
    // 1. There are no active or saved bots AND the user is not in the bot builder tab
    // 2. It's the Dashboard
    const should_disable_run = (has_no_bots && !is_bot_builder_tab) || is_run_locked;

    const is_disabled = is_stop_button_visible ? false : shouldDisable || should_disable_run;

    // Show the tooltip when:
    // 1. The user is NOT in the bot builder tab, AND
    // 2. There are no bots
    const should_show_tooltip = !is_stop_button_visible && !is_bot_builder_tab && has_no_bots;

    const button_props = React.useMemo(() => {
        if (is_stop_button_visible && !is_stop_button_disabled) {
            return {
                id: 'db-animation__stop-button',
                class: 'animation__stop-button',
                text: <Localize i18n_default_text='Stop' />,
                icon: <LabelPairedSquareLgFillIcon fill='#fff' />,
            };
        }
        return {
            id: 'db-animation__run-button',
            class: 'animation__run-button',
            text: <Localize i18n_default_text='Run' />,
            icon: <LabelPairedPlayLgFillIcon fill='#fff' />,
        };
    }, [is_stop_button_visible, is_stop_button_disabled]);

    // Function to determine tooltip alignment based on run panel position
    const determineTooltipAlignment = (): string => {
        if (tooltip_alignment) return tooltip_alignment;
        // Force tooltip to always appear on top for mobile devices
        if (isMobile) {
            return 'top';
        } else {
            // On desktop, determine based on run panel position
            try {
                const runPanelElement = document.querySelector('.run__button_wrapper');
                if (runPanelElement) {
                    const rect = runPanelElement.getBoundingClientRect();
                    // Ensure we have valid numbers for the comparison
                    const rectBottom = typeof rect.bottom === 'number' ? rect.bottom : 0;
                    const windowHeight = typeof window.innerHeight === 'number' ? window.innerHeight : 0;
                    const isNearBottom = rectBottom > windowHeight - 150; // 150px threshold from bottom

                    // If the run panel is near the bottom of the screen, show tooltip on top
                    // Otherwise, show it on the left
                    return isNearBottom ? 'top' : 'left';
                }
            } catch (error) {
                console.error('Error determining tooltip position:', error);
            }

            // Default to left if we can't determine position
            return 'left';
        }
    };

    return (
        <div className={classNames('animation__wrapper', className)}>
            {should_show_tooltip ? (
                <div className='run__button_wrapper'>
                    <Tooltip
                        alignment={determineTooltipAlignment()}
                        message={localize('The Run button is disabled because no Bot has been created yet.')}
                        icon='info'
                        className='qs__tooltip'
                    />
                    <div style={{ opacity: 0.5, marginLeft: '8px' }}>
                        <Button
                            is_disabled={true}
                            className={button_props.class}
                            id={button_props.id}
                            icon={button_props.icon}
                            onClick={() => {
                                // Disabled button, no action
                            }}
                            has_effect
                            {...(is_stop_button_visible || !is_unavailable_for_payment_agent
                                ? { primary: true }
                                : { green: true })}
                        >
                            {button_props.text}
                        </Button>
                    </div>
                </div>
            ) : (
                <Button
                    is_disabled={(is_disabled && !is_unavailable_for_payment_agent) || contract_stage === 3}
                    className={classNames(button_props.class, { 'animation__run-button--locked': is_run_locked })}
                    id={button_props.id}
                    icon={button_props.icon}
                    onClick={() => {
                        // Not only is_disabled: api-base's toggleRunButton sets
                        // the button's disabled attribute directly.
                        if (is_run_locked) return;
                        setShouldDisable(true);
                        if (is_stop_button_visible) {
                            onStopBotClick();
                            return;
                        }
                        onRunButtonClick();
                        /* [AI] - Analytics event tracking removed - see migrate-docs/MONITORING_PACKAGES.md for re-implementation guide */
                        /* [/AI] */
                    }}
                    has_effect
                    {...(is_stop_button_visible || !is_unavailable_for_payment_agent
                        ? { primary: true }
                        : { green: true })}
                >
                    {button_props.text}
                </Button>
            )}
            <ExecutionModeSwitch />
        </div>
    );
});

export default TradeAnimation;
