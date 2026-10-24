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

describe('the TP / SL messages', () => {
    const even_odd_engine = fs.readFileSync(path.join(__dirname, '../../assets/ai-engine/bull-ai-evenodd.xml'), 'utf8');
    it.each([
        ['Over/Under', () => engine],
        ['Even/Odd', () => even_odd_engine],
    ])(
        '%s engine: "AI hit TP$$ " / "AI hit SL " - the old texts are gone, and it still parses and reads back',
        (_, xml) => {
            expect(xml()).toContain('<field name="TEXT">AI hit TP$$ </field>');
            expect(xml()).toContain('<field name="TEXT">AI hit SL </field>');
            expect(xml()).not.toContain('TP hit, the bull');
            expect(xml()).not.toContain('SL hit, f*ck everyone');
            expect(() => readEngineValues(xml())).not.toThrow();
        }
    );

    it('the TP and SL messages are still followed by the total profit, unchanged', () => {
        [engine, even_odd_engine].forEach(xml => {
            ['AI hit TP$$ ', 'AI hit SL '].forEach(text => {
                const at = xml.indexOf(`<field name="TEXT">${text}</field>`);
                expect(xml.slice(at, at + 1200)).toContain('<block type="total_profit"');
            });
        });
    });
});

describe('the Even/Odd engine', () => {
    const even_odd = fs.readFileSync(path.join(__dirname, '../../assets/ai-engine/bull-ai-evenodd.xml'), 'utf8');
    const { first_barrier, recovery_barrier, ...without_barriers } = values; // eslint-disable-line @typescript-eslint/no-unused-vars

    it('ships with direction 1 (Even) and has no barriers', () => {
        const shipped = readEngineValues(even_odd);
        expect(shipped).toMatchObject({ ai_direction: 1, martingale: 2, stake: 20, stake_2: 20 });
        expect(shipped.first_barrier).toBeUndefined();
        expect(shipped.recovery_barrier).toBeUndefined();
    });

    it('takes direction, market and the locked values - no barriers', () => {
        expect(readEngineValues(writeEngineValues(even_odd, { ...without_barriers, ai_direction: 0 }))).toEqual({
            ai_direction: 0,
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

    it('refuses barriers it has no variables for', () => {
        expect(() => writeEngineValues(even_odd, values)).toThrow(AiEngineXmlError);
    });

    it('the Over/Under engine still gets its barriers written', () => {
        expect(readEngineValues(writeEngineValues(engine, values))).toMatchObject({
            first_barrier: 7,
            recovery_barrier: 6,
        });
    });
});
