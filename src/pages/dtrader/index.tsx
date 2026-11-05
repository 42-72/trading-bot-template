import { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import IframeWrapper from '@/components/iframe-wrapper';
import { generateOAuthURL } from '@/components/shared';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useIsPhone } from '@/hooks/useIsPhone';
import { useStore } from '@/hooks/useStore';
import {
    DTRADER_EMBED_URL,
    DTRADER_IFRAME_SANDBOX,
    getDTraderSession,
    getSafeNavigateUrl,
    isDTraderMessage,
    postToDTrader,
    removeLegacyDTraderEmbedSwitch,
    TDTraderSession,
} from '@/utils/dtrader-embed';
import { scheduleDTraderWarmup } from '@/utils/dtrader-warmup';
import { isLoginRequestAllowed } from '@/utils/idle-logout';
import { isBotOrScannerRunning } from '@/utils/run-activity';
import { Localize, localize } from '@deriv-com/translations';
import './dtrader.scss';

// How often the token is re-checked, so an expired session reaches the frame
// even when nothing else changes.
const SESSION_CHECK_MS = 30000;
// A second ct:token-invalid within this window means re-sending the same token
// did not help: the frame is told to log out instead of looping.
const TOKEN_RETRY_WINDOW_MS = 60000;

/**
 * Embedded DTrader in the DTrader tab, for every visitor. Rendered as an
 * always-mounted sibling of the Tabs component like TradingViewPanel, so the
 * iframe - once opened - survives tab switches. It hands DTrader this app's
 * session over postMessage and follows login, logout and Demo/Real switches.
 *
 * Phones only: when a bot or the AI Scanner starts running while another tab
 * is open, the hidden frame is unloaded to free the phone's processor. It is
 * loaded again only when the trader opens the DTrader tab (also mid-run - their
 * choice), never automatically when the run ends.
 */
const DTraderPanel = observer(() => {
    const store = useStore();
    const { dashboard, client } = store;
    const { active_tab } = dashboard;
    const is_active = active_tab === DBOT_TABS.DTRADER;
    const is_phone = useIsPhone();
    const [has_opened, setHasOpened] = useState(false);
    // Until the frame's page has started (ct:ready or its load event)
    const [is_frame_loading, setIsFrameLoading] = useState(true);
    // Only ct:ready: a load event says the page arrived, not that DTrader runs.
    // The frame says it again after reloading itself, so that needs nothing extra.
    const [is_frame_ready, setIsFrameReady] = useState(false);
    // Opened at least once in this page load (the warm-up has nothing left to do)
    const was_opened_ref = useRef(false);
    const frame_ref = useRef<HTMLIFrameElement>(null);
    // undefined until the frame says ct:ready; null once it was told "logged out"
    const last_sent_ref = useRef<TDTraderSession | null | undefined>(undefined);
    const last_token_retry_ref = useRef(0);

    useEffect(() => {
        removeLegacyDTraderEmbedSwitch();
    }, []);

    useEffect(() => {
        if (is_active && !has_opened) {
            was_opened_ref.current = true;
            setIsFrameLoading(true);
            setIsFrameReady(false);
            setHasOpened(true);
        }
    }, [is_active, has_opened]);

    // Phones: a run starting while DTrader is hidden unloads the frame.
    useEffect(() => {
        if (!is_phone) return undefined;
        return reaction(
            () => isBotOrScannerRunning(store),
            is_running => {
                if (is_running && store.dashboard.active_tab !== DBOT_TABS.DTRADER) {
                    last_sent_ref.current = undefined; // a reloaded frame says ct:ready again
                    setHasOpened(false);
                }
            }
        );
    }, [is_phone, store]);

    // Fill the browser cache with DTrader's files while the site is idle, so
    // even the first open is quick (dtrader-warmup.ts).
    useEffect(
        () =>
            scheduleDTraderWarmup({
                isBusy: () => isBotOrScannerRunning(store),
                isOpened: () => was_opened_ref.current,
            }),
        [store]
    );

    const onFrameStarted = useCallback(() => setIsFrameLoading(false), []);

    const onFrameRetry = useCallback(() => {
        last_sent_ref.current = undefined; // a reloaded frame says ct:ready again
        setIsFrameLoading(true);
        setIsFrameReady(false);
    }, []);

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
                    onFrameStarted();
                    setIsFrameReady(true);
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
                    if (!getDTraderSession() && isLoginRequestAllowed()) {
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
    }, [client, has_opened, onFrameStarted, sendLogout, sendSession, syncSession]);

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
                        onLoad={onFrameStarted}
                        patientLoad={{
                            isVisible: is_active,
                            failedText: localize('DTrader is temporarily unavailable'),
                            retryText: localize('Try again'),
                            readySignal: {
                                isReady: is_frame_ready,
                                slowText: localize('Still loading…'),
                                reloadText: localize('Reload DTrader'),
                            },
                            onRetry: onFrameRetry,
                        }}
                    />
                    {is_frame_loading && (
                        <div className='dtrader-panel__loading' role='status' aria-live='polite'>
                            <span className='dtrader-panel__spinner' aria-hidden='true' />
                            <span className='dtrader-panel__loading-text'>
                                <Localize i18n_default_text='Loading DTrader…' />
                            </span>
                        </div>
                    )}
                </div>
            )}
            <div className='dtrader-panel__bottom-bar-guard' aria-hidden='true' />
        </div>
    );
});

export default DTraderPanel;
