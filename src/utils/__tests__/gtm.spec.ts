import fs from 'fs';
import path from 'path';
import GTM from '../gtm';

const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === '__tests__' ? [] : files(full);
        return /\.(ts|tsx|js|jsx|html)$/.test(entry.name) ? [full] : [];
    });

describe('Google Tag Manager GTM-NF7884S is gone', () => {
    it('is not loaded anywhere (src, index.html)', () => {
        const root = path.resolve(__dirname, '../../..');
        const offenders = [...files(path.join(root, 'src')), path.join(root, 'index.html')].filter(file =>
            fs.readFileSync(file, 'utf8').includes('GTM-NF7884S')
        );
        expect(offenders).toEqual([]);
    });

    it('sends nothing: the old calls are no-ops', () => {
        const pushed: unknown[] = [];
        (window as unknown as { dataLayer: unknown }).dataLayer = { push: (d: unknown) => pushed.push(d) };
        GTM.init();
        GTM.pushDataLayer({ event: 'dbot_purchase' });
        GTM.onTransactionClosed({ contract_id: 1 } as never);
        expect(pushed).toEqual([]);
        expect(document.querySelector('script[src*="GTM-NF7884S"]')).toBeNull();
    });
});
