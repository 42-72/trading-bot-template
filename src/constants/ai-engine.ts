import evenOddEngineXml from '../assets/ai-engine/bull-ai-evenodd.xml';
import overUnderEngineXml from '../assets/ai-engine/bull-ai-overunder.xml';

// The AI Scanner's engine bots (src/assets/ai-engine/). Deliberately NOT in
// BOT_LIBRARY: Tbots never lists them, and they never go to Recent or reopen
// on startup (isAiEngineStrategyId, library-strategies.ts). The scanner writes
// the trader's locked values into a copy of the XML (ai-engine-xml.ts) and
// loads that - the bundled text itself is never edited.
export const AI_ENGINE_OVER_UNDER_XML: string = overUnderEngineXml;
export const AI_ENGINE_BOT_NAME = 'AI Scanner - Over/Under';
// Even/Odd: AI DIRECTION 1 buys DIGITEVEN, 0 buys DIGITODD; no barriers.
export const AI_ENGINE_EVEN_ODD_XML: string = evenOddEngineXml;
export const AI_ENGINE_EVEN_ODD_BOT_NAME = 'AI Scanner - Even/Odd';

// Variable names exactly as declared in the engine's <variables>. Values are
// written into the one variables_set for each name inside trade_definition's
// INITIALIZATION - found by name, never by searching the text for numbers.
export const ENGINE_VARIABLES = {
    ai_direction: 'AI DIRECTION',
    first_barrier: 'FIRST BARRIER',
    recovery_barrier: 'RECOVERY BARRIER',
    stake: 'Trade amount',
    stake_2: 'Trade amount 2',
    martingale: 'MARTINGALE',
    take_profit: 'Income Target',
    stop_loss: 'Loss value',
} as const;

export type TOverUnderStrategyId = 'over' | 'under';

export type TOverUnderSetup = {
    id: TOverUnderStrategyId;
    label: string;
    /** AI DIRECTION: 1 buys DIGITOVER, 0 buys DIGITUNDER. */
    ai_direction: 0 | 1;
    first_barrier: number;
    /** Used by the engine after a loss, until the next win. */
    recovery_barrier: number;
};

export const OVER_UNDER_SETUPS: Record<TOverUnderStrategyId, TOverUnderSetup> = {
    over: { id: 'over', label: 'Over', ai_direction: 1, first_barrier: 2, recovery_barrier: 3 },
    under: { id: 'under', label: 'Under', ai_direction: 0, first_barrier: 7, recovery_barrier: 6 },
};

/**
 * The contract's own win rate: the share of the ten equally likely last
 * digits that win it. Over 2 wins on 3-9 (70%), Under 7 on 0-6 (70%). A fixed
 * property of the contract - no scanner condition changes it.
 */
export const contractWinRate = (setup: TOverUnderSetup, barrier: number) =>
    setup.ai_direction === 1 ? (9 - barrier) * 10 : barrier * 10;

export const AI_SCANNER_TICK_WINDOW = 600;

// The contract types each scanner tab trades. A market is scanned only when
// its live contracts_for offers all of them at a 1-tick duration
// (utils/ai-scanner-offered.ts).
export const AI_SCANNER_TAB_CONTRACT_TYPES = {
    over_under: ['DIGITOVER', 'DIGITUNDER'],
    even_odd: ['DIGITEVEN', 'DIGITODD'],
} as const;
// How long Load & Run may spend FINDING a qualifying market. Once a market is
// locked the limit no longer applies - it waits for the entry for as long as
// the condition holds (AiScannerStore).
export const AI_SCANNER_SCAN_LIMIT_SECONDS = 300;
// How long a market stays ARMED once it meets the strategy's condition: it
// waits this long for its own entry, even if the condition stops holding.
export const AI_SCANNER_ARM_SECONDS = 180;

// v1 supports USD accounts only. Deriv publishes no structured minimum stake
// per currency on this API (contracts_for carries none; it is only quoted in a
// proposal's error text: "Please enter a stake amount that's at least 0.35."),
// so the USD figure is pinned here rather than parsed out of an error message.
export const AI_SCANNER_CURRENCY = 'USD';
export const AI_SCANNER_MIN_STAKE = 0.35;

// (1s) Volatility indices and Jump indices only - no plain R_ indices.
// 1HZ150V / 1HZ250V are already dropped by getSymbolsForBot
// (config QUICK_STRATEGY.DISABLED.SYMBOLS); filtered again here so this list
// never depends on that.
export const AI_SCANNER_BLOCKED_SYMBOLS = ['1HZ150V', '1HZ250V'];
export const isAiScannerSymbol = (symbol: string, submarket: string) =>
    !AI_SCANNER_BLOCKED_SYMBOLS.includes(symbol) &&
    ((submarket === 'random_index' && symbol.startsWith('1HZ')) || submarket === 'jump_index');
