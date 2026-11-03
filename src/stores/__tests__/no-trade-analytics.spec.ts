import fs from 'fs';
import path from 'path';

/** Every source file under src (no tests). */
const sourceFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
        return /\.(ts|tsx|js|jsx)$/.test(entry.name) && !/\.(spec|test)\./.test(entry.name) ? [full] : [];
    });

describe('no per-trade analytics to Deriv', () => {
    it("nothing posts trades or the strategy XML to Deriv's analytics server", () => {
        const offenders = sourceFiles(path.resolve(__dirname, '../..')).filter(file => {
            const source = fs.readFileSync(file, 'utf8');
            return /deriv-bi-reporting|dbotconf/.test(source);
        });
        expect(offenders).toEqual([]);
    });
});
