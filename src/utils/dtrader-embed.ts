import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { isDemoAccount } from '@/utils/account-helpers';

/**
 * DTrader shown inside the DTrader tab (embedded mode).
 *
 * Hidden test switch: ?dtrader_embed=1 turns it on for this browser, ?dtrader_embed=0
 * turns it off. While off, the DTrader tab keeps opening DTrader in a new tab.
 *
 * The frame gets the trader's session over postMessage, only to the exact DTrader
 * origin, and never the refresh token (only this app refreshes / logs in).
 */

export const DTRADER_ORIGIN = 'https://dtrader.charlestraders.com';
export const DTRADER_URL = DTRADER_ORIGIN;
export const DTRADER_EMBED_URL = `${DTRADER_ORIGIN}/?embedded=1`;

/**
 * Sandbox for the DTrader frame. Deliberately WITHOUT allow-top-navigation (and its
 * by-user-activation variant), so nothing inside the frame can ever navigate this
 * window away. Pages DTrader needs here are opened by this app instead (ct:navigate,
 * ct:login-required); its links to other sites open in new tabs (allow-popups +
 * allow-popups-to-escape-sandbox). allow-same-origin keeps DTrader's own origin,
 * which its storage, websocket and the exact-origin postMessage checks rely on.
 */
export const DTRADER_IFRAME_SANDBOX = [
    'allow-scripts',
    'allow-same-origin',
    'allow-forms',
    'allow-popups',
    'allow-popups-to-escape-sandbox',
    'allow-modals',
    'allow-downloads',
].join(' ');

const EMBED_SWITCH_KEY = 'ct_dtrader_embed';
const EMBED_SWITCH_PARAM = 'dtrader_embed';

export type TDTraderSession = {
    access_token: string;
    expires_at: number | null;
    account_id: string;
    account_type: 'demo' | 'real';
};

export type TParentToDTraderMessage =
    | { type: 'ct:session'; session: TDTraderSession | null }
    | { type: 'ct:account'; account_id: string; account_type: 'demo' | 'real' }
    | { type: 'ct:logout' };

export type TDTraderToParentMessage =
    | { type: 'ct:ready' }
    | { type: 'ct:token-invalid' }
    | { type: 'ct:login-required' }
    | { type: 'ct:navigate'; target: string; url: string };

/**
 * Reads ?dtrader_embed=1 / ?dtrader_embed=0 into localStorage (then drops the
 * param from the address bar) and returns whether embedded DTrader is on.
 */
export const isDTraderEmbedEnabled = (): boolean => {
    try {
        const url = new URL(window.location.href);
        const param = url.searchParams.get(EMBED_SWITCH_PARAM);
        if (param === '1') localStorage.setItem(EMBED_SWITCH_KEY, '1');
        if (param === '0') localStorage.removeItem(EMBED_SWITCH_KEY);
        if (param !== null) {
            url.searchParams.delete(EMBED_SWITCH_PARAM);
            window.history.replaceState(window.history.state, '', url.toString());
        }
        return localStorage.getItem(EMBED_SWITCH_KEY) === '1';
    } catch {
        return false;
    }
};

/** The session to hand to DTrader, or null when logged out / token expired. */
export const getDTraderSession = (): TDTraderSession | null => {
    const auth_info = OAuthTokenExchangeService.getAuthInfo();
    const account_id = localStorage.getItem('active_loginid');
    if (!auth_info?.access_token || !account_id) return null;
    return {
        access_token: auth_info.access_token,
        expires_at: auth_info.expires_at ?? null,
        account_id,
        account_type: isDemoAccount(account_id) ? 'demo' : 'real',
    };
};

/** True only for a ct:* message that really came from our DTrader frame. */
export const isDTraderMessage = (
    event: MessageEvent,
    frame_window: Window | null | undefined
): event is MessageEvent<TDTraderToParentMessage> =>
    event.origin === DTRADER_ORIGIN &&
    !!frame_window &&
    event.source === frame_window &&
    typeof event.data?.type === 'string' &&
    event.data.type.startsWith('ct:');

export const postToDTrader = (frame_window: Window | null | undefined, message: TParentToDTraderMessage) => {
    frame_window?.postMessage(message, DTRADER_ORIGIN);
};

/** Only same-origin charlestraders.com pages may be opened on DTrader's behalf. */
export const getSafeNavigateUrl = (url: unknown): string | null => {
    if (typeof url !== 'string') return null;
    try {
        const target = new URL(url, window.location.origin);
        return target.origin === window.location.origin ? target.toString() : null;
    } catch {
        return null;
    }
};
