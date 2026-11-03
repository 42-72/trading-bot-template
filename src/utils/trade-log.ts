import { logConnEvent } from './connection-log';
import { isAiEngineStrategyId } from './library-strategies';

/**
 * Connection-log lines for the bot engine's trades (ct_conn_log). Only the
 * trade itself is described - contract type, barrier / prediction, symbol,
 * stake - never a token, an OTP or an account id.
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

type TApiError = { error?: { code?: string; message?: string }; code?: string; message?: string };

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

const describeError = (error: unknown) => {
    const e = error as TApiError | undefined;
    const code = e?.error?.code ?? e?.code ?? 'error';
    const message = e?.error?.message ?? e?.message ?? '';
    return `${code}${message ? ` "${message}"` : ''}`;
};

/** A buy or proposal the engine sent was refused. */
export const logTradeError = (kind: 'buy' | 'proposal', error: unknown, request?: TBuyRequest | TProposalRequest) => {
    logConnEvent(
        'trade_error',
        `${isAiEngineRun() ? 'AI Scanner' : 'bot'} ${kind}: ${describeError(error)} - ${describeTrade(request)}`
    );
};
