// Removed unused React import - React 17+ JSX transform doesn't require it
import { render, screen } from '@testing-library/react';
import ErrorModalContent from '../error-modal-content';

// jsdom 26 locks window.location (reload can't be replaced or spied on). Its reload()
// reports "Not implemented: navigation" to the console instead, so that is the signal.
const spyOnPageReload = () => jest.spyOn(console, 'error').mockImplementation(() => {});
const reloadWasCalled = (console_error: jest.SpyInstance) =>
    console_error.mock.calls.some(([error]) => String(error?.message ?? error).includes('Not implemented: navigation'));

describe('<ErrorModalContent />', () => {
    let modal_root_el: HTMLDivElement;

    beforeAll(() => {
        modal_root_el = document.createElement('div');
        modal_root_el.setAttribute('id', 'modal_root');
        document.body.appendChild(modal_root_el);
    });

    afterAll(() => {
        document.body.removeChild(modal_root_el);
    });
    const error_message = 'You have reached the rate limit of requests per second. Please try later.';
    it('should renders the error message', () => {
        render(<ErrorModalContent error_message={error_message} />);
        const error_description = screen.getByText(
            /You have reached the rate limit of requests per second. Please try later./i
        );
        expect(error_description).toBeInTheDocument();
    });

    it('renders the error message', () => {
        render(<ErrorModalContent error_message={error_message} />);
        const error_description = screen.getByText(
            /You have reached the rate limit of requests per second. Please try later./i
        );
        expect(error_description).toHaveClass('dc-text', 'da-icon-with-message__text__desc');
    });

    it('should renders the refresh button', () => {
        render(<ErrorModalContent error_message={error_message} />);
        const refresh_button = screen.getByText(/Refresh/i);
        expect(refresh_button).toBeInTheDocument();
    });

    it('should reload the page when the Refresh button is clicked', () => {
        render(<ErrorModalContent error_message={error_message} />);
        const refresh_button = screen.getByRole('button', { name: /Refresh/i });
        const console_error = spyOnPageReload();
        refresh_button.click();
        expect(reloadWasCalled(console_error)).toBe(true);
        console_error.mockRestore();
    });
});
