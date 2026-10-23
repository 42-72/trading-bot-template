import alphaV1Xml from '../assets/bots/alpha-v1.xml';
import bullXml from '../assets/bots/bull.xml';
import diamondsXml from '../assets/bots/diamonds.xml';
import silverXml from '../assets/bots/silver.xml';

export type TBotLibraryEntry = {
    id: string;
    number: number;
    name: string;
    description: string;
    file: string;
};

// One entry per bot. More are coming - render the Tbots grid from this array,
// don't hardcode individual cards.
export const BOT_LIBRARY: TBotLibraryEntry[] = [
    {
        id: 'alpha-v1',
        number: 1,
        name: 'Dollar One',
        description:
            'Martingale progression: stake increases after each loss and resets on a win. Stops at the target profit set in the blocks.',
        file: alphaV1Xml,
    },
    {
        id: 'diamonds',
        number: 2,
        name: 'Diamonds',
        description: 'this bot trades over 2, recovery mode over 3 & under 6',
        file: diamondsXml,
    },
    {
        id: 'silver',
        number: 3,
        name: 'Silver',
        description: 'this bot trades under 7, recovery mode under 6 & over 3',
        file: silverXml,
    },
    {
        id: 'bull',
        number: 4,
        name: 'BULL',
        description: 'good at rise/fall, even/odd',
        file: bullXml,
    },
];
