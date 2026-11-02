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

const setup = () => {
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
        dashboard: { active_tab: DBOT_TABS.BOT_BUILDER },
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
