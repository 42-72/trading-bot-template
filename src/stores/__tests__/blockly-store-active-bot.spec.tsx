import { observable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { act, render, screen } from '@testing-library/react';
import BlocklyStore from '../blockly-store';

jest.mock('@/external/bot-skeleton', () => ({
    getSavedWorkspaces: jest.fn().mockResolvedValue([]),
    onWorkspaceResize: jest.fn(),
}));

// The desktop Run bar stays mounted for the whole session, so what it reads
// must not freeze at its first value: a cached value is what left Run disabled
// on every tab after a bot had loaded. The workspace isn't observable; the bar
// re-reads it whenever it renders, which it does on every tab change.
describe('BlocklyStore.hasWorkspaceBlocks under a component that never unmounts', () => {
    const blockly = window as unknown as { Blockly?: { derivWorkspace?: { getTopBlocks: () => unknown[] } } };
    afterEach(() => {
        delete blockly.Blockly;
    });

    it('sees a workspace that loaded after the first render', () => {
        const store = new BlocklyStore({} as never);
        const dashboard = observable({ active_tab: 0 });
        const Bar = observer(() => (
            <div>
                {dashboard.active_tab}:{store.hasWorkspaceBlocks() ? 'has bot' : 'no bot'}
            </div>
        ));
        render(<Bar />);
        expect(screen.getByText('0:no bot')).toBeInTheDocument();

        blockly.Blockly = { derivWorkspace: { getTopBlocks: () => [{}] } };
        act(() => runInAction(() => (dashboard.active_tab = 3)));
        expect(screen.getByText('3:has bot')).toBeInTheDocument();
    });

    it('has_active_bot, which phones and tablets still read, gives the same answer when read fresh', () => {
        const store = new BlocklyStore({} as never);
        expect(store.has_active_bot).toBe(false);
        blockly.Blockly = { derivWorkspace: { getTopBlocks: () => [{}] } };
        expect(store.has_active_bot).toBe(true);
    });
});
