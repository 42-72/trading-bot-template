import alphaV1Xml from '../assets/bots/alpha-v1.xml';

export type TBotLibraryEntry = {
    id: string;
    number: number;
    name: string;
    market: string;
    tradeType: string;
    description: string;
    file: string;
};

// One entry per bot. More are coming - render the Tbots grid from this array,
// don't hardcode individual cards.
export const BOT_LIBRARY: TBotLibraryEntry[] = [
    {
        id: 'alpha-v1',
        number: 1,
        name: 'Dollar 1',
        market: 'Volatility 100 Index',
        tradeType: 'Digits — Over 3, 1 tick',
        description:
            'Martingale progression: stake increases after each loss and resets on a win. Stops at the target profit set in the blocks.',
        file: alphaV1Xml,
    },
];
