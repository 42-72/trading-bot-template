import { observable, runInAction } from 'mobx';
import { PATIENT_LOAD_TIMEOUT_MS } from '@/components/iframe-wrapper';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { act, render, screen } from '@testing-library/react';
import TradingViewPanel from '..';

jest.mock('@/hooks/useStore', () => ({ useStore: jest.fn() }));
jest.mock('@/hooks/useThemeSwitcher', () => ({ __esModule: true, default: () => ({ is_dark_mode_on: true }) }));
jest.mock('@deriv-com/translations', () => ({ localize: (text: string) => text }));

const setup = (active_tab: number) => {
    const dashboard = observable({ active_tab });
    (useStore as jest.Mock).mockReturnValue({ dashboard });
    render(<TradingViewPanel />);
    return (tab: number) => act(() => runInAction(() => (dashboard.active_tab = tab)));
};
const wait = (ms: number) => act(() => jest.advanceTimersByTime(ms));

describe('TradingView tab', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('nothing loads or counts until the tab is opened', () => {
        const setTab = setup(DBOT_TABS.DASHBOARD);
        expect(screen.queryByTitle('TradingView Charts')).not.toBeInTheDocument();
        wait(PATIENT_LOAD_TIMEOUT_MS * 2);
        setTab(DBOT_TABS.TRADINGVIEW);
        expect(screen.getByTitle('TradingView Charts')).toHaveAttribute(
            'src',
            'https://charts.deriv.com/deriv?theme=dark'
        );
        expect(screen.getByText('Loading chart…')).toBeInTheDocument();
    });

    it('leaving the tab while the chart loads stops the clock; it can still load', () => {
        const setTab = setup(DBOT_TABS.TRADINGVIEW);
        wait(PATIENT_LOAD_TIMEOUT_MS - 1000);
        setTab(DBOT_TABS.CHART);
        wait(PATIENT_LOAD_TIMEOUT_MS * 3);
        setTab(DBOT_TABS.TRADINGVIEW);
        expect(screen.getByText('Loading chart…')).toBeInTheDocument();
        expect(screen.queryByText("Chart couldn't load")).not.toBeInTheDocument();
    });

    it('a real failure says so, with Try again and no raw link', () => {
        setup(DBOT_TABS.TRADINGVIEW);
        wait(PATIENT_LOAD_TIMEOUT_MS);
        expect(screen.getByText("Chart couldn't load")).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.queryByText(/temporarily unavailable/)).not.toBeInTheDocument();
    });
});
