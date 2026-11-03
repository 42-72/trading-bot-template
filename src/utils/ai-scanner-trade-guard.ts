import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { logConnEvent } from './connection-log';
import { describeTrade, isAiEngineRun } from './trade-log';

/**
 * The AI Scanner's locked trade, checked against every buy its
 * engine sends. The scanner sets it just before pressing Run and clears it when
 * the run ends; the engine (Purchase.js) refuses a buy that doesn't match, so
 * the scanner can never buy a contract other than the one it locked - whatever
 * left the engine or workspace out of step - and the log says what differed.
 */
export type TAiScannerTrade = {
    symbol: string;
    /** The contract types the locked strategy may buy, e.g. ['DIGITOVER', 'DIGITUNDER']. */
    contract_types: string[];
    /** The barriers (prediction digits) it may use; empty = no barrier (Even/Odd). */
    barriers: number[];
};

const STATE_KEY = 'ai_scanner.trade';

export const setAiScannerTrade = (trade: TAiScannerTrade | null) => globalObserver.setState({ [STATE_KEY]: trade });

export const getAiScannerTrade = (): TAiScannerTrade | null => globalObserver.getState(STATE_KEY) ?? null;

type TBuy = {
    parameters?: { contract_type?: string; underlying_symbol?: string; barrier?: number | string };
};

/** Why `buy` is not the scanner's locked trade, or null when it is (or no check applies). */
export const checkAiScannerBuy = (buy: TBuy): string | null => {
    if (!isAiEngineRun()) return null;
    const expected = getAiScannerTrade();
    if (!expected) return null;
    const p = buy.parameters ?? {};
    const problems: string[] = [];
    if (p.underlying_symbol !== expected.symbol)
        problems.push(`market ${p.underlying_symbol} (locked ${expected.symbol})`);
    if (!p.contract_type || !expected.contract_types.includes(p.contract_type)) {
        problems.push(`contract ${p.contract_type} (locked ${expected.contract_types.join('/')})`);
    }
    const barrier = p.barrier === undefined ? undefined : Number(p.barrier);
    if (expected.barriers.length === 0 ? barrier !== undefined : !expected.barriers.includes(barrier as number)) {
        problems.push(
            `barrier ${p.barrier ?? 'none'} (locked ${expected.barriers.length ? expected.barriers.join('/') : 'none'})`
        );
    }
    if (problems.length === 0) return null;
    logConnEvent('ai_trade_mismatch', `${problems.join(', ')} - not bought: ${describeTrade(buy)}`);
    return `The AI Scanner did not buy: the engine's trade does not match the locked one (${problems.join(', ')}).`;
};
