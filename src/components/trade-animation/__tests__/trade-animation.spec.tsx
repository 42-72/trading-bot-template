import { observable, runInAction } from 'mobx';
import { DBOT_TABS } from '@/constants/bot-contents';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import { act, fireEvent, render, screen } from '@testing-library/react';
import TradeAnimation from '../trade-animation';

jest.mock('@/hooks/useStore', () => ({ useStore: jest.fn() }));
jest.mock('@deriv-com/ui', () => ({ useDevice: () => ({ isMobile: false }) }));
jest.mock('@deriv-com/translations', () => ({
    localize: (text: string) => text,
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => i18n_default_text,
}));

// Every text the bar's old status area could show during a run.
const OLD_STATUS_TEXTS = [
    'Bot is not running',
    'Bot is starting',
    'Bot running',
    'Buying contract',
    'Contract bought',
    'Bot is stopping',
    'Contract closed',
    'Won',
    'Lost',
];

const setup = (active_tab: number = DBOT_TABS.BOT_BUILDER) => {
    const run_panel = observable(
        {
            contract_stage: contract_stages.NOT_RUNNING as number,
            is_running: false,
            get is_stop_button_visible(): boolean {
                return this.is_running;
            },
            is_stop_button_disabled: false,
            execution_mode: 'normal',
            get is_execution_mode_locked(): boolean {
                return this.is_running;
            },
            setExecutionMode: jest.fn(),
            onRunButtonClick: jest.fn(),
            onStopBotClick: jest.fn(),
        },
        { setExecutionMode: false, onRunButtonClick: false, onStopBotClick: false }
    );
    (useStore as jest.Mock).mockReturnValue({
        run_panel,
        dashboard: { active_tab },
        blockly_store: { has_active_bot: true, has_saved_bots: true, checkForSavedBots: jest.fn() },
        load_modal: { dashboard_strategies: [], is_delete_modal_open: false },
        summary_card: { is_contract_completed: true, profit: 1 },
    });
    const { container } = render(<TradeAnimation className='toolbar__animation' />);
    const setRun = (is_running: boolean, contract_stage: number) =>
        act(() => {
            runInAction(() => {
                run_panel.is_running = is_running;
                run_panel.contract_stage = contract_stage;
            });
        });
    return { run_panel, container, setRun };
};

describe('TradeAnimation (the Run bar)', () => {
    it('is Run, then the Execution switch inside the bar', () => {
        const { container } = setup();
        const bar = container.querySelector('.animation__wrapper') as HTMLElement;
        const children = Array.from(bar.children);
        expect(children).toHaveLength(2);
        expect(children[0]).toHaveTextContent('Run');
        expect(children[1]).toHaveAttribute('data-testid', 'dt_execution_mode');
        expect(screen.getByRole('switch', { name: 'Fast execution' })).toBeInTheDocument();
    });

    it('renders no status text in any run stage - Run turns into Stop instead', () => {
        const { container, setRun } = setup();
        Object.values(contract_stages).forEach(stage => {
            setRun(stage !== contract_stages.NOT_RUNNING, stage);
            OLD_STATUS_TEXTS.forEach(text => expect(screen.queryByText(text)).not.toBeInTheDocument());
            expect(container.querySelector('.animation__container, .animation__text')).toBeNull();
        });
        setRun(true, contract_stages.RUNNING);
        expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    });

    it('locks the switch while a bot runs', () => {
        const { setRun } = setup();
        expect(screen.getByRole('switch')).toBeEnabled();
        setRun(true, contract_stages.RUNNING);
        expect(screen.getByRole('switch')).toBeDisabled();
        setRun(false, contract_stages.NOT_RUNNING);
        expect(screen.getByRole('switch')).toBeEnabled();
    });

    it('Run still starts the bot', () => {
        const { run_panel } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'Run' }));
        expect(run_panel.onRunButtonClick).toHaveBeenCalled();
    });
});

describe('Run on the Dashboard', () => {
    const run_button = () => screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement;

    it('cannot be pressed, even with a bot loaded, and looks it', () => {
        const { run_panel } = setup(DBOT_TABS.DASHBOARD);
        expect(run_button()).toBeDisabled();
        expect(run_button()).toHaveClass('animation__run-button--locked');
        fireEvent.click(run_button());
        expect(run_panel.onRunButtonClick).not.toHaveBeenCalled();
    });

    it('stays without effect if something re-enables the button directly (api-base toggleRunButton)', () => {
        const { run_panel } = setup(DBOT_TABS.DASHBOARD);
        run_button().disabled = false;
        fireEvent.click(run_button());
        expect(run_panel.onRunButtonClick).not.toHaveBeenCalled();
    });

    it('Stop works there while a bot, or a bot the AI Scanner started, is running', () => {
        const { run_panel, setRun } = setup(DBOT_TABS.DASHBOARD);
        setRun(true, contract_stages.RUNNING);
        const stop = screen.getByRole('button', { name: 'Stop' });
        expect(stop).toBeEnabled();
        expect(stop).not.toHaveClass('animation__run-button--locked');
        fireEvent.click(stop);
        expect(run_panel.onStopBotClick).toHaveBeenCalled();
    });

    it('Run is locked again once the run has ended', () => {
        const { setRun } = setup(DBOT_TABS.DASHBOARD);
        setRun(true, contract_stages.RUNNING);
        setRun(false, contract_stages.NOT_RUNNING);
        expect(run_button()).toBeDisabled();
    });

    it.each([
        ['Bot Builder', DBOT_TABS.BOT_BUILDER],
        ['Tbots', DBOT_TABS.TBOTS],
        ['Market Tool', DBOT_TABS.MARKET_TOOL],
        ['DTrader', DBOT_TABS.DTRADER],
        ['TradingView', DBOT_TABS.TRADINGVIEW],
        ['Charts', DBOT_TABS.CHART],
        ['Copy Trading', DBOT_TABS.COPY_TRADING],
    ])('%s: Run still starts the bot', (_name, tab) => {
        const { run_panel } = setup(tab);
        expect(run_button()).toBeEnabled();
        expect(run_button()).not.toHaveClass('animation__run-button--locked');
        fireEvent.click(run_button());
        expect(run_panel.onRunButtonClick).toHaveBeenCalled();
    });
});
