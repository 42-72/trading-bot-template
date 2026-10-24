import { api_base } from '@/external/bot-skeleton/services/api/api-base';

// Which markets the AI Scanner may scan: only those whose live contracts_for
// offers every contract type the chosen tab trades, at a 1-tick duration.
// Asked fresh on every Scan & Run (not the app's contracts_for cache): Deriv
// switches offerings off and on - Jump 100 had no digit contracts at all,
// and a scan that picked it ended in "Trading is not offered for this
// duration." Nothing is hard-coded; the check decides.

export type TAvailableContract = {
    contract_type?: string;
    min_contract_duration?: string;
    max_contract_duration?: string;
};

type TMarket = { symbol: string };

const REQUEST_TIMEOUT_MS = 10000;
const DURATION_TICKS = 1;

/** "1t" -> 1; anything that isn't a tick duration -> null. */
const toTicks = (duration?: string) => {
    const match = /^(\d+)t$/.exec(duration ?? '');
    return match ? Number(match[1]) : null;
};

const offersOneTick = (contract: TAvailableContract) => {
    const min = toTicks(contract.min_contract_duration);
    const max = toTicks(contract.max_contract_duration);
    return min !== null && max !== null && min <= DURATION_TICKS && DURATION_TICKS <= max;
};

/** Every one of `contract_types` is offered with 1 tick inside its min..max. */
export const offersTrade = (available: TAvailableContract[], contract_types: readonly string[]) =>
    contract_types.every(type =>
        available.some(contract => contract.contract_type === type && offersOneTick(contract))
    );

/** contracts_for on the app's own socket (api_base), as ApiHelpers' contracts_for sends it. Rejects on an error or no reply. */
export const fetchAvailableContracts = async (symbol: string): Promise<TAvailableContract[]> => {
    if (!api_base.api) throw new Error('No connection');
    let timeout_id: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timeout_id = setTimeout(() => reject(new Error('contracts_for timed out')), REQUEST_TIMEOUT_MS);
    });
    try {
        const response = (await Promise.race([api_base.api.send({ contracts_for: symbol }), timeout])) as unknown as {
            error?: { message?: string };
            contracts_for?: { available?: TAvailableContract[] };
        };
        if (response?.error) throw response;
        return response?.contracts_for?.available ?? [];
    } finally {
        clearTimeout(timeout_id);
    }
};

/**
 * The markets that offer the trade right now, in their original order. A
 * market whose contracts_for fails or times out is left out of this scan.
 */
export const filterOfferedMarkets = async <T extends TMarket>(
    markets: T[],
    contract_types: readonly string[]
): Promise<T[]> => {
    const results = await Promise.allSettled(markets.map(market => fetchAvailableContracts(market.symbol)));
    return markets.filter((_, index) => {
        const result = results[index];
        return result.status === 'fulfilled' && offersTrade(result.value, contract_types);
    });
};
