import fs from 'fs';
import path from 'path';
import { AiEngineXmlError, readEngineValues, TEngineValues, writeEngineValues } from '../ai-engine-xml';

// jest stubs *.xml imports, so read the real engine file from disk.
const engine = fs.readFileSync(path.join(__dirname, '../../assets/ai-engine/bull-ai-overunder.xml'), 'utf8');

const values: TEngineValues = {
    market: 'synthetic_index',
    submarket: 'jump_index',
    symbol: 'JD25',
    ai_direction: 0,
    first_barrier: 7,
    recovery_barrier: 6,
    stake: 0.35,
    martingale: 2.5,
    take_profit: 3,
    stop_loss: 9,
};

describe('writeEngineValues', () => {
    it('ships with the values the engine was written with', () => {
        expect(readEngineValues(engine)).toEqual({
            ai_direction: 1,
            first_barrier: 2,
            recovery_barrier: 3,
            stake: 20,
            stake_2: 20,
            martingale: 2,
            take_profit: 45,
            stop_loss: 70,
            market: 'synthetic_index',
            submarket: 'random_index',
            symbol: '1HZ100V',
        });
    });

    it('writes every value, both stakes and the sub-market as well as the symbol', () => {
        expect(readEngineValues(writeEngineValues(engine, values))).toEqual({
            ai_direction: 0,
            first_barrier: 7,
            recovery_barrier: 6,
            stake: 0.35,
            stake_2: 0.35,
            martingale: 2.5,
            take_profit: 3,
            stop_loss: 9,
            market: 'synthetic_index',
            submarket: 'jump_index',
            symbol: 'JD25',
        });
    });

    it('leaves reassignments outside INITIALIZATION alone (martingale multiply, reset to Trade amount 2)', () => {
        const written = writeEngineValues(engine, values);
        expect(written).toContain('id="bull-ai-mart-set"');
        // LOSS COUNT is not a scanner value: its initial 0 is untouched.
        expect(written).toMatch(/id="bull-ai-n-loss"><field name="NUM">0<\/field>/);
    });

    it('does not depend on the text of the numbers it replaces', () => {
        // If the writer searched for numbers, a value equal to another
        // variable's (stake 20 == Trade amount 2's old 20) would be ambiguous.
        const twice = writeEngineValues(writeEngineValues(engine, values), { ...values, stake: 2, first_barrier: 2 });
        expect(readEngineValues(twice)).toMatchObject({ stake: 2, stake_2: 2, first_barrier: 2, recovery_barrier: 6 });
    });

    it('refuses an engine where a target variable is missing', () => {
        const broken = engine.replace('>MARTINGALE</variable>', '>SOMETHING ELSE</variable>');
        expect(() => writeEngineValues(broken, values)).toThrow(AiEngineXmlError);
    });

    it('refuses a non-numeric value', () => {
        expect(() => writeEngineValues(engine, { ...values, stake: NaN })).toThrow(AiEngineXmlError);
    });
});
