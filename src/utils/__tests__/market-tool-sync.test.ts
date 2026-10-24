import { ApiHelpers } from '@/external/bot-skeleton';
import { TAvailableContract } from '@/utils/ai-scanner-offered';
import {
    notOfferedNotice,
    offersBotTrade,
    readBotTrade,
    syncBotBuilderSymbol,
    syncBotBuilderSymbolIfOffered,
} from '../market-tool-sync';

jest.mock('@/external/bot-skeleton', () => ({ ApiHelpers: { instance: null } }));

const OVER_UNDER = ['DIGITOVER', 'DIGITUNDER'];
const digits = (types: string[], min = '1t', max = '10t'): TAvailableContract[] =>
    types.map(contract_type => ({ contract_type, min_contract_duration: min, max_contract_duration: max }));
const ALL_DIGITS = digits(['DIGITMATCH', 'DIGITDIFF', 'DIGITODD', 'DIGITEVEN', 'DIGITOVER', 'DIGITUNDER']);
// Jump 100 as contracts_for returns it today: no digit contracts.
const JD100: TAvailableContract[] = [
    { contract_type: 'CALL', min_contract_duration: '1t', max_contract_duration: '365d' },
    { contract_type: 'PUT', min_contract_duration: '1t', max_contract_duration: '365d' },
];

const SYMBOLS = [
    { market: 'synthetic_index', submarket: 'random_index', symbol: '1HZ50V' },
    { market: 'synthetic_index', submarket: 'jump_index', symbol: 'JD25' },
    { market: 'synthetic_index', submarket: 'jump_index', symbol: 'JD100' },
];
const OFFERED = SYMBOLS.map(info => info.symbol);

const dropdown = (initial: string) => {
    const field = {
        value: initial,
        getValue: () => field.value,
        setValue: jest.fn((next: string) => {
            field.value = next;
        }),
        menuGenerator_: [] as unknown,
    };
    return field;
};

type TBotSetup = {
    trade_type?: string;
    type_list?: string;
    duration_unit?: string;
    duration?: { type: string; num: string } | null;
};

/** A Diamonds-like bot: digits / over-under / both directions, 1 tick, on 1HZ50V. */
const makeBot = ({
    trade_type = 'overunder',
    type_list = 'both',
    duration_unit = 't',
    duration = { type: 'math_number_positive', num: '1' },
}: TBotSetup = {}) => {
    const root = { type: 'trade_definition' };
    const fields: Record<string, ReturnType<typeof dropdown>> = {
        MARKET_LIST: dropdown('synthetic_index'),
        SUBMARKET_LIST: dropdown('random_index'),
        SYMBOL_LIST: dropdown('1HZ50V'),
    };
    const block = (type: string, values: Record<string, string> = {}, inputs: Record<string, unknown> = {}) => ({
        type,
        getRootBlock: () => root,
        getField: (name: string) => fields[name] ?? null,
        getFieldValue: (name: string) => values[name] ?? null,
        getInputTargetBlock: (name: string) => inputs[name] ?? null,
    });
    const duration_block = duration && { type: duration.type, getFieldValue: () => duration.num };
    const blocks = [
        block('trade_definition_market'),
        block('trade_definition_tradetype', { TRADETYPECAT_LIST: 'digits', TRADETYPE_LIST: trade_type }),
        block('trade_definition_contracttype', { TYPE_LIST: type_list }),
        block('trade_definition_tradeoptions', { DURATIONTYPE_LIST: duration_unit }, { DURATION: duration_block }),
    ];
    (window as unknown as { Blockly: unknown }).Blockly = {
        derivWorkspace: { getAllBlocks: () => blocks },
        Events: { getGroup: () => '', setGroup: jest.fn() },
    };
    return { root, fields, blocks };
};

const options =
    (extra: Record<string, unknown> = {}) =>
    () => ({ is_bot_live: false, offered: OFFERED, ...extra });

const untouched = (fields: Record<string, ReturnType<typeof dropdown>>) => {
    Object.values(fields).forEach(field => expect(field.setValue).not.toHaveBeenCalled());
    expect(fields.SYMBOL_LIST.getValue()).toBe('1HZ50V');
};

describe('syncBotBuilderSymbol', () => {
    beforeEach(() => {
        (ApiHelpers as unknown as { instance: unknown }).instance = {
            active_symbols: {
                getAllSymbols: () => SYMBOLS,
                getSubmarketDropdownOptions: () => [['Jump', 'jump_index']],
                getSymbolDropdownOptions: () => [],
            },
        };
    });

    it('never overwrites the market while the AI Scanner owns the workspace', () => {
        const getAllBlocks = jest.fn(() => []);
        (window as unknown as { Blockly: unknown }).Blockly = {
            derivWorkspace: { getAllBlocks },
            Events: { getGroup: () => '', setGroup: jest.fn() },
        };
        expect(
            syncBotBuilderSymbol('1HZ25V', { is_bot_live: false, is_ai_scanner_active: true, offered: ['1HZ25V'] })
        ).toBe('ai-scanner');
        expect(getAllBlocks).not.toHaveBeenCalled();
        // Without the scanner, the sync goes on to look at the workspace as before.
        syncBotBuilderSymbol('1HZ25V', { is_bot_live: false, offered: ['1HZ25V'] });
        expect(getAllBlocks).toHaveBeenCalled();
    });

    describe('rule 3: only onto a market that offers the bot trade', () => {
        it('offered -> syncs as before', async () => {
            const { fields } = makeBot();
            const fetch = jest.fn(async () => ALL_DIGITS);
            const outcome = await syncBotBuilderSymbolIfOffered('JD25', options(), fetch);
            expect(fetch).toHaveBeenCalledWith('JD25');
            expect(outcome).toEqual({ result: 'synced', current_symbol: '1HZ50V' });
            expect(fields.SYMBOL_LIST.getValue()).toBe('JD25');
            expect(fields.SUBMARKET_LIST.getValue()).toBe('jump_index');
        });

        it('not offered (Jump 100, no digits) -> bot untouched, with the notice', async () => {
            const { fields } = makeBot();
            const outcome = await syncBotBuilderSymbolIfOffered('JD100', options(), async () => JD100);
            expect(outcome).toEqual({ result: 'not-offered', current_symbol: '1HZ50V' });
            untouched(fields);
            expect(notOfferedNotice('Jump 100 Index', 'Volatility 50 (1s) Index')).toBe(
                "Jump 100 Index doesn't offer this bot's trade, so your bot stays on Volatility 50 (1s) Index."
            );
        });

        it('contracts_for error or timeout -> bot untouched', async () => {
            const { fields } = makeBot();
            const outcome = await syncBotBuilderSymbolIfOffered('JD25', options(), async () => {
                throw new Error('contracts_for timed out');
            });
            expect(outcome).toEqual({ result: 'check-failed', current_symbol: '1HZ50V' });
            untouched(fields);
        });

        it('needs every one of the bot contract types', async () => {
            const { fields } = makeBot();
            const only_over = async () => digits(['DIGITOVER']);
            expect((await syncBotBuilderSymbolIfOffered('JD25', options(), only_over)).result).toBe('not-offered');
            untouched(fields);
            // A bot set to buy only DIGITOVER is fine there.
            makeBot({ type_list: 'DIGITOVER' });
            expect((await syncBotBuilderSymbolIfOffered('JD25', options(), only_over)).result).toBe('synced');
        });

        it('checks the bot duration too', async () => {
            makeBot({ duration: { type: 'math_number', num: '5' } });
            const short = async () => digits(OVER_UNDER, '1t', '3t');
            expect((await syncBotBuilderSymbolIfOffered('JD25', options(), short)).result).toBe('not-offered');
            makeBot({ duration: { type: 'math_number', num: '5' } });
            expect((await syncBotBuilderSymbolIfOffered('JD25', options(), async () => ALL_DIGITS)).result).toBe(
                'synced'
            );
        });

        it('a bot started while the market was being checked is never touched', async () => {
            const { fields } = makeBot();
            let live = false;
            const outcome = await syncBotBuilderSymbolIfOffered(
                'JD25',
                () => ({ is_bot_live: live, offered: OFFERED }),
                async () => {
                    live = true;
                    return ALL_DIGITS;
                }
            );
            expect(outcome.result).toBe('bot-live');
            untouched(fields);
        });

        it('a later pick in the meantime wins: this one does not apply', async () => {
            const { fields } = makeBot();
            const outcome = await syncBotBuilderSymbolIfOffered(
                'JD25',
                options({ is_stale: () => true }),
                async () => ALL_DIGITS
            );
            expect(outcome.result).toBe('superseded');
            untouched(fields);
        });

        it('the other rules still come first: no contracts_for while a bot runs', async () => {
            makeBot();
            const fetch = jest.fn(async () => ALL_DIGITS);
            const outcome = await syncBotBuilderSymbolIfOffered('JD25', options({ is_bot_live: true }), fetch);
            expect(outcome.result).toBe('bot-live');
            expect(fetch).not.toHaveBeenCalled();
        });
    });
});

describe('readBotTrade / offersBotTrade', () => {
    it('reads the bot contract types and duration from its blocks', () => {
        const { blocks, root } = makeBot();
        expect(readBotTrade(blocks as never, root)).toEqual({
            contract_types: ['DIGITOVER', 'DIGITUNDER'],
            duration: { unit: 't', amount: 1 },
        });
    });

    it('a duration from a variable: the contract must take that unit', () => {
        const { blocks, root } = makeBot({ duration: { type: 'variables_get', num: '' } });
        const trade = readBotTrade(blocks as never, root);
        expect(trade?.duration).toEqual({ unit: 't', amount: null });
        if (!trade) return;
        expect(offersBotTrade(ALL_DIGITS, trade)).toBe(true);
        expect(offersBotTrade(digits(OVER_UNDER, '15s', '1d'), trade)).toBe(false);
    });

    it('compares time durations across units', () => {
        const trade = { contract_types: ['CALL'], duration: { unit: 'm', amount: 5 } };
        const call = (min: string, max: string) => [
            { contract_type: 'CALL', min_contract_duration: min, max_contract_duration: max },
        ];
        expect(offersBotTrade(call('1t', '1d'), trade)).toBe(true);
        expect(offersBotTrade(call('15s', '2m'), trade)).toBe(false);
    });

    it('an unknown trade type is unreadable (so the sync never guesses)', () => {
        const { blocks, root } = makeBot({ trade_type: 'nosuchtype' });
        expect(readBotTrade(blocks as never, root)).toBeNull();
    });
});
