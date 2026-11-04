import { observable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { act, render, screen } from '@testing-library/react';
import BlocklyStore from '../blockly-store';

jest.mock('@/external/bot-skeleton', () => ({
    getSavedWorkspaces: jest.fn().mockResolvedValue([]),
    onWorkspaceResize: jest.fn(),
}));

// The Run bar stays mounted, so what it reads must not freeze at its first
// value: a cached value is what left Run disabled with "no bot yet" after a bot
// had loaded. The workspace isn't observable; the bar re-reads it whenever it
// renders, which it does on every tab change.
describe('BlocklyStore.has_active_bot under a component that never unmounts', () => {
    const blockly = window as unknown as { Blockly?: { derivWorkspace?: { getTopBlocks: () => unknown[] } } };
    afterEach(() => {
        delete blockly.Blockly;
    });

    it('sees a workspace that loaded after the first render', () => {
        const store = new BlocklyStore({} as never);
        const dashboard = observable({ active_tab: 0 });
        const Bar = observer(() => (
            <div>
                {dashboard.active_tab}:{store.has_active_bot ? 'has bot' : 'no bot'}
            </div>
        ));
        render(<Bar />);
        expect(screen.getByText('0:no bot')).toBeInTheDocument();

        blockly.Blockly = { derivWorkspace: { getTopBlocks: () => [{}] } };
        act(() => runInAction(() => (dashboard.active_tab = 3)));
        expect(screen.getByText('3:has bot')).toBeInTheDocument();
    });

    it('notices a workspace finishing its load without any tab change', () => {
        const store = new BlocklyStore({} as never);
        const Bar = observer(() => <div>{store.has_active_bot ? 'has bot' : 'no bot'}</div>);
        store.setLoading(true);
        render(<Bar />);
        expect(screen.getByText('no bot')).toBeInTheDocument();

        blockly.Blockly = { derivWorkspace: { getTopBlocks: () => [{}] } };
        act(() => store.setLoading(false));
        expect(screen.getByText('has bot')).toBeInTheDocument();
    });
});
