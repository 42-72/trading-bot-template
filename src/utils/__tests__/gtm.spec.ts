import fs from 'fs';
import path from 'path';
import GTM from '../gtm';

const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === '__tests__' ? [] : files(full);
        return /\.(ts|tsx|js|jsx|html)$/.test(entry.name) ? [full] : [];
    });

// Both Google Tag Manager containers that came with Deriv's bot template.
const REMOVED_CONTAINERS = ['GTM-NF7884S', 'GTM-KV9538TF'];

describe('Google Tag Manager (GTM-NF7884S, GTM-KV9538TF) is gone', () => {
    it.each(REMOVED_CONTAINERS)('%s is not loaded anywhere (src, index.html, public)', container => {
        const root = path.resolve(__dirname, '../../..');
        const offenders = [
            ...files(path.join(root, 'src')),
            ...files(path.join(root, 'public')),
            path.join(root, 'index.html'),
        ].filter(file => fs.readFileSync(file, 'utf8').includes(container));
        expect(offenders).toEqual([]);
    });

    it('index.html loads no Tag Manager script or noscript frame at all', () => {
        const html = fs.readFileSync(path.resolve(__dirname, '../../../index.html'), 'utf8');
        expect(html).not.toMatch(/googletagmanager\.com/);
        expect(html).not.toMatch(/dataLayer/);
    });

    it('sends nothing: the old calls are no-ops', () => {
        const pushed: unknown[] = [];
        (window as unknown as { dataLayer: unknown }).dataLayer = { push: (d: unknown) => pushed.push(d) };
        GTM.init();
        GTM.pushDataLayer({ event: 'dbot_purchase' });
        GTM.onTransactionClosed({ contract_id: 1 } as never);
        expect(pushed).toEqual([]);
        expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
    });
});
