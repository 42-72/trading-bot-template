import { useEffect, useState } from 'react';
import { ApiHelpers } from '@/external/bot-skeleton';
import { useApiBase } from '@/hooks/useApiBase';

export type TSyntheticSymbol = { text: string; value: string; submarket: string };

// Submarkets Market Tool offers: the Volatility indices (R_10-R_100 and the
// 1HZ variants) and the Jump indices (JD10-JD100). Also what the Bot Builder
// sync treats as "ours" (market-tool-sync.ts).
export const MARKET_TOOL_SUBMARKETS = ['random_index', 'jump_index'];

type TBotSymbol = { text: string; value: string; submarket?: string };

/**
 * Volatility and Jump indices (MARKET_TOOL_SUBMARKETS) from the app's
 * own active_symbols list (ApiHelpers.instance.active_symbols.getSymbolsForBot,
 * the same source the Bot Builder's quick-strategy symbol select uses), not a
 * hardcoded list.
 */
export const useSyntheticSymbols = (): TSyntheticSymbol[] => {
    const [symbols, setSymbols] = useState<TSyntheticSymbol[]>([]);
    const { connectionStatus } = useApiBase();

    useEffect(() => {
        if (symbols.length > 0) return undefined;

        const readSymbols = () => {
            const instance = ApiHelpers?.instance as unknown as {
                active_symbols?: { getSymbolsForBot: () => TBotSymbol[] };
            };
            const all = instance?.active_symbols?.getSymbolsForBot?.() ?? [];
            const synthetics = all
                .filter(s => !!s.submarket && MARKET_TOOL_SUBMARKETS.includes(s.submarket))
                .map(s => ({ text: s.text, value: s.value, submarket: s.submarket as string }));
            if (synthetics.length) setSymbols(synthetics);
            return synthetics.length > 0;
        };

        // active_symbols is fetched asynchronously on app init/auth, so it
        // may not be ready yet even once the socket is open - poll briefly
        // rather than assuming a single check is enough.
        if (readSymbols()) return undefined;
        const interval = setInterval(() => {
            if (readSymbols()) clearInterval(interval);
        }, 500);

        return () => clearInterval(interval);
    }, [connectionStatus, symbols.length]);

    return symbols;
};
