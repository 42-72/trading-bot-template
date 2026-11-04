import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import MarketTool from '..';

jest.mock('@/hooks/useStore', () => ({ useStore: () => ({ run_panel: {}, ai_scanner: {} }) }));
jest.mock('@/hooks/useSyntheticSymbols', () => ({ useSyntheticSymbols: () => [] }));
jest.mock('@/hooks/useDigitAnalysis', () => ({
    useDigitAnalysis: () => ({
        digits: [],
        counts: Array(10).fill(0),
        directions: [],
        lastDigit: null,
        lastTickAt: null,
        currentQuote: null,
        pipSize: 2,
        n: 0,
        isLive: false,
        status: 'connecting',
        retry: jest.fn(),
    }),
}));
jest.mock('@/components/bot-notification/bot-notification', () => ({ botNotification: jest.fn() }));

describe('Market Tool title', () => {
    it('"Synthetic Analysis" is the first thing in the card, above the Synthetic index control', () => {
        render(<MarketTool />);
        const title = screen.getByRole('heading', { name: 'Synthetic Analysis' });
        expect(title.parentElement).toHaveClass('market-tool');
        expect(title.parentElement?.firstElementChild).toBe(title);
        expect(title.nextElementSibling).toContainElement(screen.getByLabelText('Synthetic index'));
    });

    it('is bold, in the blue of the selected digit', () => {
        const scss = fs.readFileSync(path.resolve(__dirname, '../market-tool.scss'), 'utf8');
        const blue = scss.match(/\.market-tool__quote-digit \{\s+color: (#[0-9a-f]+);/)?.[1];
        const title = scss.match(/\.market-tool__title \{[^}]*\}/)?.[0];
        expect(blue).toBe('#0f7bff');
        expect(title).toMatch(new RegExp(`color: ${blue};`));
        expect(title).toMatch(/font-weight: 700;/);
    });
});
