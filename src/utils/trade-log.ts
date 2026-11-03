import { isAiEngineStrategyId } from './library-strategies';

/**
 * Describes a bot-engine trade for the AI Scanner's locked-trade guard: only
 * the trade itself - contract type, barrier / prediction, symbol, stake -
 * never a token, an OTP or an account id.
 */

type TBuyRequest = {
    buy?: string | number;
    price?: number;
    parameters?: {
        amount?: number;
        contract_type?: string;
        underlying_symbol?: string;
        barrier?: number | string;
        barrier2?: number | string;
        duration?: number;
        duration_unit?: string;
    };
};

type TProposalRequest = {
    amount?: number;
    contract_type?: string;
    underlying_symbol?: string;
    barrier?: number | string;
    barrier2?: number | string;
};

/** True while the workspace holds the AI Scanner's engine bot. */
export const isAiEngineRun = () => {
    const workspace = (window as unknown as { Blockly?: { derivWorkspace?: { current_strategy_id?: string } } }).Blockly
        ?.derivWorkspace;
    return isAiEngineStrategyId(workspace?.current_strategy_id);
};

/** "DIGITOVER barrier 2 R_100 stake 10 1t" - from a buy (direct) or a proposal request. */
export const describeTrade = (request?: TBuyRequest | TProposalRequest | null) => {
    if (!request) return 'no request';
    const p = ('parameters' in request && request.parameters ? request.parameters : request) as TProposalRequest &
        TBuyRequest['parameters'];
    const parts = [
        p.contract_type ?? '?',
        p.barrier !== undefined ? `barrier ${p.barrier}` : 'no barrier',
        p.barrier2 !== undefined ? `barrier2 ${p.barrier2}` : '',
        p.underlying_symbol ?? '?',
        p.amount !== undefined ? `stake ${p.amount}` : '',
        p.duration !== undefined ? `${p.duration}${p.duration_unit ?? ''}` : '',
    ];
    return parts.filter(Boolean).join(' ');
};
