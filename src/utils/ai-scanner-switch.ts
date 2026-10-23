import brandConfig from '../../brand.config.json';

// Hidden switch for the AI Scanner while it's tested logged-in on production
// (OAuth doesn't work on pages.dev previews). The ONE place it's decided:
// RootStore creates the scanner's store only when this says on, and nothing
// of the scanner mounts, subscribes or runs without that store. Remove this
// file and its call in root-store.ts to ship the scanner to everyone.
//
//   ?ai=on   saves ct_ai_scanner=1 (and is removed from the address bar)
//   ?ai=off  removes it
//   *.charlestraders-bot.pages.dev previews: always on
//   storage unavailable: off

const STORAGE_KEY = 'ct_ai_scanner';
const PARAM = 'ai';
const PREVIEW_HOST_SUFFIX = `.${brandConfig.platform.hostname.production.pages_dev}`;

type TPage = { href: string; replaceUrl: (url: string) => void };

const currentPage = (): TPage => ({
    href: window.location.href,
    replaceUrl: url => window.history.replaceState(window.history.state, '', url),
});

/** Reads (and on ?ai=on / ?ai=off, first updates) the switch. `page` is only overridden by tests. */
export const isAiScannerEnabled = (page: TPage = currentPage()): boolean => {
    let value: string | null = null;
    let hostname = '';
    try {
        const url = new URL(page.href);
        hostname = url.hostname;
        value = url.searchParams.get(PARAM);
        if (value === 'on' || value === 'off') {
            url.searchParams.delete(PARAM);
            page.replaceUrl(`${url.pathname}${url.search}${url.hash}`);
        }
    } catch {
        // Unparseable URL - just read the stored switch.
    }

    if (hostname.endsWith(PREVIEW_HOST_SUFFIX)) return true;

    try {
        if (value === 'on') localStorage.setItem(STORAGE_KEY, '1');
        if (value === 'off') localStorage.removeItem(STORAGE_KEY);
        return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
};
