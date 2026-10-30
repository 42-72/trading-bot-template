import { act, render } from '@testing-library/react';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { DTRADER_EMBED_URL, DTRADER_ORIGIN } from '@/utils/dtrader-embed';
import DTraderPanel from '..';

jest.mock('@/hooks/useStore', () => ({ useStore: jest.fn() }));
jest.mock('@/components/shared', () => ({ generateOAuthURL: jest.fn() }));

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
