import { ApiHelpers } from '@/external/bot-skeleton';
import { MARKET_TOOL_SUBMARKETS } from '@/hooks/useSyntheticSymbols';

// One-way sync: Market Tool's symbol select drives the Bot Builder's
// trade_definition_market block. Never the other way round - the block's own
// SYMBOL_LIST change only feeds the chart (dashboard-store setBotBuilderSymbol).

export const MARKET_TOOL_SYMBOL_KEY = 'market_tool_symbol';

export type TSyncResult =
    | 'synced'
    | 'bot-live' // rule 1: bot running or a contract still open
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

type TMarketBlock = {
    type: string;
    disabled?: boolean;
    getRootBlock: () => { type: string } | null;
    getField: (name: string) => TDropdown | null;
};

type TSymbolInfo = { market: string; submarket: string; symbol: string };

type TActiveSymbols = {
    getAllSymbols: () => TSymbolInfo[];
    getSubmarketDropdownOptions: (market: string) => unknown;
    getSymbolDropdownOptions: (submarket: string) => unknown;
};

type TBlocklyGlobal = {
    derivWorkspace?: { getAllBlocks: (ordered: boolean) => TMarketBlock[] };
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
export const syncBotBuilderSymbol = (
    target: string,
    { is_bot_live, offered }: { is_bot_live: boolean; offered: string[] }
): TSyncResult => {
    if (is_bot_live) return 'bot-live';

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
