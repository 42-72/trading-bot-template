import { getSavedWorkspaces } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { act, fireEvent, render, screen } from '@testing-library/react';
import DashboardComponent from '../dashboard';

jest.mock('@/hooks/useStore', () => ({ useStore: jest.fn() }));
jest.mock('@/external/bot-skeleton', () => ({ getSavedWorkspaces: jest.fn() }));
jest.mock('@/components/load-modal/google-drive', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/shared_ui/dialog', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/shared_ui/mobile-full-page-modal', () => ({ __esModule: true, default: () => null }));
jest.mock('@deriv/quill-icons/Illustration', () => ({
    DerivLightBotBuilderIcon: () => null,
    DerivLightGoogleDriveIcon: () => null,
    DerivLightLocalDeviceIcon: () => null,
    DerivLightMyComputerIcon: () => null,
    DerivLightQuickStrategyIcon: () => null,
}));
const mock_device = { isDesktop: true };
jest.mock('@deriv-com/ui', () => ({ useDevice: () => mock_device }));
jest.mock('@deriv-com/translations', () => ({
    localize: (text: string) => text,
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => i18n_default_text,
}));

const BOT_BUILDER_TAB = 1;

const setup = async () => {
    const store = {
        dashboard: {
            active_tour: '',
            dialog_options: {},
            is_dialog_open: false,
            onCloseDialog: jest.fn(),
            setActiveTab: jest.fn(),
            setPreviewOnPopup: jest.fn(),
            setStrategySaveType: jest.fn(),
            strategy_save_type: '',
        },
        load_modal: {
            setActiveTabIndex: jest.fn(),
            setDashboardStrategies: jest.fn(),
            toggleLoadModal: jest.fn(),
        },
        quick_strategy: { setFormVisibility: jest.fn() },
        run_panel: { is_drawer_open: false },
    };
    (useStore as jest.Mock).mockReturnValue(store);
    await act(async () => {
        render(<DashboardComponent />);
    });
    return store;
};

describe('Dashboard home', () => {
    beforeEach(() => {
        mock_device.isDesktop = true;
        (getSavedWorkspaces as jest.Mock).mockResolvedValue([{ id: 'saved' }]);
        document.getElementById('ct-motto-fonts')?.remove();
    });

    it('shows the quote and signature, and loads only their two fonts', async () => {
        await setup();

        expect(screen.getByText("I've gotta be one of the greats")).toBeInTheDocument();
        expect(screen.getByText('— Cench')).toBeInTheDocument();
        const { href } = document.getElementById('ct-motto-fonts') as HTMLLinkElement;
        expect(href).toContain('family=Barlow+Condensed:ital,wght@1,800&family=Mr+Dafoe&display=swap');
    });

    it('still feeds the saved bots to the store, which the Run button and Save read', async () => {
        const store = await setup();

        expect(store.load_modal.setDashboardStrategies).toHaveBeenCalledWith([{ id: 'saved' }]);
    });

    it('opens the file loader from the whole My computer card', async () => {
        const store = await setup();

        fireEvent.click(screen.getByText('Load a bot file (XML) from your device'));

        expect(store.load_modal.toggleLoadModal).toHaveBeenCalledTimes(1);
        expect(store.load_modal.setActiveTabIndex).toHaveBeenCalledWith(1);
        expect(store.dashboard.setActiveTab).toHaveBeenCalledWith(BOT_BUILDER_TAB);
    });

    it('picks the phone tab of the file loader on a phone', async () => {
        mock_device.isDesktop = false;
        const store = await setup();

        fireEvent.click(screen.getByRole('button', { name: /My computer/ }));

        expect(store.load_modal.setActiveTabIndex).toHaveBeenCalledWith(0);
    });

    it('opens Bot Builder and Quick strategy', async () => {
        const store = await setup();

        fireEvent.click(screen.getByRole('button', { name: /Bot Builder/ }));
        expect(store.dashboard.setActiveTab).toHaveBeenCalledWith(BOT_BUILDER_TAB);
        expect(store.quick_strategy.setFormVisibility).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /Quick strategy/ }));
        expect(store.quick_strategy.setFormVisibility).toHaveBeenCalledWith(true);
    });

    it('shows Google Drive as a card that does nothing', async () => {
        const store = await setup();

        expect(screen.getAllByRole('button')).toHaveLength(3);
        expect(screen.getAllByText('Open')).toHaveLength(3);
        expect(screen.queryByRole('button', { name: /Google Drive/ })).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('Google Drive'));

        expect(store.load_modal.toggleLoadModal).not.toHaveBeenCalled();
        expect(store.dashboard.setActiveTab).not.toHaveBeenCalled();
    });

    it('no longer shows the removed texts', async () => {
        await setup();

        expect(screen.queryByText(/Import a bot from your computer/)).not.toBeInTheDocument();
        expect(screen.queryByText('Your bots:')).not.toBeInTheDocument();
        expect(screen.queryByText('Announcements')).not.toBeInTheDocument();
    });
});
