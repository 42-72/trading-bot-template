import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import UnhandledErrorModal from '../unhandled-error-modal';

// jsdom 26 locks window.location (reload can't be replaced or spied on). Its reload()
// reports "Not implemented: navigation" to the console instead, so that is the signal.
const spyOnPageReload = () => jest.spyOn(console, 'error').mockImplementation(() => {});
const reloadWasCalled = (console_error: jest.SpyInstance) =>
    console_error.mock.calls.some(([error]) => String(error?.message ?? error).includes('Not implemented: navigation'));

describe('<UnhandledErrorModal />', () => {
    let modal_root_el: HTMLDivElement;

    beforeAll(() => {
        modal_root_el = document.createElement('div');
        modal_root_el.setAttribute('id', 'modal_root');
        document.body.appendChild(modal_root_el);
    });

    afterAll(() => {
        document.body.removeChild(modal_root_el);
    });

    it('renders the component with proper messages', () => {
        jest.spyOn(React, 'useState').mockImplementationOnce(() => React.useState<boolean>(true));
        render(<UnhandledErrorModal />);
        expect(screen.getByText(/Sorry for the interruption/i)).toBeInTheDocument();
        expect(screen.getByText(/Our servers hit a bump. Let’s refresh to move on./i)).toBeInTheDocument();
        expect(screen.getByText('Refresh')).toBeInTheDocument();
    });

    it('should call reload function when refresh button is clicked', () => {
        jest.spyOn(React, 'useState').mockImplementationOnce(() => React.useState<boolean>(true));
        const console_error = spyOnPageReload();
        render(<UnhandledErrorModal />);
        fireEvent.click(screen.getByText('Refresh'));
        expect(reloadWasCalled(console_error)).toBe(true);
        console_error.mockRestore();
    });
});
