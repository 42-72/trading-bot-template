import { observable, runInAction } from 'mobx';
import { useStore } from '@/hooks/useStore';
import AiScannerStore, { SCAN_STOPPED_MESSAGE, TAiScannerStage } from '@/stores/ai-scanner-store';
import RootStore from '@/stores/root-store';
import { loadBotIntoBuilder } from '@/utils/load-bot-into-builder';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AiScannerPanel from '../ai-scanner-panel';

jest.mock('../../../assets/ai-engine/bull-ai-overunder.xml', () => '');
jest.mock('@/utils/load-bot-into-builder', () => ({ loadBotIntoBuilder: jest.fn() }));
jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: { api: { send: jest.fn(() => new Promise(() => undefined)) } },
}));
jest.mock('@/hooks/useStore', () => ({ useStore: jest.fn() }));

const MARKETS = [{ symbol: 'JD25', text: 'Jump 25 Index', submarket: 'jump_index' }];

const setup = () => {
    const root = {
        run_panel: observable(
            {
                is_running: false,
                has_open_contract: false,
                get is_stop_button_visible(): boolean {
                    return this.is_running || this.has_open_contract;
                },
                onStopBotClick: jest.fn(),
                dbot: { saveRecentWorkspace: jest.fn() },
            },
            { onStopBotClick: false, dbot: false }
        ),
        client: observable({ is_logged_in: true, currency: 'USD', is_virtual: true, loginid: 'VRTC1' }),
        transactions: observable({ statistics: { total_profit: 0 } }),
        dashboard: { setActiveTab: jest.fn() },
    } as unknown as RootStore;
    const store = new AiScannerStore(root);
    (useStore as jest.Mock).mockReturnValue({ ...root, ai_scanner: store });
    store.setMarkets(MARKETS);
    store.setFormField('stake', '0.35');
    store.setFormField('martingale', '2');
    store.setFormField('take_profit', '5');
    store.setFormField('stop_loss', '10');
    render(<AiScannerPanel style={{}} is_desktop />);
    return store;
};

const atStage = (store: AiScannerStore, stage: TAiScannerStage) =>
    act(() => {
        runInAction(() => {
            store.locked = {
                strategy: 'over',
                stake: 0.35,
                martingale: 2,
                take_profit: 5,
                stop_loss: 10,
                use_test_strategy: false,
                loginid: 'VRTC1',
            };
            store.stage = stage;
        });
    });

const top = () => screen.getByRole('button', { name: /^(Scan|Stop scan)$/ });
const light = () => screen.getByTestId('ai-scanner-status-light');

describe('AI Scanner panel buttons', () => {
    beforeEach(() => localStorage.clear());

    it.each<[TAiScannerStage, string, boolean, string, boolean]>([
        // stage       top label    top enabled  bottom label   lit
        ['idle', 'Scan', true, 'Load & Run', false],
        ['checking', 'Stop scan', true, 'Load & Run', false],
        ['scanning', 'Stop scan', true, 'Load & Run', false],
        ['starting', 'Scan', false, 'Loading…', true],
        ['running', 'Scan', false, 'Running', true],
        ['stopping', 'Scan', false, 'Running', true],
        ['stopped', 'Scan', true, 'Load & Run', false],
    ])('%s: top "%s" (enabled %s), bottom "%s" (lit %s)', (stage, top_label, top_enabled, bottom_label, lit) => {
        const store = setup();
        if (stage !== 'idle') atStage(store, stage);
        expect(top()).toHaveTextContent(top_label);
        expect(top().hasAttribute('disabled')).toBe(!top_enabled);
        expect(light()).toHaveTextContent(bottom_label);
        expect(light().className.includes('--lit')).toBe(lit);
        expect(light()).toBeDisabled();
    });

    it('Scan is disabled until the form is valid', () => {
        const store = setup();
        act(() => store.setFormField('stake', '0.1'));
        expect(top()).toBeDisabled();
        act(() => store.setFormField('stake', '0.35'));
        expect(top()).toBeEnabled();
    });

    it('Scan starts a scan; Stop scan ends it at once with "Scan stopped." and the form kept', () => {
        const store = setup();
        fireEvent.click(top());
        expect(store.stage).toBe('checking');
        expect(top()).toHaveTextContent('Stop scan');
        fireEvent.click(top());
        expect(store.stage).toBe('idle');
        expect(store.are_feeds_wanted).toBe(false);
        expect(screen.getByText(SCAN_STOPPED_MESSAGE)).toBeInTheDocument();
        expect(screen.getByDisplayValue('0.35')).toBeInTheDocument(); // the form, with its values
        expect(top()).toHaveTextContent('Scan');
        expect(top()).toBeEnabled();
        expect(loadBotIntoBuilder).not.toHaveBeenCalled();
    });

    it('the bottom button can never trigger anything', () => {
        const store = setup();
        // start() would save the workspace to Recent and leave 'idle'; cancel()
        // would leave any active stage - neither may happen.
        const { saveRecentWorkspace } = (useStore as jest.Mock).mock.results[0].value.run_panel.dbot;
        (['idle', 'scanning', 'starting', 'running', 'stopped'] as TAiScannerStage[]).forEach(stage => {
            if (stage !== 'idle') atStage(store, stage);
            const button = light();
            expect(button).toBeDisabled();
            expect(button).toHaveAttribute('tabindex', '-1');
            expect(button).toHaveAttribute('aria-disabled', 'true');
            fireEvent.click(button);
            fireEvent.keyDown(button, { key: 'Enter' });
            expect(store.stage).toBe(stage);
        });
        expect(saveRecentWorkspace).not.toHaveBeenCalled();
        expect(loadBotIntoBuilder).not.toHaveBeenCalled();
    });

    it('no trader-visible text says "Scan & Run" any more', () => {
        const store = setup();
        expect(document.body.textContent).not.toMatch(/Scan & Run/);
        atStage(store, 'scanning');
        expect(document.body.textContent).not.toMatch(/Scan & Run/);
    });
});
