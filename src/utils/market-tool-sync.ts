import { ApiHelpers } from '@/external/bot-skeleton';
import { config } from '@/external/bot-skeleton/constants/config';
import { MARKET_TOOL_SUBMARKETS } from '@/hooks/useSyntheticSymbols';
import { fetchAvailableContracts, TAvailableContract } from '@/utils/ai-scanner-offered';

// One-way sync: Market Tool's symbol select drives the Bot Builder's
// trade_definition_market block. Never the other way round - the block's own
// SYMBOL_LIST change only feeds the chart (dashboard-store setBotBuilderSymbol).

export const MARKET_TOOL_SYMBOL_KEY = 'market_tool_symbol';

export type TSyncResult =
    | 'synced'
    | 'bot-live' // rule 1: bot running or a contract still open
    | 'ai-scanner' // rule 1b: the AI Scanner's engine is in the workspace for a run
    | 'no-workspace'
    | 'no-block'
    | 'multiple-blocks'
    | 'not-ours' // rule 2: the strategy's current symbol isn't one Market Tool offers
    | 'unchanged'
    | 'unknown-symbol'
    | 'rejected';

type TDropdown = {
    getValue: () => string;
    setValue: (value: string) => void;
    // The same private option store the codebase's own FieldDropdown.updateOptions
    // writes (bot-skeleton/scratch/hooks/field.js).
    menuGenerator_: unknown;
};

type TBlock = {
    type: string;
    disabled?: boolean;
    getRootBlock: () => { type: string } | null;
    getField: (name: string) => TDropdown | null;
    getFieldValue?: (name: string) => string | null;
    getInputTargetBlock?: (name: string) => TBlock | null;
};

type TSymbolInfo = { market: string; submarket: string; symbol: string };

type TActiveSymbols = {
    getAllSymbols: () => TSymbolInfo[];
    getSubmarketDropdownOptions: (market: string) => unknown;
    getSymbolDropdownOptions: (submarket: string) => unknown;
};

type TBlocklyGlobal = {
    derivWorkspace?: { getAllBlocks: (ordered: boolean) => TBlock[] };
    Events: { getGroup: () => string; setGroup: (group: string | boolean) => void };
};

export const readStoredMarketToolSymbol = (): string | null => {
    try {
        return localStorage.getItem(MARKET_TOOL_SYMBOL_KEY);
    } catch {
        return null;
    }
};

export const storeMarketToolSymbol = (symbol: string) => {
    try {
        localStorage.setItem(MARKET_TOOL_SYMBOL_KEY, symbol);
    } catch {
        // Storage unavailable - the choice just won't survive a reload.
    }
};

/**
 * Point the Bot Builder's market block at `target`.
 *
 * Leaves the workspace alone when:
 *  - is_bot_live: a bot is running or a contract is still open (rule 1) -
 *    never switch the market under a live bot;
 *  - is_ai_scanner_active: the AI Scanner has loaded (or is loading) its
 *    engine for a run (rule 1b) - the market it picked is never overwritten;
 *  - the strategy's current symbol is not in `offered` (rule 2) - a forex or
 *    commodity strategy is never pulled onto a synthetic;
 *  - there is not exactly one enabled market block inside a trade_definition.
 *
 * Market, submarket, the symbol dropdown's options and the symbol are all
 * written in ONE Blockly event group, so it is a single undo step. The symbol
 * options are repopulated for the new submarket before the symbol is written,
 * because FieldDropdown rejects a value that isn't in its current options.
 * Blockly queues change events and fires them after this returns, so other
 * blocks' listeners only ever see the final, consistent state.
 */
type TSyncOptions = { is_bot_live: boolean; is_ai_scanner_active?: boolean; offered: string[] };

type TPreparedSync = {
    apply: () => TSyncResult;
    /** The trade_definition the market block sits in - the bot whose trade is checked. */
    root: { type: string };
    current_symbol: string;
};

// Every rule of the sync, without changing anything: either the result that
// stops it, or the write to make.
const prepareSync = (
    target: string,
    { is_bot_live, is_ai_scanner_active = false, offered }: TSyncOptions
): TSyncResult | TPreparedSync => {
    if (is_bot_live) return 'bot-live';
    if (is_ai_scanner_active) return 'ai-scanner';

    const Blockly = (window as unknown as { Blockly?: TBlocklyGlobal }).Blockly;
    const workspace = Blockly?.derivWorkspace;
    if (!Blockly || !workspace) return 'no-workspace';

    const blocks = workspace
        .getAllBlocks(false)
        .filter(
            block =>
                block.type === 'trade_definition_market' &&
                !block.disabled &&
                block.getRootBlock()?.type === 'trade_definition'
        );
    if (blocks.length === 0) return 'no-block';
    if (blocks.length > 1) return 'multiple-blocks';

    const [block] = blocks;
    const market_field = block.getField('MARKET_LIST');
    const submarket_field = block.getField('SUBMARKET_LIST');
    const symbol_field = block.getField('SYMBOL_LIST');
    if (!market_field || !submarket_field || !symbol_field) return 'no-block';

    if (!offered.includes(symbol_field.getValue())) return 'not-ours';
    if (symbol_field.getValue() === target) return 'unchanged';

    const active_symbols = (ApiHelpers?.instance as unknown as { active_symbols?: TActiveSymbols })?.active_symbols;
    const next = active_symbols?.getAllSymbols().find(info => info.symbol === target);
    if (!active_symbols || !next || !MARKET_TOOL_SUBMARKETS.includes(next.submarket) || !offered.includes(target)) {
        return 'unknown-symbol';
    }

    const apply = (): TSyncResult => {
        const previous_group = Blockly.Events.getGroup();
        Blockly.Events.setGroup(`market-tool-sync-${Date.now()}`);
        try {
            if (market_field.getValue() !== next.market) {
                market_field.setValue(next.market);
            }
            if (submarket_field.getValue() !== next.submarket) {
                submarket_field.menuGenerator_ = active_symbols.getSubmarketDropdownOptions(next.market);
                submarket_field.setValue(next.submarket);
            }
            symbol_field.menuGenerator_ = active_symbols.getSymbolDropdownOptions(next.submarket);
            symbol_field.setValue(next.symbol);
        } finally {
            Blockly.Events.setGroup(previous_group || false);
        }

        return symbol_field.getValue() === next.symbol ? 'synced' : 'rejected';
    };

    return { apply, root: block.getRootBlock() as { type: string }, current_symbol: symbol_field.getValue() };
};

/**
 * Point the Bot Builder's market block at `target`.
 *
 * Leaves the workspace alone when:
 *  - is_bot_live: a bot is running or a contract is still open (rule 1) -
 *    never switch the market under a live bot;
 *  - is_ai_scanner_active: the AI Scanner has loaded (or is loading) its
 *    engine for a run (rule 1b) - the market it picked is never overwritten;
 *  - the strategy's current symbol is not in `offered` (rule 2) - a forex or
 *    commodity strategy is never pulled onto a synthetic;
 *  - there is not exactly one enabled market block inside a trade_definition.
 *
 * Market, submarket, the symbol dropdown's options and the symbol are all
 * written in ONE Blockly event group, so it is a single undo step. The symbol
 * options are repopulated for the new submarket before the symbol is written,
 * because FieldDropdown rejects a value that isn't in its current options.
 * Blockly queues change events and fires them after this returns, so other
 * blocks' listeners only ever see the final, consistent state.
 *
 * Market Tool calls syncBotBuilderSymbolIfOffered, which also checks the new
 * market offers the bot's trade first.
 */
export const syncBotBuilderSymbol = (target: string, options: TSyncOptions): TSyncResult => {
    const prepared = prepareSync(target, options);
    return typeof prepared === 'string' ? prepared : prepared.apply();
};

// ---- Rule 3: the new market must offer the bot's trade ---------------------
//
// Moving a bot onto a market that doesn't offer its contracts (Jump 100 with
// no digit contracts, say) makes Bot Builder refill the trade-type dropdown
// from that market's offerings - and FieldDropdown falls back to the first
// option (hooks/field.js) - silently turning the bot into another bot. So
// before syncing, contracts_for (the AI Scanner's own check,
// ai-scanner-offered.ts) must offer each of the bot's current contract types
// at the bot's current duration.

export type TBotDuration = { unit: string; amount: number | null };
export type TBotTrade = { contract_types: string[]; duration: TBotDuration | null };

const NUMBER_BLOCKS = ['math_number', 'math_number_positive'];
// Trade option blocks with a duration; multiplier and accumulator have none.
const DURATION_OPTIONS_BLOCK = 'trade_definition_tradeoptions';

/** The contract types and duration the bot in `root` trades now, read from its blocks. null when unreadable. */
export const readBotTrade = (blocks: TBlock[], root: { type: string }): TBotTrade | null => {
    const own = blocks.filter(block => block.getRootBlock() === root && !block.disabled);
    const field = (type: string, name: string) => own.find(block => block.type === type)?.getFieldValue?.(name) ?? null;

    const trade_type = field('trade_definition_tradetype', 'TRADETYPE_LIST');
    const opposites = (config() as unknown as { opposites: Record<string, Record<string, string>[]> }).opposites;
    const all_types = trade_type ? (opposites[trade_type.toUpperCase()] ?? []).flatMap(Object.keys) : [];
    if (all_types.length === 0) return null;

    const chosen = field('trade_definition_contracttype', 'TYPE_LIST');
    const contract_types = !chosen || chosen === 'both' ? all_types : all_types.filter(type => type === chosen);
    if (contract_types.length === 0) return null;

    const options_block = own.find(block => block.type === DURATION_OPTIONS_BLOCK);
    if (!options_block) return { contract_types, duration: null };
    const unit = options_block.getFieldValue?.('DURATIONTYPE_LIST');
    if (!unit) return null;
    const duration_block = options_block.getInputTargetBlock?.('DURATION');
    const amount =
        duration_block && NUMBER_BLOCKS.includes(duration_block.type)
            ? Number(duration_block.getFieldValue?.('NUM'))
            : NaN;
    return { contract_types, duration: { unit, amount: Number.isFinite(amount) ? amount : null } };
};

const SECONDS_PER_UNIT: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

// Ticks are shorter than any time duration: [0, ticks] < [1, seconds].
const toPoint = (amount: number, unit: string): [number, number] | null => {
    if (unit === 't') return [0, amount];
    return unit in SECONDS_PER_UNIT ? [1, amount * SECONDS_PER_UNIT[unit]] : null;
};
const parsePoint = (duration?: string) => {
    const match = /^(\d+)([tsmhd])$/.exec(duration ?? '');
    return match ? toPoint(Number(match[1]), match[2]) : null;
};
const atMost = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);

const fitsDuration = (contract: TAvailableContract, duration: TBotDuration | null) => {
    if (!duration) return true;
    const min = parsePoint(contract.min_contract_duration);
    const max = parsePoint(contract.max_contract_duration);
    if (!min || !max) return false;
    if (duration.amount === null) {
        // A duration from a variable: the contract must at least take this unit.
        return duration.unit === 't' ? min[0] === 0 : max[0] === 1;
    }
    const point = toPoint(duration.amount, duration.unit);
    return !!point && atMost(min, point) && atMost(point, max);
};

/** Every one of the bot's contract types is offered at the bot's duration. */
export const offersBotTrade = (available: TAvailableContract[], trade: TBotTrade) =>
    trade.contract_types.every(type =>
        available.some(contract => contract.contract_type === type && fitsDuration(contract, trade.duration))
    );

/** Shown when rule 3 keeps the bot where it is. */
export const notOfferedNotice = (target_name: string, current_name: string) =>
    `${target_name} doesn't offer this bot's trade, so your bot stays on ${current_name}.`;

export type TCheckedSyncResult =
    | TSyncResult
    | 'not-offered' // rule 3: the new market doesn't offer the bot's trade
    | 'check-failed' // rule 3 couldn't be checked (contracts_for error / timeout, unreadable bot)
    | 'superseded'; // another symbol was picked while this one was being checked

/**
 * The sync Market Tool uses: every rule of syncBotBuilderSymbol, plus rule 3.
 * When the new market doesn't offer the bot's trade - or that can't be
 * checked - the bot is left exactly as it is. `getOptions` is read before
 * and again after the check, so a bot started meanwhile is never touched.
 * `current_symbol` is the bot's market, for the notice.
 */
export const syncBotBuilderSymbolIfOffered = async (
    target: string,
    getOptions: () => TSyncOptions & { is_stale?: () => boolean },
    fetchContracts: (symbol: string) => Promise<TAvailableContract[]> = fetchAvailableContracts
): Promise<{ result: TCheckedSyncResult; current_symbol?: string }> => {
    const prepared = prepareSync(target, getOptions());
    if (typeof prepared === 'string') return { result: prepared };
    const { current_symbol, root } = prepared;

    const Blockly = (window as unknown as { Blockly?: TBlocklyGlobal }).Blockly;
    const trade = readBotTrade(Blockly?.derivWorkspace?.getAllBlocks(false) ?? [], root);
    if (!trade) return { result: 'check-failed', current_symbol };

    let available: TAvailableContract[];
    try {
        available = await fetchContracts(target);
    } catch {
        return { result: 'check-failed', current_symbol };
    }
    if (!offersBotTrade(available, trade)) return { result: 'not-offered', current_symbol };

    const options = getOptions();
    if (options.is_stale?.()) return { result: 'superseded', current_symbol };
    return { result: syncBotBuilderSymbol(target, options), current_symbol };
};
