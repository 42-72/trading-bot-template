import { session_status } from '@/utils/session-status';
import { act, render, screen } from '@testing-library/react';
import BlocklyLoading from '..';

let mock_store = { blockly_store: { is_loading: true } };

jest.mock('@/hooks/useStore', () => ({ useStore: () => mock_store }));
jest.mock('@deriv-com/ui', () => ({ Loader: () => null }));

describe('BlocklyLoading', () => {
    beforeEach(() => {
        mock_store = { blockly_store: { is_loading: true } };
        session_status.setLandingShown(false);
    });

    it('shows in the app while Blockly loads', () => {
        render(<BlocklyLoading />);
        expect(screen.getByTestId('blockly-loader')).toBeInTheDocument();
    });

    it('stays off the landing page, then shows if Blockly is still loading once the visitor is in', () => {
        session_status.setLandingShown(true);
        render(<BlocklyLoading />);
        expect(screen.queryByTestId('blockly-loader')).not.toBeInTheDocument();

        act(() => session_status.setLandingShown(false));
        expect(screen.getByTestId('blockly-loader')).toBeInTheDocument();
    });

    it('shows nothing once Blockly is ready', () => {
        mock_store = { blockly_store: { is_loading: false } };
        render(<BlocklyLoading />);
        expect(screen.queryByTestId('blockly-loader')).not.toBeInTheDocument();
    });
});
