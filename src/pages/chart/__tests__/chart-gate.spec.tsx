import { observable, runInAction } from 'mobx';
import { contract_stages } from '@/constants/contract-stage';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ChartGate from '../chart-gate';

const mock_store = observable({
    run_panel: { is_running: false, contract_stage: contract_stages.NOT_RUNNING as number },
    ai_scanner: { stage: 'idle' },
});
jest.mock('@/hooks/useStore', () => ({ useStore: () => mock_store }));
jest.mock('@deriv-com/translations', () => ({ localize: (text: string) => text }));

const set = (fn: () => void) => act(() => runInAction(fn));

describe('ChartGate (the chart never starts in the middle of a trade)', () => {
    beforeEach(() => {
        set(() => {
            mock_store.run_panel.is_running = false;
            mock_store.run_panel.contract_stage = contract_stages.NOT_RUNNING;
            mock_store.ai_scanner.stage = 'idle';
        });
    });

    it('starts the chart at once when nothing is running', () => {
        render(<ChartGate>chart</ChartGate>);
        expect(screen.getByText('chart')).toBeInTheDocument();
    });

    it('while a bot runs, waits until a buy is confirmed, then starts it', () => {
        set(() => {
            mock_store.run_panel.is_running = true;
            mock_store.run_panel.contract_stage = contract_stages.CONTRACT_CLOSED;
        });
        render(<ChartGate>chart</ChartGate>);
        expect(screen.queryByText('chart')).not.toBeInTheDocument();
        expect(screen.getByTestId('dt_chart_deferred')).toBeInTheDocument();

        set(() => (mock_store.run_panel.contract_stage = contract_stages.PURCHASE_SENT));
        expect(screen.queryByText('chart')).not.toBeInTheDocument();
        set(() => (mock_store.run_panel.contract_stage = contract_stages.PURCHASE_RECEIVED));
        expect(screen.getByText('chart')).toBeInTheDocument();
    });

    it('waits while the AI Scanner scans (a tick may start a run any moment), and "Open now" overrides', () => {
        set(() => (mock_store.ai_scanner.stage = 'scanning'));
        render(<ChartGate>chart</ChartGate>);
        expect(screen.queryByText('chart')).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('Open now'));
        expect(screen.getByText('chart')).toBeInTheDocument();
    });

    it('starts as soon as the run ends', () => {
        set(() => (mock_store.run_panel.is_running = true));
        render(<ChartGate>chart</ChartGate>);
        expect(screen.queryByText('chart')).not.toBeInTheDocument();
        set(() => (mock_store.run_panel.is_running = false));
        expect(screen.getByText('chart')).toBeInTheDocument();
    });
});
