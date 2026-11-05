import { AI_EXCLUDED_MARKET_MESSAGE, AI_SCANNER_EXCLUDED_SYMBOLS, isAiScannerSymbol } from '@/constants/ai-engine';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { filterOfferedMarkets } from '../ai-scanner-offered';
import { checkAiScannerBuy, setAiScannerTrade } from '../ai-scanner-trade-guard';
import { isAiEngineRun } from '../trade-log';

jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({ api_base: { api: null } }));
jest.mock('../trade-log', () => ({ isAiEngineRun: jest.fn(), describeTrade: () => 'trade' }));

// Every trade type, present or future: the exclusion is by market, not by contract.
const TRADE_TYPES: Record<string, string[]> = {
    'Even/Odd': ['DIGITEVEN', 'DIGITODD'],
    'Over/Under': ['DIGITOVER', 'DIGITUNDER'],
    'Matches/Differs': ['DIGITMATCH', 'DIGITDIFF'],
    'Rise/Fall': ['CALL', 'PUT'],
};
const EVERY_CONTRACT = Object.values(TRADE_TYPES)
    .flat()
    .map(contract_type => ({ contract_type, min_contract_duration: '1t', max_contract_duration: '10t' }));

const JUMPS = ['JD10', 'JD25', 'JD50', 'JD75', 'JD100'].map(symbol => ({ symbol }));

describe('markets the AI never touches', () => {
    let send: jest.Mock;

    beforeEach(() => {
        send = jest.fn(async () => ({ contracts_for: { available: EVERY_CONTRACT } }));
        (api_base as unknown as { api: unknown }).api = { send };
        (isAiEngineRun as jest.Mock).mockReturnValue(true);
        setAiScannerTrade(null);
    });

    it('lists Jump 100 in the one excluded list', () => {
        expect(AI_SCANNER_EXCLUDED_SYMBOLS).toContain('JD100');
    });

    it('never puts Jump 100 in the market list, and keeps the other Jump indices', () => {
        expect(isAiScannerSymbol('JD100', 'jump_index')).toBe(false);
        ['JD10', 'JD25', 'JD50', 'JD75'].forEach(symbol => expect(isAiScannerSymbol(symbol, 'jump_index')).toBe(true));
        expect(isAiScannerSymbol('1HZ100V', 'random_index')).toBe(true);
    });

    describe.each(Object.entries(TRADE_TYPES))('%s', (_, contract_types) => {
        it('never asks about Jump 100, even when Deriv offers the trade on it', async () => {
            const offered = await filterOfferedMarkets(JUMPS, contract_types);
            expect(offered.map(market => market.symbol)).toEqual(['JD10', 'JD25', 'JD50', 'JD75']);
            expect(send).toHaveBeenCalledTimes(4);
            expect(send).not.toHaveBeenCalledWith({ contracts_for: 'JD100' });
        });

        it.each(contract_types)('an AI engine never buys %s on Jump 100', contract_type => {
            const buy = { parameters: { contract_type, underlying_symbol: 'JD100' } };
            expect(checkAiScannerBuy(buy)).toBe(AI_EXCLUDED_MARKET_MESSAGE);
            // Not even when an old locked trade says Jump 100.
            setAiScannerTrade({ symbol: 'JD100', contract_types: [contract_type], barriers: [] });
            expect(checkAiScannerBuy(buy)).toBe(AI_EXCLUDED_MARKET_MESSAGE);
        });

        it.each(contract_types)('a manual bot still buys %s on Jump 100', contract_type => {
            (isAiEngineRun as jest.Mock).mockReturnValue(false);
            expect(checkAiScannerBuy({ parameters: { contract_type, underlying_symbol: 'JD100' } })).toBeNull();
        });
    });
});
