import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import Journal from '@/components/journal';
import Button from '@/components/shared_ui/button';
import Drawer from '@/components/shared_ui/drawer';
import Modal from '@/components/shared_ui/modal';
import Money from '@/components/shared_ui/money';
import Tabs from '@/components/shared_ui/tabs';
import Text from '@/components/shared_ui/text';
import Summary from '@/components/summary';
import TradeAnimation from '@/components/trade-animation';
import Transactions from '@/components/transactions';
import { DBOT_TABS, PHONE_FULL_HEIGHT_TABS, RUN_BAR_HIDDEN_TABS } from '@/constants/bot-contents';
import { popover_zindex } from '@/constants/z-indexes';
import { useIsPhone } from '@/hooks/useIsPhone';
import { useStore } from '@/hooks/useStore';
import { isBotOrScannerRunning } from '@/utils/run-activity';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import ThemedScrollbars from '../shared_ui/themed-scrollbars';
import SlimStopBar from './slim-stop-bar';

type TStatisticsTile = {
    content: React.ElementType | string;
    contentClassName: string;
    title: string;
};

type TStatisticsSummary = {
    currency: string;
    is_mobile: boolean;
    lost_contracts: number;
    number_of_runs: number;
    total_stake: number;
    total_payout: number;
    toggleStatisticsInfoModal: () => void;
    total_profit: number;
    won_contracts: number;
};
type TDrawerHeader = {
    is_clear_stat_disabled: boolean;
    is_mobile: boolean;
    is_drawer_open: boolean;
    onClearStatClick: () => void;
};

type TDrawerContent = {
    active_index: number;
    is_drawer_open: boolean;
    active_tour: string;
    setActiveTabIndex: () => void;
};

type TDrawerFooter = {
    is_clear_stat_disabled: boolean;
    onClearStatClick: () => void;
};

type TStatisticsInfoModal = {
    is_mobile: boolean;
    is_statistics_info_modal_open: boolean;
    toggleStatisticsInfoModal: () => void;
};

const StatisticsTile = ({ content, contentClassName, title }: TStatisticsTile) => (
    <div className='run-panel__tile'>
        <div className='run-panel__tile-title'>{title}</div>
        <div className={classNames('run-panel__tile-content', contentClassName)}>{content}</div>
    </div>
);

export const StatisticsSummary = ({
    currency,
    is_mobile,
    lost_contracts,
    number_of_runs,
    total_stake,
    total_payout,
    toggleStatisticsInfoModal,
    total_profit,
    won_contracts,
}: TStatisticsSummary) => (
    <div
        className={classNames('run-panel__stat', {
            'run-panel__stat--mobile': is_mobile,
        })}
    >
        <div className='run-panel__stat--info' onClick={toggleStatisticsInfoModal}>
            <div className='run-panel__stat--info-item'>
                <Localize i18n_default_text="What's this?" />
            </div>
        </div>
        <div className='run-panel__stat--tiles'>
            <StatisticsTile
                title={localize('Total stake')}
                alignment='top'
                content={<Money amount={total_stake} currency={currency} show_currency />}
            />
            <StatisticsTile
                title={localize('Total payout')}
                alignment='top'
                content={<Money amount={total_payout} currency={currency} show_currency />}
            />
            <StatisticsTile title={localize('No. of runs')} alignment='top' content={number_of_runs} />
            <StatisticsTile title={localize('Contracts lost')} alignment='bottom' content={lost_contracts} />
            <StatisticsTile title={localize('Contracts won')} alignment='bottom' content={won_contracts} />
            <StatisticsTile
                title={localize('Total profit/loss')}
                content={<Money amount={total_profit} currency={currency} has_sign show_currency />}
                alignment='bottom'
                contentClassName={classNames('run-panel__stat-amount', {
                    'run-panel__stat-amount--positive': total_profit > 0,
                    'run-panel__stat-amount--negative': total_profit < 0,
                })}
            />
        </div>
    </div>
);

const DrawerHeader = ({ is_clear_stat_disabled, is_mobile, is_drawer_open, onClearStatClick }: TDrawerHeader) =>
    is_mobile &&
    is_drawer_open && (
        <Button
            id='db-run-panel__clear-button'
            className='run-panel__clear-button'
            disabled={is_clear_stat_disabled}
            text={localize('Reset')}
            onClick={onClearStatClick}
            secondary
        />
    );

const DrawerContent = ({ active_index, is_drawer_open, active_tour, setActiveTabIndex, ...props }: TDrawerContent) => {
    const { isDesktop } = useDevice();
    // No body overflow lock while the drawer is open on mobile: the page itself never
    // scrolls (.layout is exactly 100svh), and body overflow: hidden switched off the
    // phone's pull-to-refresh whenever the drawer was open (its default state).

    const tabs = (
        <Tabs active_index={active_index} onTabItemClick={setActiveTabIndex} top>
            <div id='db-run-panel-tab__summary' label={<Localize i18n_default_text='Summary' />}>
                <Summary is_drawer_open={is_drawer_open} />
            </div>
            <div id='db-run-panel-tab__transactions' label={<Localize i18n_default_text='Transactions' />}>
                <Transactions is_drawer_open={is_drawer_open} />
            </div>
            <div id='db-run-panel-tab__journal' label={<Localize i18n_default_text='Journal' />}>
                <Journal />
            </div>
        </Tabs>
    );
    const stats = ((is_drawer_open && active_index !== 2) || active_tour) && <StatisticsSummary {...props} />;

    // Mobile DOM is unchanged - Run lives in .controls__section there.
    if (!isDesktop) {
        return (
            <>
                {tabs}
                {stats}
            </>
        );
    }

    // Desktop: scrollable tabs and stats as one flex column, below an empty
    // row. The Run bar (run-strategy.tsx) floats over that row and never moves
    // with the panel, so with the panel open it reads as the panel's top row.
    return (
        <div className='run-panel__layout'>
            <div className='run-panel__run-bar-slot' data-testid='dt_run_panel_run_bar_slot' />
            <div className='run-panel__scroll'>{tabs}</div>
            {stats}
        </div>
    );
};

const DrawerFooter = ({ is_clear_stat_disabled, onClearStatClick }: TDrawerFooter) => (
    <div className='run-panel__footer'>
        <Button
            id='db-run-panel__clear-button'
            className='run-panel__footer-button'
            disabled={is_clear_stat_disabled}
            onClick={onClearStatClick}
            has_effect
            secondary
        >
            <span>
                <Localize i18n_default_text='Reset' />
            </span>
        </Button>
    </div>
);

const MobileDrawerFooter = () => {
    return (
        <div className='controls__section'>
            <div className='controls__buttons'>
                <TradeAnimation className='controls__animation' />
            </div>
        </div>
    );
};

const StatisticsInfoModal = ({
    is_mobile,
    is_statistics_info_modal_open,
    toggleStatisticsInfoModal,
}: TStatisticsInfoModal) => {
    return (
        <Modal
            className={classNames('statistics__modal', { 'statistics__modal--mobile': is_mobile })}
            title={localize("What's this?")}
            is_open={is_statistics_info_modal_open}
            toggleModal={toggleStatisticsInfoModal}
            width={'440px'}
        >
            <Modal.Body>
                <div className={classNames('statistics__modal-body', { 'statistics__modal-body--mobile': is_mobile })}>
                    <ThemedScrollbars className='statistics__modal-scrollbar'>
                        <Text as='p' weight='bold' className='statistics__modal-body--content no-margin'>
                            <Localize i18n_default_text='Total stake' />
                        </Text>
                        <Text as='p'>
                            <Localize i18n_default_text='Total stake since you last cleared your stats.' />
                        </Text>
                        <Text as='p' weight='bold' className='statistics__modal-body--content'>
                            <Localize i18n_default_text='Total payout' />
                        </Text>
                        <Text as='p'>{localize('Total payout since you last cleared your stats.')}</Text>
                        <Text as='p' weight='bold' className='statistics__modal-body--content'>
                            <Localize i18n_default_text='No. of runs' />
                        </Text>
                        <Text as='p'>
                            <Localize i18n_default_text='The number of times your bot has run since you last cleared your stats. Each run includes the execution of all the root blocks.' />
                        </Text>
                        <Text as='p' weight='bold' className='statistics__modal-body--content'>
                            <Localize i18n_default_text='Contracts lost' />
                        </Text>
                        <Text as='p'>
                            <Localize i18n_default_text='The number of contracts you have lost since you last cleared your stats.' />
                        </Text>
                        <Text as='p' weight='bold' className='statistics__modal-body--content'>
                            <Localize i18n_default_text='Contracts won' />
                        </Text>
                        <Text as='p'>
                            <Localize i18n_default_text='The number of contracts you have won since you last cleared your stats.' />
                        </Text>
                        <Text as='p' weight='bold' className='statistics__modal-body--content'>
                            <Localize i18n_default_text='Total profit/loss' />
                        </Text>
                        <Text as='p'>
                            <Localize i18n_default_text='Your total profit/loss since you last cleared your stats. It is the difference between your total payout and your total stake.' />
                        </Text>
                    </ThemedScrollbars>
                </div>
            </Modal.Body>
        </Modal>
    );
};

const RunPanel = observer(() => {
    const { run_panel, dashboard, transactions, ai_scanner } = useStore();
    const { client } = useStore();
    const { isDesktop } = useDevice();
    const is_phone = useIsPhone();
    const { currency } = client;
    const {
        active_index,
        is_drawer_open,
        is_running,
        is_statistics_info_modal_open,
        is_clear_stat_disabled,
        onClearStatClick,
        onMount,
        onRunButtonClick, // eslint-disable-line @typescript-eslint/no-unused-vars
        onUnmount,
        setActiveTabIndex,
        toggleDrawer,
        toggleStatisticsInfoModal,
    } = run_panel;
    const { statistics } = transactions;
    const { active_tour, active_tab } = dashboard;
    const { total_payout, total_profit, total_stake, won_contracts, lost_contracts, number_of_runs } = statistics;
    const { BOT_BUILDER } = DBOT_TABS;

    React.useEffect(() => {
        onMount();
        return () => onUnmount();
    }, [onMount, onUnmount]);

    React.useEffect(() => {
        if (!isDesktop) {
            toggleDrawer(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Desktop tab-based default visibility (runpanel): permanent on Bot
    // Builder; every other tab starts collapsed (only the chevron sliver
    // shows - the same mechanism Drawer already provides for manual
    // open/close, run-panel.tsx's own toggleDrawer/is_drawer_open), unless
    // a bot is actually running, in which case it shows regardless of tab
    // so a running strategy is never hidden. Re-evaluates on every tab
    // switch or running-state change; a manual chevron toggle in between
    // is respected until the next one of those changes resets it to that
    // tab's own default - deliberate, not an oversight, since "hidden by
    // default on every other tab" is the explicit requirement.
    React.useEffect(() => {
        if (!isDesktop) return;
        toggleDrawer(is_running || active_tab === BOT_BUILDER);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active_tab, is_running, isDesktop]);

    const content = (
        <DrawerContent
            active_index={active_index}
            currency={currency}
            is_drawer_open={is_drawer_open}
            is_mobile={!isDesktop}
            lost_contracts={lost_contracts}
            number_of_runs={number_of_runs}
            setActiveTabIndex={setActiveTabIndex}
            toggleStatisticsInfoModal={toggleStatisticsInfoModal}
            total_payout={total_payout}
            total_profit={total_profit}
            total_stake={total_stake}
            won_contracts={won_contracts}
            active_tour={active_tour}
        />
    );

    const footer = <DrawerFooter is_clear_stat_disabled={is_clear_stat_disabled} onClearStatClick={onClearStatClick} />;

    const header = (
        <DrawerHeader
            is_clear_stat_disabled={is_clear_stat_disabled}
            is_mobile={!isDesktop}
            is_drawer_open={is_drawer_open}
            onClearStatClick={onClearStatClick}
        />
    );

    // Desktop: mounts on every tab except RUN_BAR_HIDDEN_TABS (Tbots,
    // DTrader), where neither the Run bar nor the panel is shown, even during
    // a run. On the other tabs see the effect above for default visibility
    // (collapsed vs shown) - the Drawer's chevron stays reachable so a
    // collapsed panel can still be opened manually.
    if (isDesktop && RUN_BAR_HIDDEN_TABS.includes(active_tab)) return null;
    if (active_tour === 'bot_builder') return null;

    // Phones, Tbots / DTrader: the drawer (and its handle) is hidden so the tab
    // gets the full height. Hidden, not unmounted: Summary / Transactions /
    // Journal keep their state and mount effects exactly as on other tabs. A
    // running bot or AI Scanner gets the slim Stop bar instead.
    const is_phone_full_height_tab = is_phone && PHONE_FULL_HEIGHT_TABS.includes(active_tab);
    const show_slim_stop = is_phone_full_height_tab && isBotOrScannerRunning({ run_panel, ai_scanner });

    return (
        <>
            <div
                className={classNames(!isDesktop && is_drawer_open ? 'run-panel__container--mobile' : 'run-panel', {
                    'run-panel--phone-tab-hidden': is_phone_full_height_tab,
                })}
            >
                <Drawer
                    anchor='right'
                    className={classNames('run-panel', {
                        'run-panel__container': isDesktop,
                        'run-panel__container--tour-active': isDesktop && active_tour,
                    })}
                    contentClassName='run-panel__content'
                    header={header}
                    footer={isDesktop && footer}
                    is_open={is_drawer_open}
                    toggleDrawer={toggleDrawer}
                    zIndex={popover_zindex.RUN_PANEL}
                >
                    {content}
                </Drawer>
                {/* Prefer not rendering at all over hiding with CSS, so a hidden
                    button can never be clicked - same rule as the desktop
                    bar in run-strategy.tsx, applied here to .controls__section.
                    Position/styling of .controls__section itself is untouched. */}
                {!isDesktop && !RUN_BAR_HIDDEN_TABS.includes(active_tab) && <MobileDrawerFooter />}
            </div>
            {show_slim_stop && <SlimStopBar />}

            <StatisticsInfoModal
                is_mobile={!isDesktop}
                is_statistics_info_modal_open={is_statistics_info_modal_open}
                toggleStatisticsInfoModal={toggleStatisticsInfoModal}
            />
        </>
    );
});

export default RunPanel;
