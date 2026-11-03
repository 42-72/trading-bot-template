import React from 'react';
import { observable, runInAction } from 'mobx';
import { DBOT_TABS } from '@/constants/bot-contents';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import { act, fireEvent, render, screen } from '@testing-library/react';
import RunPanel from '../run-panel';

jest.mock('@/hooks/useStore', () => ({ useStore: jest.fn() }));
jest.mock('@deriv-com/ui', () => ({ useDevice: () => ({ isDesktop: false }) }));
jest.mock('@deriv-com/translations', () => ({
    localize: (text: string) => text,
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => i18n_default_text,
}));
jest.mock('@deriv/quill-icons/LabelPaired', () => ({ LabelPairedSquareLgFillIcon: () => null }));
jest.mock(
    '@/components/journal',
    () =>
        function Journal() {
            return <div>Journal content</div>;
        }
);
jest.mock(
    '@/components/summary',
    () =>
        function Summary() {
            return <div>Summary content</div>;
        }
);
jest.mock(
    '@/components/transactions',
    () =>
        function Transactions() {
            return <div>Transactions content</div>;
        }
);
jest.mock(
    '@/components/trade-animation',
    () =>
        function TradeAnimation() {
            return <div data-testid='dt_run_bar'>Run bar</div>;
        }
);
jest.mock(
    '@/components/shared_ui/drawer',
    () =>
        function Drawer({ children, header }: React.PropsWithChildren<{ header: React.ReactNode }>) {
            return (
                <div className='dc-drawer' data-testid='dt_drawer'>
                    <div className='dc-drawer__toggle' />
                    {header}
                    {children}
                </div>
            );
        }
);
jest.mock(
    '@/components/shared_ui/tabs',
    () =>
        function Tabs({ children }: React.PropsWithChildren) {
            return <div>{children}</div>;
        }
);
jest.mock('@/components/shared_ui/modal', () => {
    function Modal({ children }: React.PropsWithChildren) {
        return <div>{children}</div>;
    }
    Modal.Body = function ModalBody({ children }: React.PropsWithChildren) {
        return <div>{children}</div>;
    };
    return Modal;
});
jest.mock(
    '../../shared_ui/themed-scrollbars',
    () =>
        function ThemedScrollbars({ children }: React.PropsWithChildren) {
            return <div>{children}</div>;
        }
);

const mockScreen = (is_phone: boolean) => {
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
        matches: is_phone,
        media: query,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    }));
};

const setup = ({ is_phone = true, active_tab = DBOT_TABS.DTRADER } = {}) => {
    mockScreen(is_phone);
    const run_panel = observable(
        {
            active_index: 0,
            contract_stage: contract_stages.NOT_RUNNING as number,
            is_drawer_open: false,
            is_running: false,
            get is_stop_button_visible(): boolean {
                return this.is_running;
            },
            is_statistics_info_modal_open: false,
            is_clear_stat_disabled: true,
            onClearStatClick: jest.fn(),
            onMount: jest.fn(),
            onRunButtonClick: jest.fn(),
            onUnmount: jest.fn(),
            onStopBotClick: jest.fn(),
            setActiveTabIndex: jest.fn(),
            toggleDrawer: jest.fn(),
            toggleStatisticsInfoModal: jest.fn(),
        },
        {
            onClearStatClick: false,
            onMount: false,
            onRunButtonClick: false,
            onUnmount: false,
            onStopBotClick: false,
            setActiveTabIndex: false,
            toggleDrawer: false,
            toggleStatisticsInfoModal: false,
        }
    );
    const ai_scanner = observable(
        {
            stage: 'idle',
            get is_active(): boolean {
                return !['idle', 'stopped'].includes(this.stage);
            },
            get is_pre_run(): boolean {
                return this.stage === 'checking' || this.stage === 'scanning';
            },
            cancel: jest.fn(),
        },
        { cancel: false }
    );
    const dashboard = observable({ active_tab, active_tour: '' });
    (useStore as jest.Mock).mockReturnValue({
        run_panel,
        ai_scanner,
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
    const view = render(<RunPanel />);
    const set = (fn: () => void) => act(() => runInAction(fn));
    const wrapper = () => view.container.firstElementChild as HTMLElement;
    return { ...view, run_panel, ai_scanner, dashboard, set, wrapper };
};

describe('RunPanel on phones - Tbots / DTrader get the full height', () => {
    it.each([
        ['DTrader', DBOT_TABS.DTRADER],
        ['Tbots', DBOT_TABS.TBOTS],
    ])('%s tab: the drawer and its handle are hidden, no Stop bar while idle', (_name, tab) => {
        const { wrapper } = setup({ active_tab: tab });
        expect(wrapper()).toHaveClass('run-panel--phone-tab-hidden');
        // Still mounted (hidden with CSS): Summary / Transactions / Journal keep their state
        expect(screen.getByTestId('dt_drawer')).toBeInTheDocument();
        expect(screen.queryByTestId('dt_slim_stop_bar')).not.toBeInTheDocument();
        expect(screen.queryByTestId('dt_run_bar')).not.toBeInTheDocument();
    });

    it.each([
        ['DTrader', DBOT_TABS.DTRADER],
        ['Tbots', DBOT_TABS.TBOTS],
    ])('%s tab: a running bot shows only the slim Stop bar, which stops the bot', (_name, tab) => {
        const { run_panel, set, wrapper } = setup({ active_tab: tab });
        set(() => {
            run_panel.is_running = true;
        });
        expect(wrapper()).toHaveClass('run-panel--phone-tab-hidden');
        expect(screen.getByTestId('dt_slim_stop_bar')).toHaveTextContent('Bot is running');
        fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
        expect(run_panel.onStopBotClick).toHaveBeenCalledTimes(1);

        set(() => {
            run_panel.is_running = false;
        });
        expect(screen.queryByTestId('dt_slim_stop_bar')).not.toBeInTheDocument();
    });

    it('a scanning AI Scanner gets "Stop scan", which cancels the scanner (not the bot path)', () => {
        const { ai_scanner, run_panel, set } = setup({ active_tab: DBOT_TABS.DTRADER });
        set(() => {
            ai_scanner.stage = 'scanning';
        });
        fireEvent.click(screen.getByRole('button', { name: /Stop scan/ }));
        expect(ai_scanner.cancel).toHaveBeenCalledTimes(1);
        expect(run_panel.onStopBotClick).not.toHaveBeenCalled();
    });

    it('an AI Scanner bot run is stopped through the scanner, and the button waits while it stops', () => {
        const { ai_scanner, run_panel, set } = setup({ active_tab: DBOT_TABS.TBOTS });
        set(() => {
            ai_scanner.stage = 'running';
            run_panel.is_running = true;
        });
        expect(screen.getByTestId('dt_slim_stop_bar')).toHaveTextContent('AI Scanner bot is running');
        fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
        expect(ai_scanner.cancel).toHaveBeenCalledTimes(1);
        expect(run_panel.onStopBotClick).not.toHaveBeenCalled();

        set(() => {
            ai_scanner.stage = 'stopping';
        });
        expect(screen.getByRole('button', { name: /Stopping/ })).toBeDisabled();
    });

    it('a bot that is stopping shows a disabled "Stopping…"', () => {
        const { run_panel, set } = setup({ active_tab: DBOT_TABS.DTRADER });
        set(() => {
            run_panel.is_running = true;
            run_panel.contract_stage = contract_stages.IS_STOPPING;
        });
        expect(screen.getByRole('button', { name: /Stopping/ })).toBeDisabled();
    });

    it.each([
        ['Dashboard', DBOT_TABS.DASHBOARD],
        ['Bot Builder', DBOT_TABS.BOT_BUILDER],
    ])('other tabs (%s) are unchanged: drawer and Run bar, no slim Stop bar', (_name, tab) => {
        const { run_panel, set, wrapper } = setup({ active_tab: tab });
        set(() => {
            run_panel.is_running = true;
        });
        expect(wrapper()).not.toHaveClass('run-panel--phone-tab-hidden');
        expect(screen.getByTestId('dt_run_bar')).toBeInTheDocument();
        expect(screen.queryByTestId('dt_slim_stop_bar')).not.toBeInTheDocument();
    });

    it('after "Load bot" moves the trader from Tbots to Bot Builder, the Run bar is back', () => {
        const { dashboard, set, wrapper } = setup({ active_tab: DBOT_TABS.TBOTS });
        expect(screen.queryByTestId('dt_run_bar')).not.toBeInTheDocument();
        set(() => {
            dashboard.active_tab = DBOT_TABS.BOT_BUILDER;
        });
        expect(wrapper()).not.toHaveClass('run-panel--phone-tab-hidden');
        expect(screen.getByTestId('dt_run_bar')).toBeInTheDocument();
    });

    it('wider screens (>= 768px) are unchanged on Tbots / DTrader', () => {
        const { run_panel, set, wrapper } = setup({ is_phone: false, active_tab: DBOT_TABS.DTRADER });
        set(() => {
            run_panel.is_running = true;
        });
        expect(wrapper()).not.toHaveClass('run-panel--phone-tab-hidden');
        expect(screen.queryByTestId('dt_slim_stop_bar')).not.toBeInTheDocument();
    });
});
