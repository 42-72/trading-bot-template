/**
 * Google Tag Manager (Deriv's container from the bot template) is REMOVED: it loaded
 * googletagmanager.com/gtm.js 3 s after start-up and, on Run, every purchase and every
 * closed trade, ran a Google Ads conversion tag and GA4. Nothing else depended on it
 * (login/OAuth, the app ID / markup, trading). The old callers stay; nothing is sent.
 */
type TNoop = (...args: unknown[]) => void;
const noop: TNoop = () => undefined;

const GTM: { init: TNoop; pushDataLayer: TNoop; onTransactionClosed: TNoop; onRunBot: TNoop } = {
    init: noop,
    pushDataLayer: noop,
    onTransactionClosed: noop,
    onRunBot: noop,
};

export default GTM;
