import { observable, runInAction } from 'mobx';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { DTRADER_EMBED_URL, DTRADER_ORIGIN } from '@/utils/dtrader-embed';
import { act, render } from '@testing-library/react';
import DTraderPanel from '..';

jest.mock('@/hooks/useStore', () => ({ useStore: jest.fn() }));
jest.mock('@/components/shared', () => ({ generateOAuthURL: jest.fn() }));
jest.mock('@deriv-com/translations', () => ({
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => i18n_default_text,
}));

const renderPanel = (active_tab = DBOT_TABS.DTRADER) => {
    (useStore as jest.Mock).mockReturnValue({
        dashboard: { active_tab },
        client: { is_logged_in: false, loginid: null, is_account_regenerating: false },
    });
    return render(<DTraderPanel />);
};

const getFrame = (container: HTMLElement) => container.querySelector('iframe') as HTMLIFrameElement;

describe('DTraderPanel', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        window.history.replaceState({}, '', '/');
    });

    it('shows embedded DTrader for every visitor, with no test switch', () => {
        const { container } = renderPanel();
        expect(getFrame(container)).toHaveAttribute('src', DTRADER_EMBED_URL);
    });

    it('ignores the old ?dtrader_embed=0 and removes the old switch key', () => {
        localStorage.setItem('ct_dtrader_embed', '1');
        window.history.replaceState({}, '', '/?dtrader_embed=0#dtrader');
        const { container } = renderPanel();
        expect(getFrame(container)).toHaveAttribute('src', DTRADER_EMBED_URL);
        expect(localStorage.getItem('ct_dtrader_embed')).toBeNull();
    });

    it('does not open DTrader in a new tab', () => {
        const open = jest.spyOn(window, 'open').mockImplementation(() => null);
        renderPanel();
        expect(open).not.toHaveBeenCalled();
        open.mockRestore();
    });

    it('frames embedded DTrader in a sandbox that cannot navigate this window', () => {
        const { container } = renderPanel();
        const frame = getFrame(container);

        expect(frame).toHaveAttribute('src', DTRADER_EMBED_URL);
        const sandbox = (frame.getAttribute('sandbox') ?? '').split(' ');
        expect(sandbox).toEqual(
            expect.arrayContaining([
                'allow-scripts',
                'allow-same-origin',
                'allow-forms',
                'allow-popups',
                'allow-popups-to-escape-sandbox',
                'allow-modals',
                'allow-downloads',
            ])
        );
        expect(sandbox.some(flag => flag.startsWith('allow-top-navigation'))).toBe(false);
    });

    it('answers ct:ready from the frame with the session, only to the DTrader origin', () => {
        const { container } = renderPanel();
        const frame_window = getFrame(container).contentWindow as Window;
        const postMessage = jest.spyOn(frame_window, 'postMessage').mockImplementation(() => undefined);

        act(() => {
            window.dispatchEvent(
                new MessageEvent('message', {
                    origin: DTRADER_ORIGIN,
                    source: frame_window,
                    data: { type: 'ct:ready' },
                })
            );
        });

        expect(postMessage).toHaveBeenCalledWith({ type: 'ct:session', session: null }, DTRADER_ORIGIN);
    });

    it('ignores ct:ready from any other origin', () => {
        const { container } = renderPanel();
        const frame_window = getFrame(container).contentWindow as Window;
        const postMessage = jest.spyOn(frame_window, 'postMessage').mockImplementation(() => undefined);

        act(() => {
            window.dispatchEvent(
                new MessageEvent('message', {
                    origin: 'https://evil.example',
                    source: frame_window,
                    data: { type: 'ct:ready' },
                })
            );
        });

        expect(postMessage).not.toHaveBeenCalled();
    });

    it('waits for the DTrader tab before loading the frame', () => {
        const { container } = renderPanel(DBOT_TABS.DASHBOARD);
        expect(getFrame(container)).toBeNull();
    });
});

describe('DTraderPanel - phones free the processor during a run', () => {
    const original_match_media = window.matchMedia;
    const mockScreen = (is_phone: boolean) => {
        window.matchMedia = jest.fn().mockImplementation((query: string) => ({
            matches: is_phone,
            media: query,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
        }));
    };

    const setup = (is_phone: boolean) => {
        mockScreen(is_phone);
        const dashboard = observable({ active_tab: DBOT_TABS.DTRADER as number });
        const run_panel = observable({ is_stop_button_visible: false });
        const ai_scanner = observable({ is_active: false });
        (useStore as jest.Mock).mockReturnValue({
            dashboard,
            run_panel,
            ai_scanner,
            client: { is_logged_in: false, loginid: null, is_account_regenerating: false },
        });
        const view = render(<DTraderPanel />);
        const set = (fn: () => void) => act(() => runInAction(fn));
        const frames = () => view.container.querySelectorAll('iframe').length;
        return { ...view, dashboard, run_panel, ai_scanner, set, frames };
    };

    afterEach(() => {
        window.matchMedia = original_match_media;
    });

    it('unloads the hidden frame when a bot starts, and does not reload it when the run ends', () => {
        const { dashboard, run_panel, set, frames } = setup(true);
        expect(frames()).toBe(1);

        set(() => {
            dashboard.active_tab = DBOT_TABS.DASHBOARD;
        });
        expect(frames()).toBe(1); // hidden, still loaded while nothing runs

        set(() => {
            run_panel.is_stop_button_visible = true;
        });
        expect(frames()).toBe(0);

        set(() => {
            run_panel.is_stop_button_visible = false;
        });
        expect(frames()).toBe(0);

        set(() => {
            dashboard.active_tab = DBOT_TABS.DTRADER;
        });
        expect(frames()).toBe(1);
    });

    it('unloads it when the AI Scanner starts too', () => {
        const { dashboard, ai_scanner, set, frames } = setup(true);
        set(() => {
            dashboard.active_tab = DBOT_TABS.TBOTS;
            ai_scanner.is_active = true;
        });
        expect(frames()).toBe(0);
    });

    it('loads it normally when the trader opens DTrader during a run', () => {
        const { dashboard, run_panel, set, frames } = setup(true);
        set(() => {
            dashboard.active_tab = DBOT_TABS.DASHBOARD;
        });
        set(() => {
            run_panel.is_stop_button_visible = true;
        });
        expect(frames()).toBe(0);
        set(() => {
            dashboard.active_tab = DBOT_TABS.DTRADER;
        });
        expect(frames()).toBe(1);
    });

    it('keeps it when the run starts while DTrader is the open tab', () => {
        const { run_panel, set, frames } = setup(true);
        set(() => {
            run_panel.is_stop_button_visible = true;
        });
        expect(frames()).toBe(1);
    });

    it('laptops keep the frame loaded during a run', () => {
        const { dashboard, run_panel, set, frames } = setup(false);
        set(() => {
            dashboard.active_tab = DBOT_TABS.DASHBOARD;
        });
        set(() => {
            run_panel.is_stop_button_visible = true;
        });
        expect(frames()).toBe(1);
    });

    it('a reloaded frame gets the session again on its ct:ready', () => {
        const { dashboard, run_panel, set, container } = setup(true);
        set(() => {
            dashboard.active_tab = DBOT_TABS.DASHBOARD;
        });
        set(() => {
            run_panel.is_stop_button_visible = true;
        });
        set(() => {
            dashboard.active_tab = DBOT_TABS.DTRADER;
        });
        const frame_window = getFrame(container).contentWindow as Window;
        const postMessage = jest.spyOn(frame_window, 'postMessage').mockImplementation(() => undefined);
        act(() => {
            window.dispatchEvent(
                new MessageEvent('message', {
                    origin: DTRADER_ORIGIN,
                    source: frame_window,
                    data: { type: 'ct:ready' },
                })
            );
        });
        expect(postMessage).toHaveBeenCalledWith({ type: 'ct:session', session: null }, DTRADER_ORIGIN);
    });
});

describe('DTraderPanel - loading state', () => {
    it('shows a light loading state until the frame says ct:ready', () => {
        const { container } = renderPanel();
        expect(container.querySelector('.dtrader-panel__loading')).toHaveTextContent('Loading DTrader');

        const frame_window = getFrame(container).contentWindow as Window;
        jest.spyOn(frame_window, 'postMessage').mockImplementation(() => undefined);
        act(() => {
            window.dispatchEvent(
                new MessageEvent('message', {
                    origin: DTRADER_ORIGIN,
                    source: frame_window,
                    data: { type: 'ct:ready' },
                })
            );
        });
        expect(container.querySelector('.dtrader-panel__loading')).toBeNull();
    });

    it("hides it on the frame's load event too", () => {
        const { container } = renderPanel();
        act(() => {
            getFrame(container).dispatchEvent(new Event('load'));
        });
        expect(container.querySelector('.dtrader-panel__loading')).toBeNull();
    });

    it("marks DTrader's bottom bar for the AI Scanner button", () => {
        const { container } = renderPanel();
        expect(container.querySelector('.dtrader-panel__bottom-bar-guard')).toBeInTheDocument();
    });
});
