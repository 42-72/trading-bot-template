import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { getSavedWorkspaces } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { useDevice } from '@deriv-com/ui';
import Cards from './cards';
import Motto from './motto';
// Not only the old bot list: it also styles the Load modal and other dialogs.
import './bot-list/index.scss';

const DashboardComponent = observer(() => {
    const { load_modal, dashboard, run_panel } = useStore();
    const { setDashboardStrategies } = load_modal;
    const { active_tour, setStrategySaveType, strategy_save_type } = dashboard;
    const { isDesktop } = useDevice();

    // The list is gone from this page, but the Run button, the page title and
    // the Save file name still read the saved bots from this store.
    React.useEffect(() => {
        setStrategySaveType('');
        const getStrategies = async () => {
            setDashboardStrategies(await getSavedWorkspaces());
        };
        getStrategies();
        // strategy_save_type changes when the save modal stores a bot.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [strategy_save_type]);

    return (
        <div
            className={classNames('tab__dashboard', {
                'tab__dashboard--tour-active': active_tour,
            })}
        >
            <div
                className={classNames('tab__dashboard__content', {
                    'tab__dashboard__content--panel-open': isDesktop && run_panel.is_drawer_open,
                })}
            >
                <div className='dashboard-home'>
                    <div className='dashboard-home__inner'>
                        <Motto />
                        <Cards is_mobile={!isDesktop} />
                    </div>
                </div>
            </div>
        </div>
    );
});

export default DashboardComponent;
