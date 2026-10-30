import { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import IframeWrapper from '@/components/iframe-wrapper';
import { generateOAuthURL } from '@/components/shared';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import {
    DTRADER_EMBED_URL,
    DTRADER_IFRAME_SANDBOX,
    getDTraderSession,
    getSafeNavigateUrl,
    isDTraderEmbedEnabled,
    isDTraderMessage,
    postToDTrader,
    TDTraderSession,
} from '@/utils/dtrader-embed';
import './dtrader.scss';

// How often the token is re-checked, so an expired session reaches the frame
// even when nothing else changes.
const SESSION_CHECK_MS = 30000;
// A second ct:token-invalid within this window means re-sending the same token
// did not help: the frame is told to log out instead of looping.
const TOKEN_RETRY_WINDOW_MS = 60000;

/**
 * Embedded DTrader (behind the ct_dtrader_embed test switch). Rendered as an
 * always-mounted sibling of the Tabs component like TradingViewPanel, so the
 * iframe - once opened - survives tab switches. It hands DTrader this app's
 * session over postMessage and follows login, logout and Demo/Real switches.
 */
const DTraderPanel = observer(() => {
    const { dashboard, client } = useStore();
    const { active_tab } = dashboard;
    const is_active = active_tab === DBOT_TABS.DTRADER;
    const [is_enabled] = useState(isDTraderEmbedEnabled);
    const [has_opened, setHasOpened] = useState(false);
    const frame_ref = useRef<HTMLIFrameElement>(null);
    // undefined until the frame says ct:ready; null once it was told "logged out"
    const last_sent_ref = useRef<TDTraderSession | null | undefined>(undefined);
    const last_token_retry_ref = useRef(0);

    useEffect(() => {
        if (is_enabled && is_active && !has_opened) {
            setHasOpened(true);
        }
    }, [is_enabled, is_active, has_opened]);

    const getFrameWindow = () => frame_ref.current?.contentWindow;

    const sendSession = useCallback(() => {
        const session = getDTraderSession();
        postToDTrader(getFrameWindow(), { type: 'ct:session', session });
        last_sent_ref.current = session;
    }, []);

    const sendLogout = useCallback(() => {
        postToDTrader(getFrameWindow(), { type: 'ct:logout' });
        last_sent_ref.current = null;
    }, []);

    const syncSession = useCallback(() => {
        const previous = last_sent_ref.current;
        if (previous === undefined) return; // frame not ready yet - it will ask
        if (client?.is_account_regenerating) return; // mid account switch - wait for the result

        const next = getDTraderSession();
        if (!next) {
            if (previous) sendLogout();
            return;
        }
        if (!previous || previous.access_token !== next.access_token) {
            sendSession();
            return;
        }
        if (previous.account_id !== next.account_id) {
            postToDTrader(getFrameWindow(), {
                type: 'ct:account',
                account_id: next.account_id,
                account_type: next.account_type,
            });
            last_sent_ref.current = next;
        }
    }, [client, sendLogout, sendSession]);

    useEffect(() => {
        if (!has_opened) return undefined;

        const handleMessage = async (event: MessageEvent) => {
            if (!isDTraderMessage(event, getFrameWindow())) return;
            const message = event.data;

            switch (message.type) {
                case 'ct:ready':
                    sendSession();
                    break;
                case 'ct:token-invalid': {
                    const now = Date.now();
                    if (getDTraderSession() && now - last_token_retry_ref.current > TOKEN_RETRY_WINDOW_MS) {
                        last_token_retry_ref.current = now;
                        sendSession();
                    } else {
                        sendLogout();
                    }
                    break;
                }
                case 'ct:login-required':
                    // Log in happens here, never inside the frame (auth.deriv.com cannot be framed)
                    if (!getDTraderSession()) {
                        const oauth_url = await generateOAuthURL();
                        if (oauth_url) window.location.replace(oauth_url);
                    }
                    break;
                case 'ct:navigate': {
                    const url = getSafeNavigateUrl(message.url);
                    if (url) window.location.assign(url);
                    break;
                }
                default:
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        const dispose = reaction(
            () => [client?.is_logged_in, client?.loginid, client?.is_account_regenerating],
            () => syncSession()
        );
        const interval_id = setInterval(syncSession, SESSION_CHECK_MS);

        return () => {
            window.removeEventListener('message', handleMessage);
            dispose();
            clearInterval(interval_id);
        };
    }, [client, has_opened, sendLogout, sendSession, syncSession]);

    if (!is_enabled) return null;

    return (
        <div className={classNames('dtrader-panel', { 'dtrader-panel--active': is_active })}>
            {has_opened && (
                <div className='dtrader-tab-panel'>
                    <IframeWrapper
                        src={DTRADER_EMBED_URL}
                        title='DTrader'
                        className='dtrader-container'
                        frameRef={frame_ref}
                        sandbox={DTRADER_IFRAME_SANDBOX}
                        fallbackMessage='DTrader is temporarily unavailable'
                    />
                </div>
            )}
        </div>
    );
});

export default DTraderPanel;
