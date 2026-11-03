import { action, observable, runInAction } from 'mobx';
import RunPanel from '@/components/run-panel';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { act, render, screen } from '@testing-library/react';
import RunStrategy from '../run-strategy';

// Desktop Run controls: the Run bar is the open run panel's top row; with the
// panel closed a compact dock in the nav row has them. Never both, never none
// (except on Tbots / DTrader, which have no Run on desktop).

jest.mock('@/hooks/useStore', () => ({ useStore: jest.fn() }));
const mock_device = { isDesktop: true, isMobile: false };
jest.mock('@deriv-com/ui', () => ({ useDevice: () => mock_device }));
jest.mock('@deriv-com/translations', () => ({
    localize: (text: string) => text,
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => i18n_default_text,
}));
jest.mock('@/components/trade-animation', () => ({
    __esModule: true,
    default: ({ className }: { className?: string }) => <div data-testid='run-controls' className={className} />,
}));
jest.mock('@/components/journal', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/summary', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/transactions', () => ({ __esModule: true, default: () => null }));

const setup = (active_tab = DBOT_TABS.DASHBOARD) => {
    const run_panel: { is_drawer_open: boolean; is_running: boolean; toggleDrawer: (o: boolean) => void } = observable(
        {
            active_index: 0,
            is_drawer_open: false,
            is_running: false,
            is_statistics_info_modal_open: false,
            is_clear_stat_disabled: true,
            onClearStatClick: jest.fn(),
            onMount: jest.fn(),
            onUnmount: jest.fn(),
            onRunButtonClick: jest.fn(),
            setActiveTabIndex: jest.fn(),
            toggleDrawer: (is_open: boolean) => {
                run_panel.is_drawer_open = is_open;
            },
            toggleStatisticsInfoModal: jest.fn(),
        },
        {
            onClearStatClick: false,
            onMount: false,
            onUnmount: false,
            onRunButtonClick: false,
            setActiveTabIndex: false,
            toggleDrawer: action,
            toggleStatisticsInfoModal: false,
        }
    );
    const dashboard = observable({ active_tab, active_tour: '' as string });
    (useStore as jest.Mock).mockReturnValue({
        run_panel,
        dashboard,
        client: { currency: 'USD' },
        transactions: {
            statistics: {
                total_payout: 0,
                total_profit: 0,
                total_stake: 0,
                won_contracts: 0,
                lost_contracts: 0,
                number_of_runs: 0,
            },
        },
    });
    render(
        <>
            <RunStrategy />
            <RunPanel />
        </>
    );
    const setDrawer = (is_open: boolean) => act(() => run_panel.toggleDrawer(is_open));
    return { run_panel, dashboard, setDrawer };
};

const placement = () => {
    const controls = screen.queryAllByTestId('run-controls');
    if (controls.length !== 1) return `${controls.length} Run controls`;
    if (controls[0].closest('.run-dock')) return 'dock';
    if (controls[0].closest('.run-panel__run-bar')) return 'panel';
    return 'elsewhere';
};

describe('desktop Run controls placement', () => {
    beforeEach(() => {
        mock_device.isDesktop = true;
        mock_device.isMobile = false;
    });

    it.each([
        ['Dashboard', DBOT_TABS.DASHBOARD],
        ['Market Tool', DBOT_TABS.MARKET_TOOL],
        ['TradingView', DBOT_TABS.TRADINGVIEW],
        ['Charts', DBOT_TABS.CHART],
        ['Copy Trading', DBOT_TABS.COPY_TRADING],
    ])('%s: in the nav-row dock while the panel is closed', (_name, tab) => {
        setup(tab);
        expect(placement()).toBe('dock');
    });

    it('Bot Builder opens the panel: the Run bar is its top row, the dock is gone', () => {
        setup(DBOT_TABS.BOT_BUILDER);
        expect(placement()).toBe('panel');
        expect(document.querySelector('.run-dock')).toBeNull();
    });

    it('moves with the panel: open -> top of the panel, closed -> dock', () => {
        const { setDrawer } = setup(DBOT_TABS.CHART);
        setDrawer(true);
        expect(placement()).toBe('panel');
        setDrawer(false);
        expect(placement()).toBe('dock');
    });

    it('the panel keeps its Run bar row while closed, so nothing moves as it slides', () => {
        setup(DBOT_TABS.CHART);
        expect(document.querySelector('.run-panel__run-bar')).not.toBeNull();
        expect(document.querySelector('.run-panel__run-bar')?.children).toHaveLength(0);
    });

    it('a run opens the panel on any tab: Stop is at the top of the panel', () => {
        const { run_panel } = setup(DBOT_TABS.MARKET_TOOL);
        act(() => runInAction(() => (run_panel.is_running = true)));
        expect(placement()).toBe('panel');
    });

    it('Tbots and DTrader: no Run on desktop, and no panel', () => {
        setup(DBOT_TABS.TBOTS);
        expect(screen.queryAllByTestId('run-controls')).toHaveLength(0);
        expect(document.querySelector('.run-panel__run-bar')).toBeNull();
    });

    it('the Bot Builder tour hides the panel: Run stays reachable in the dock', () => {
        const { dashboard } = setup(DBOT_TABS.BOT_BUILDER);
        act(() => runInAction(() => (dashboard.active_tour = 'bot_builder')));
        expect(placement()).toBe('dock');
    });

    it('phones and tablets: neither (their Run bar is the panel footer, unchanged)', () => {
        mock_device.isDesktop = false;
        mock_device.isMobile = true;
        setup(DBOT_TABS.DASHBOARD);
        expect(document.querySelector('.run-dock')).toBeNull();
        expect(document.querySelector('.run-panel__run-bar')).toBeNull();
        expect(placement()).toBe('elsewhere');
        expect(screen.getByTestId('run-controls').closest('.controls__section')).not.toBeNull();
    });
});
