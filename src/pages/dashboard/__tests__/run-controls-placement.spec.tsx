import fs from 'fs';
import { action, observable, runInAction } from 'mobx';
import path from 'path';
import RunPanel from '@/components/run-panel';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { act, render, screen } from '@testing-library/react';
import RunStrategy from '../run-strategy';

// Desktop Run bar: one element, mounted once, outside the run panel, on every
// tab with the panel open or closed. jsdom has no layout, so "same spot" is
// checked as: same DOM node, never inside anything that moves, and one fixed
// rule in the stylesheet that no tab or panel state can change.

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

const ALL_TABS: [string, number][] = [
    ['Dashboard', DBOT_TABS.DASHBOARD],
    ['Bot Builder', DBOT_TABS.BOT_BUILDER],
    ['Tbots', DBOT_TABS.TBOTS],
    ['Market Tool', DBOT_TABS.MARKET_TOOL],
    ['DTrader', DBOT_TABS.DTRADER],
    ['TradingView', DBOT_TABS.TRADINGVIEW],
    ['Charts', DBOT_TABS.CHART],
    ['Copy Trading', DBOT_TABS.COPY_TRADING],
];

const setup = (active_tab: number = DBOT_TABS.DASHBOARD) => {
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
    const setTab = (tab: number) => act(() => runInAction(() => (dashboard.active_tab = tab)));
    return { run_panel, dashboard, setDrawer, setTab };
};

const theRunBar = () => {
    const controls = screen.getAllByTestId('run-controls');
    expect(controls).toHaveLength(1);
    const bar = controls[0].closest('.run-strategy-bar');
    expect(bar).not.toBeNull();
    expect(bar?.closest('.run-panel__container')).toBeNull();
    return controls[0];
};

describe('desktop Run bar', () => {
    beforeEach(() => {
        mock_device.isDesktop = true;
        mock_device.isMobile = false;
    });

    it.each(ALL_TABS)('%s: exactly one, outside the panel, panel closed and open', (_name, tab) => {
        const { setDrawer } = setup(tab);
        setDrawer(false);
        theRunBar();
        setDrawer(true);
        theRunBar();
    });

    it('is the same element through every tab and panel state: never moved, never remounted', () => {
        const { setDrawer, setTab } = setup(DBOT_TABS.DASHBOARD);
        const bar = theRunBar();
        ALL_TABS.forEach(([, tab]) => {
            setTab(tab);
            [false, true].forEach(is_open => {
                setDrawer(is_open);
                expect(theRunBar()).toBe(bar);
            });
        });
    });

    it('the panel keeps an empty row for it, open or closed, so Summary starts below the bar', () => {
        const { setDrawer } = setup(DBOT_TABS.CHART);
        [false, true].forEach(is_open => {
            setDrawer(is_open);
            const slot = screen.getByTestId('dt_run_panel_run_bar_slot');
            expect(slot.children).toHaveLength(0);
            expect(slot.nextElementSibling).toHaveClass('run-panel__scroll');
        });
    });

    it('a run opens the panel on any tab, and the bar stays where it is', () => {
        const { run_panel } = setup(DBOT_TABS.MARKET_TOOL);
        const bar = theRunBar();
        expect(run_panel.is_drawer_open).toBe(false);
        act(() => runInAction(() => (run_panel.is_running = true)));
        expect(run_panel.is_drawer_open).toBe(true);
        expect(theRunBar()).toBe(bar);
    });

    it('the Bot Builder tour hides the panel: the bar stays', () => {
        const { dashboard } = setup(DBOT_TABS.BOT_BUILDER);
        const bar = theRunBar();
        act(() => runInAction(() => (dashboard.active_tour = 'bot_builder')));
        expect(document.querySelector('.run-panel__container')).toBeNull();
        expect(theRunBar()).toBe(bar);
    });

    it.each([
        ['Dashboard', DBOT_TABS.DASHBOARD, 1],
        ['Tbots', DBOT_TABS.TBOTS, 0],
        ['DTrader', DBOT_TABS.DTRADER, 0],
    ])('phones and tablets, %s: unchanged, Run only in the panel footer', (_name, tab, footers) => {
        mock_device.isDesktop = false;
        mock_device.isMobile = true;
        setup(tab);
        expect(document.querySelector('.run-strategy-bar')).toBeNull();
        expect(screen.queryByTestId('dt_run_panel_run_bar_slot')).toBeNull();
        expect(document.querySelectorAll('.controls__section')).toHaveLength(footers);
        expect(screen.queryAllByTestId('run-controls')).toHaveLength(footers);
    });
});

describe('desktop Run bar stylesheet', () => {
    const src = path.resolve(__dirname, '../../..');
    const read = (file: string) => fs.readFileSync(path.join(src, file), 'utf8');
    const main_scss = read('pages/main/main.scss');
    const rule = main_scss.match(/\n\.run-strategy-bar \{[\s\S]*?\n\}/)?.[0] ?? '';

    it('one fixed spot: absolute, same top and right, as wide as the panel column', () => {
        expect(rule).toMatch(/position: absolute;/);
        expect(rule).toMatch(/top: 7\.45rem;/);
        expect(rule).toMatch(/right: 0\.8rem;/);
        expect(rule).toMatch(/width: calc\(var\(--run-panel-width\) - 3\.2rem\);/);
    });

    it('nothing overrides that spot for a tab, a panel state or a screen size', () => {
        expect(main_scss.match(/\.run-strategy-bar/g)).toHaveLength(1);
        expect(read('pages/dashboard/dashboard.scss')).not.toMatch(/run-strategy-bar/);
        expect(read('components/run-panel/run-panel.scss')).not.toMatch(/^[^/]*\.run-strategy-bar/m);
    });

    it('reserves no full-width row: the only tabs moved down are the two with controls under the bar', () => {
        expect(read('pages/dashboard/dashboard.scss')).not.toMatch(/--run-strategy-bar/);
        expect(read('pages/dtrader/dtrader.scss')).toMatch(/top: var\(--tab-below-run-bar\);/);
        expect(read('pages/tradingview/tradingview.scss')).toMatch(/top: var\(--tab-below-run-bar\);/);
        expect(main_scss).toMatch(/\.bot-builder \{\s+position: absolute;\s+top: 6\.6rem;/);
    });

    it('the nav dock and its tab padding are gone', () => {
        expect(main_scss).not.toMatch(/run-dock/);
        expect(main_scss).not.toMatch(/padding: 0 1\.4rem/);
    });

    it('.bot-dashboard keeps overflow: clip on desktop (no horizontal scroll on Charts / Copy Trading)', () => {
        expect(read('pages/dashboard/dashboard.scss')).toMatch(/@include desktop-screen \{\s+overflow: clip;/);
    });
});
