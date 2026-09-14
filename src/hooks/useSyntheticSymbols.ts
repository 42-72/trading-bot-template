import { useEffect, useState } from 'react';
import { ApiHelpers } from '@/external/bot-skeleton';
import { useApiBase } from '@/hooks/useApiBase';

export type TSyntheticSymbol = { text: string; value: string };

type TBotSymbol = { text: string; value: string; submarket?: string };

/**
 * Synthetic indices (R_10/25/50/75/100 and the 1HZ variants) from the app's
 * own active_symbols list (ApiHelpers.instance.active_symbols.getSymbolsForBot,
 * already used the same way - and filtered to the same submarket - by the
 * Bot Builder's quick-strategy symbol select), not a hardcoded list.
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
                .filter(s => s.submarket === 'random_index')
                .map(s => ({ text: s.text, value: s.value }));
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
