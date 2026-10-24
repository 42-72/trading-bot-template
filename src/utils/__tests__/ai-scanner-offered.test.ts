import { filterOfferedMarkets, offersTrade, TAvailableContract } from '../ai-scanner-offered';

jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({ api_base: { api: null } }));

// Import after mocking
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

const OVER_UNDER = ['DIGITOVER', 'DIGITUNDER'];
const EVEN_ODD = ['DIGITEVEN', 'DIGITODD'];

const digits = (types: string[], min = '1t', max = '10t'): TAvailableContract[] =>
    types.map(contract_type => ({ contract_type, min_contract_duration: min, max_contract_duration: max }));
const ALL_DIGITS = digits(['DIGITMATCH', 'DIGITDIFF', 'DIGITODD', 'DIGITEVEN', 'DIGITOVER', 'DIGITUNDER']);
// Jump 100 as contracts_for returned it: rise/fall and multipliers, no digits.
const NO_DIGITS: TAvailableContract[] = [
    { contract_type: 'CALL', min_contract_duration: '1t', max_contract_duration: '365d' },
    { contract_type: 'MULTUP', min_contract_duration: '', max_contract_duration: '' },
];

const MARKETS = [
    '1HZ10V',
    '1HZ15V',
    '1HZ25V',
    '1HZ30V',
    '1HZ50V',
    '1HZ75V',
    '1HZ90V',
    '1HZ100V',
    'JD10',
    'JD25',
    'JD50',
    'JD75',
    'JD100',
].map(symbol => ({ symbol, text: symbol }));

let send: jest.Mock;
const answer = (by_symbol: Record<string, TAvailableContract[] | Error>) => {
    send = jest.fn(async ({ contracts_for }: { contracts_for: string }) => {
        const reply = by_symbol[contracts_for] ?? ALL_DIGITS;
        if (reply instanceof Error) throw { error: { code: 'InternalServerError', message: reply.message } };
        return { msg_type: 'contracts_for', contracts_for: { available: reply } };
    });
    (api_base as unknown as { api: unknown }).api = { send };
};

describe('offersTrade', () => {
    it('needs every contract type of the tab with 1 tick inside min..max', () => {
        expect(offersTrade(ALL_DIGITS, OVER_UNDER)).toBe(true);
        expect(offersTrade(ALL_DIGITS, EVEN_ODD)).toBe(true);
        expect(offersTrade(digits(['DIGITOVER']), OVER_UNDER)).toBe(false); // no DIGITUNDER
        expect(offersTrade(digits(['DIGITEVEN', 'DIGITODD']), OVER_UNDER)).toBe(false);
        expect(offersTrade(digits(['DIGITOVER', 'DIGITUNDER'], '5t', '10t'), OVER_UNDER)).toBe(false);
        expect(offersTrade(digits(['DIGITOVER', 'DIGITUNDER'], '1d', '1d'), OVER_UNDER)).toBe(false);
        expect(offersTrade(NO_DIGITS, OVER_UNDER)).toBe(false);
        expect(offersTrade([], OVER_UNDER)).toBe(false);
    });
});

describe('filterOfferedMarkets', () => {
    afterEach(() => jest.useRealTimers());

    it('all 13 offered -> all 13 scanned, one contracts_for each', async () => {
        answer({});
        expect(await filterOfferedMarkets(MARKETS, OVER_UNDER)).toEqual(MARKETS);
        expect(send).toHaveBeenCalledTimes(13);
        expect(send).toHaveBeenCalledWith({ contracts_for: 'JD100' });
    });

    it('skips a market without DIGITOVER (Jump 100 today) - 12 scanned', async () => {
        answer({ JD100: NO_DIGITS, JD50: digits(['DIGITUNDER', 'DIGITEVEN', 'DIGITODD']) });
        const offered = await filterOfferedMarkets(MARKETS, OVER_UNDER);
        expect(offered.map(market => market.symbol)).not.toContain('JD100');
        expect(offered.map(market => market.symbol)).not.toContain('JD50');
        expect(offered).toHaveLength(11);
        // The Even/Odd tab only needs EVEN and ODD.
        expect(await filterOfferedMarkets(MARKETS, EVEN_ODD)).toHaveLength(12);
    });

    it('skips a market whose contracts_for errors', async () => {
        answer({ '1HZ30V': new Error('internal server error') });
        const offered = await filterOfferedMarkets(MARKETS, OVER_UNDER);
        expect(offered).toHaveLength(12);
        expect(offered.map(market => market.symbol)).not.toContain('1HZ30V');
    });

    it('skips a market whose contracts_for never replies (10s)', async () => {
        jest.useFakeTimers();
        answer({});
        send.mockImplementation(({ contracts_for }: { contracts_for: string }) =>
            contracts_for === 'JD10'
                ? new Promise(() => undefined)
                : Promise.resolve({ contracts_for: { available: ALL_DIGITS } })
        );
        const pending = filterOfferedMarkets(MARKETS, OVER_UNDER);
        await jest.advanceTimersByTimeAsync(10000);
        const offered = await pending;
        expect(offered).toHaveLength(12);
        expect(offered.map(market => market.symbol)).not.toContain('JD10');
    });

    it('nothing offered -> empty', async () => {
        answer(Object.fromEntries(MARKETS.map(market => [market.symbol, NO_DIGITS])));
        expect(await filterOfferedMarkets(MARKETS, OVER_UNDER)).toEqual([]);
    });
});
