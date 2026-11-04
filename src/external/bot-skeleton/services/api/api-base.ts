/* [AI] - Analytics removed - utility functions moved to @/utils/account-helpers */
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
/* [/AI] */
import CommonStore from '@/stores/common-store';
import { TAuthData } from '@/types/api-types';
import { getAccountId, getAccountType, isDemoAccount, removeUrlParameter } from '@/utils/account-helpers';
import { ct_perf } from '@/utils/ct-perf';
import { handleBackendError, isBackendError } from '@/utils/error-handler';
import { idle_logout } from '@/utils/idle-logout';
import { session_status, SessionExpiredError } from '@/utils/session-status';
import { keep_alive } from '@/utils/socket-keep-alive';
import { startLog } from '@/utils/start-log';
import { tradingTimesService } from '../../../../components/shared/services/trading-times-service';
import { activeSymbolsProcessorService } from '../../../../services/active-symbols-processor.service';
import { observer as globalObserver } from '../../utils/observer';
import { doUntilDone, socket_state } from '../tradeEngine/utils/helpers';
import {
    CONNECTION_STATUS,
    setAccountList,
    setAuthData,
    setConnectionStatus,
    setIsAuthorized,
    setIsAuthorizing,
} from './observables/connection-status-stream';
import ApiHelpers from './api-helpers';
import { generateDerivApiInstance, V2GetActiveAccountId } from './appId';
import chart_api from './chart-api';

type CurrentSubscription = {
    id: string;
    unsubscribe: () => void;
};

type SubscriptionPromise = Promise<{
    subscription: CurrentSubscription;
}>;

/** gaps between reconnect attempts while online and visible (the last one repeats). */
export const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
/** how long after a fresh reconnect a repeated auth error still confirms the first one. */
export const AUTH_ERROR_CONFIRM_WINDOW_MS = 60000;

const isPageHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const hasFocus = () =>
    typeof document !== 'undefined' && typeof document.hasFocus === 'function' && document.hasFocus();
/**
 * why a reconnect must wait, or null. A focused page counts as
 * visible: the trader is looking at it even if the browser briefly reports it
 * hidden (Windows marks a window hidden while another covers it).
 */
const whatToWaitFor = (): 'online' | 'visible' | null => {
    if (isOffline()) return 'online';
    if (isPageHidden() && !hasFocus()) return 'visible';
    return null;
};

type TApiBaseApi = {
    /** Set by appId.js: true for a socket opened with a one-time login code, false for the public one. */
    ct_is_authenticated?: boolean;
    connection: {
        readyState: keyof typeof socket_state;
        addEventListener: (event: string, callback: () => void) => void;
        removeEventListener: (event: string, callback: () => void) => void;
    };
    send: (data: unknown) => void;
    disconnect: () => void;
    authorize: (token: string) => Promise<{ authorize: TAuthData; error: unknown }>;

    onMessage: () => {
        subscribe: (callback: (message: unknown) => void) => {
            unsubscribe: () => void;
        };
    };
} & ReturnType<typeof generateDerivApiInstance>;

class APIBase {
    api: TApiBaseApi | null = null;
    token: string = '';
    account_id: string = '';
    pip_sizes = {};
    account_info = {};
    is_running = false;
    subscriptions: CurrentSubscription[] = [];
    time_interval: ReturnType<typeof setInterval> | null = null;
    has_active_symbols = false;
    is_stopping = false;
    active_symbols: any[] = [];
    current_auth_subscriptions: SubscriptionPromise[] = [];
    is_authorized = false;
    active_symbols_promise: Promise<any[] | undefined> | null = null;
    common_store: CommonStore | undefined;

    // - see the "Session " section below.
    connection_generation = 0;
    authorized_generation = -1;
    reconnect_step = 0;
    reconnect_timer: ReturnType<typeof setTimeout> | null = null;
    is_reconnecting_now = false;
    is_swapping = false;
    is_session_expired = false;
    had_session = false;
    session_expires_at: number | null = null;
    expiry_timer: ReturnType<typeof setTimeout> | null = null;
    auth_error_check: { generation: number; confirm_until: number | null } | null = null;
    /** The first connection this page authorized: later ones are reconnects. */
    private first_authorized_generation = -1;
    private retired_apis = new WeakSet<object>();
    private listened_apis = new WeakSet<object>();
    private are_session_listeners_on = false;

    // Constants for timeouts - extracted magic numbers for better maintainability
    private readonly ACTIVE_SYMBOLS_TIMEOUT_MS = 10000; // 10 seconds
    private readonly ENRICHMENT_TIMEOUT_MS = 10000; // 10 seconds

    unsubscribeAllSubscriptions = () => {
        this.current_auth_subscriptions?.forEach(subscription_promise => {
            subscription_promise.then(({ subscription }) => {
                if (subscription?.id) {
                    this.api?.send({
                        forget: subscription.id,
                    });
                }
            });
        });
        this.current_auth_subscriptions = [];
    };

    onsocketopen() {
        setConnectionStatus(CONNECTION_STATUS.OPENED);

        const currentClientStore = globalObserver.getState('client.store');
        if (currentClientStore) {
            currentClientStore.setIsAccountRegenerating(false);
        }

        this.handleTokenExchangeIfNeeded();
    }

    private async handleTokenExchangeIfNeeded() {
        const urlParams = new URLSearchParams(window.location.search);
        const account_id = urlParams.get('account_id');
        const accountType = urlParams.get('account_type');

        if (account_id) {
            localStorage.setItem('active_loginid', account_id);
            // Remove account_id from URL after storing
            removeUrlParameter('account_id');
        }
        if (accountType) {
            localStorage.setItem('account_type', accountType);
            // Remove account_type from URL after storing
            removeUrlParameter('account_type');
        }

        // Check if we have an account_id from URL or localStorage
        let activeAccountId: string | null = getAccountId();

        // If no account_id in localStorage, check sessionStorage for accounts
        if (!activeAccountId) {
            try {
                const storedAccounts = sessionStorage.getItem('deriv_accounts');
                if (storedAccounts) {
                    const accounts = JSON.parse(storedAccounts);
                    if (accounts && accounts.length > 0 && accounts[0].account_id) {
                        // Use the first account as default
                        const accountId = accounts[0].account_id as string;
                        activeAccountId = accountId;
                        localStorage.setItem('active_loginid', accountId);

                        // Set account type based on account_id prefix
                        const isDemo = accountId.startsWith('VRT') || accountId.startsWith('VRTC');
                        localStorage.setItem('account_type', isDemo ? 'demo' : 'real');
                    }
                }
            } catch (error) {
                console.error('[APIBase] Error reading accounts from sessionStorage:', error);
            }
        }

        // Now proceed with normal authorization if we have an account_id
        if (activeAccountId) {
            // The public socket can't authorize anyone - asking it for a balance
            // is what used to return AuthorizationRequired and log the user out.
            // A user whose session ended gets the expiry flow; a tab without one
            // (e.g. a new tab) shows the logged-out app, and logs in as soon as a
            // session appears (onResume) or the trader logs in.
            if (!this.api?.ct_is_authenticated) {
                setIsAuthorizing(false);
                if (!this.checkSessionExpiry()) {
                    startLog('no login in this tab - loading the logged-out page');
                    this.loadLoggedOutApp();
                }
                return;
            }
            startLog('authorizing');
            setIsAuthorizing(true);
            await this.authorizeAndSubscribe();
        } else {
            startLog('no account - logged-out page');
        }
    }

    /** No session on this socket: what a logged-out page needs to finish loading (the market list). */
    private loadLoggedOutApp() {
        setIsAuthorized(false);
        if (!this.has_active_symbols && !this.active_symbols_promise) this.fetchActiveSymbols();
    }

    /** The market list; a failure is logged and asked again later (never an unhandled rejection). */
    private fetchActiveSymbols() {
        this.active_symbols_promise = this.getActiveSymbols().catch(() => {
            this.active_symbols_promise = null;
            return undefined;
        });
    }

    async init(force_create_connection = false) {
        this.toggleRunButton(true);

        if (this.api) {
            this.unsubscribeAllSubscriptions();
        }

        if (!this.api || this.api?.connection.readyState !== 1 || force_create_connection) {
            if (this.api?.connection) {
                // The old socket's close is a swap, not a lost connection. The market-data
                // helpers (contracts_for, active_symbols, trading_times) always use the
                // current socket, so they are kept.
                this.retired_apis.add(this.api);
                setConnectionStatus(CONNECTION_STATUS.CLOSED);
                this.api.disconnect();
            }

            this.is_swapping = true;
            try {
                this.api = await generateDerivApiInstance();
            } catch (error) {
                // Page load / login / account switch: retried here. Reconnects handle their own (reconnectNow).
                if (!this.is_reconnecting_now) {
                    this.initEventListeners();
                    if (error instanceof SessionExpiredError) this.onSessionExpired(error.reason);
                    else this.scheduleReconnect('connection failed');
                }
                throw error;
            } finally {
                this.is_swapping = false;
            }
            this.connection_generation += 1;
            this.attachSessionSocketListeners(this.api);

            // Store the current account ID used for this WebSocket connection
            // This will be used to check if we need to regenerate the connection when the tab becomes active
            const currentClientStore = globalObserver.getState('client.store');
            if (currentClientStore) {
                const active_login_id = getAccountId();
                if (active_login_id) {
                    currentClientStore.setWebSocketLoginId(active_login_id);
                }
            }
        }

        const hasAccountID = V2GetActiveAccountId();

        if (!this.has_active_symbols && !hasAccountID) this.fetchActiveSymbols();

        this.initEventListeners();

        if (this.time_interval) clearInterval(this.time_interval);
        this.time_interval = null;

        chart_api.init(force_create_connection);
    }

    getConnectionStatus() {
        if (this.api?.connection) {
            const ready_state = this.api.connection.readyState;
            return socket_state[ready_state as keyof typeof socket_state] || 'Unknown';
        }
        return 'Socket not initialized';
    }

    terminate() {
        // eslint-disable-next-line no-console
        if (this.api) this.api.disconnect();
    }

    initEventListeners() {
        if (typeof window === 'undefined' || this.are_session_listeners_on) return;
        this.are_session_listeners_on = true;
        window.addEventListener('online', this.onWindowOnline);
        window.addEventListener('focus', this.onWindowFocus);
        window.addEventListener('pageshow', this.onPageShow);
        document.addEventListener('visibilitychange', this.onVisibilityChange);
    }

    async createNewInstance(account_id: string) {
        if (this.account_id !== account_id) {
            await this.init();
        }
    }

    async authorizeAndSubscribe() {
        if (!this.api) return;

        this.account_id = getAccountId() || '';
        setIsAuthorizing(true);
        const generation = this.connection_generation;

        try {
            const { balance, error } = await this.api.balance();

            if (error) {
                const errorMessage = isBackendError(error)
                    ? handleBackendError(error)
                    : error.message || 'Authorization failed';

                // Authorization error
                console.error('Authorization error:', errorMessage);
                this.onHandshakeError();

                setIsAuthorizing(false);
                return { ...error, localizedMessage: errorMessage };
            }

            this.account_info = {
                balance: balance?.balance,
                currency: balance?.currency,
                loginid: balance?.loginid,
            };
            this.token = balance?.loginid;

            const account_type = getAccountType(balance?.loginid);
            const currentAccount = balance?.loginid
                ? {
                      balance: balance.balance,
                      currency: balance.currency || 'USD',
                      is_virtual: account_type === 'real' ? 0 : 1,
                      loginid: balance.loginid,
                  }
                : null;

            // Build full account list from sessionStorage (populated during OAuth flow)
            // Falls back to just the current account if sessionStorage has no data
            const storedAccounts = DerivWSAccountsService.getStoredAccounts();
            const accountList =
                storedAccounts && storedAccounts.length > 0
                    ? storedAccounts
                          .filter(a => !a.status || a.status === 'active')
                          .map(a => ({
                              balance: parseFloat(a.balance) || 0,
                              currency: a.currency || 'USD',
                              is_virtual: a.account_type === 'demo' ? 1 : 0,
                              loginid: a.account_id,
                          }))
                    : currentAccount
                      ? [currentAccount]
                      : [];

            setAccountList(accountList); // Observable stream
            setAuthData({
                balance: balance?.balance,
                currency: balance?.currency,
                loginid: balance?.loginid,
                is_virtual: account_type === 'real' ? 0 : 1,
                account_list: accountList,
            });

            // // Set account_type in localStorage based on loginid prefix using centralized utility
            const loginid = balance?.loginid || '';
            const isDemo = isDemoAccount(loginid);

            if (isDemo) {
                localStorage.setItem('account_type', 'demo');
            } else {
                localStorage.setItem('account_type', 'real');
            }

            globalObserver.emit('api.authorize', {
                account_list: accountList,
                current_account: {
                    loginid: balance?.loginid,
                    currency: balance?.currency || 'USD',
                    is_virtual: account_type === 'real' ? 0 : 1,
                    balance: typeof balance?.balance === 'number' ? balance.balance : undefined,
                },
            });

            // Update the WebSocket login ID in the client store
            const currentClientStore = globalObserver.getState('client.store');
            if (currentClientStore && balance?.loginid) {
                currentClientStore.setWebSocketLoginId(balance.loginid);
            }

            setIsAuthorized(true);
            this.is_authorized = true;
            startLog('authorized');
            if (generation === this.connection_generation) this.onSessionAuthorized(generation);
            localStorage.setItem('client_account_details', JSON.stringify(accountList));
            localStorage.setItem('client.country', balance?.country);

            if (balance?.loginid) {
                localStorage.setItem('active_loginid', balance.loginid);
            }

            if (this.has_active_symbols) {
                this.toggleRunButton(false);
            } else {
                this.fetchActiveSymbols();
            }
            this.subscribe();
        } catch (e) {
            // An error during the handshake never wipes auth - the connection
            // is retried instead (see onHandshakeError).
            this.onHandshakeError();
        } finally {
            setIsAuthorizing(false);
        }
    }

    async subscribe() {
        const subscribeToStream = (streamName: string) => {
            return doUntilDone(
                () => {
                    const subscription = this.api?.send({
                        [streamName]: 1,
                        subscribe: 1,
                    });

                    if (subscription) {
                        this.current_auth_subscriptions.push(subscription);
                    }
                    return subscription;
                },
                [],
                this
            );
        };

        const streamsToSubscribe = ['balance', 'transaction', 'proposal_open_contract'];

        await Promise.all(streamsToSubscribe.map(subscribeToStream));
    }

    getActiveSymbols = async () => {
        if (!this.api) {
            throw new Error('API connection not available for fetching active symbols');
        }

        try {
            // Add timeout to prevent hanging
            const timeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Active symbols fetch timeout')), this.ACTIVE_SYMBOLS_TIMEOUT_MS)
            );

            const activeSymbolsPromise = doUntilDone(() => this.api?.send({ active_symbols: 'brief' }), [], this);
            // The market list is enriched with trading times: ask for them now, in parallel,
            // not one round trip after the list arrives (the enrichment reuses this request).
            tradingTimesService.getTradingTimes().catch(() => undefined);

            const apiResult = await Promise.race([activeSymbolsPromise, timeout]);

            const { active_symbols = [], error = {} } = apiResult as any;

            if (error && Object.keys(error).length > 0) {
                throw new Error(`Active symbols API error: ${error.message || 'Unknown error'}`);
            }

            if (!active_symbols.length) {
                throw new Error('No active symbols received from API');
            }

            this.has_active_symbols = true;

            // Process active symbols using the dedicated service with fallback
            try {
                const enrichmentTimeout = new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Enrichment timeout')), this.ENRICHMENT_TIMEOUT_MS)
                );

                const enrichmentPromise = activeSymbolsProcessorService.processActiveSymbols(active_symbols);
                const processedResult = await Promise.race([enrichmentPromise, enrichmentTimeout]);

                this.active_symbols = processedResult.enrichedSymbols;
                this.pip_sizes = processedResult.pipSizes;
            } catch (enrichmentError) {
                console.warn('Symbol enrichment failed, using raw symbols:', enrichmentError);
                // Fallback to raw symbols if enrichment fails
                this.active_symbols = active_symbols;
                this.pip_sizes = {};
            }

            this.toggleRunButton(false);
            return this.active_symbols;
        } catch (error) {
            console.error('Failed to fetch and process active symbols:', error);
            throw error;
        }
    };

    // ---------------------------------------------------------------------
    // Session.
    //
    // - api_base alone reconnects (chart-api.js does not), one attempt
    //   at a time, with backoff, only while online and visible.
    // - A close counts only for the current socket - closes of sockets being
    //   swapped out are ignored.
    // - An auth error counts only from the current, fully logged-in socket,
    //   and only if it repeats after one fresh reconnect.
    // - The session has expired only when expires_at passes, the OTP request
    //   gets a 401, or such an auth error repeats. Then a running bot / AI
    //   Scanner is stopped (run-panel-store), the user is logged out and the
    //   "Session expired" notice stays until they log in again.
    // ---------------------------------------------------------------------

    private attachSessionSocketListeners(api: TApiBaseApi | null) {
        if (!api?.connection || this.listened_apis.has(api)) return;
        this.listened_apis.add(api);
        api.connection.addEventListener('open', () => {
            if (api === this.api) this.onsocketopen();
        });
        api.connection.addEventListener('close', () => this.onSessionSocketClose(api));
    }

    /** True while there is a stored, unexpired access token. */
    hasSession() {
        return !!OAuthTokenExchangeService.getAuthInfo()?.access_token;
    }

    /** A socket is fully logged in once its own balance handshake has succeeded. */
    isFullyLoggedIn(api: TApiBaseApi | null = this.api) {
        return (
            !!api &&
            api === this.api &&
            !this.is_swapping &&
            !!api.ct_is_authenticated &&
            this.authorized_generation === this.connection_generation
        );
    }

    onSessionSocketClose(api: TApiBaseApi) {
        if (api !== this.api || this.retired_apis.has(api)) {
            return;
        }
        setConnectionStatus(CONNECTION_STATUS.CLOSED);
        this.authorized_generation = -1;
        // A running bot / AI Scanner must not carry on without a session.
        if (api.ct_is_authenticated) globalObserver.emit('session.connection_lost');
        this.scheduleReconnect('socket closed');
    }

    scheduleReconnect = (reason: string, immediate = false) => {
        if (this.is_session_expired && this.hasSession()) return;
        if (this.hasSession()) session_status.setReconnecting(true);
        if (this.is_reconnecting_now) {
            return;
        }

        // Read once, so the reason that decides is the one acted on.
        const wait_for = whatToWaitFor();
        if (wait_for) {
            if (this.reconnect_timer) clearTimeout(this.reconnect_timer);
            this.reconnect_timer = null;
            return;
        }

        if (immediate && this.reconnect_timer) {
            clearTimeout(this.reconnect_timer);
            this.reconnect_timer = null;
        }
        if (this.reconnect_timer) return;

        const delay =
            immediate || this.reconnect_step === 0
                ? 0
                : RECONNECT_BACKOFF_MS[Math.min(this.reconnect_step - 1, RECONNECT_BACKOFF_MS.length - 1)];
        this.reconnect_timer = setTimeout(() => {
            this.reconnect_timer = null;
            this.reconnectNow(reason);
        }, delay);
    };

    reconnectNow = async (reason: string) => {
        if (this.is_reconnecting_now) {
            return;
        }
        if (whatToWaitFor()) {
            this.scheduleReconnect(reason);
            return;
        }
        this.is_reconnecting_now = true;
        this.reconnect_step += 1;
        let should_retry = false;
        try {
            await this.init(true);
        } catch (error) {
            if (error instanceof SessionExpiredError) {
                this.onSessionExpired(error.reason);
            } else {
                should_retry = true;
            }
        } finally {
            this.is_reconnecting_now = false;
        }
        if (should_retry) this.scheduleReconnect('retry');
    };

    /** Tab visible again, window focused, or back online: reconnect quietly if needed. */
    onResume = (reason: string) => {
        // Away too long: logged out instead (onIdleLogout), whichever listener ran first.
        if (idle_logout.check()) return;
        if (this.checkSessionExpiry()) return;
        const ready_state = this.api?.connection?.readyState;
        if (!this.api || ready_state === undefined || ready_state > 1) {
            this.scheduleReconnect(reason, true);
            return;
        }
        // On the public socket while a session now exists (the page started
        // before it could see one - e.g. prerendered from the address bar):
        // log in on a fresh socket, as a page load would.
        if (!this.api.ct_is_authenticated && getAccountId() && this.hasSession() && !this.is_reconnecting_now) {
            this.scheduleReconnect('session found', true);
        }
    };

    onWindowOnline = () => this.onResume('online');

    onWindowFocus = () => this.onResume('focus');

    onVisibilityChange = () => {
        if (!isPageHidden()) this.onResume('visible');
    };

    onPageShow = () => this.onResume('pageshow');

    /**
     * The idle logout has finished (utils/idle-logout.ts). This page no longer
     * has a session to lose, so nothing here may report one as expired, and a
     * socket that died while the page was away is replaced by the public one.
     */
    onIdleLogout = () => {
        this.had_session = false;
        if (this.expiry_timer) clearTimeout(this.expiry_timer);
        this.expiry_timer = null;
        this.session_expires_at = null;
        this.auth_error_check = null;
        session_status.setReconnecting(false);
        if (this.api) this.onResume('idle logout');
    };

    private onSessionAuthorized(generation: number) {
        this.authorized_generation = generation;
        this.had_session = true;
        this.reconnect_step = 0;
        session_status.setReconnecting(false);
        keep_alive.start(() => this.sendKeepAlive());
        ct_perf.mark('authorized');
        if (this.first_authorized_generation === -1) this.first_authorized_generation = generation;
        else if (generation !== this.first_authorized_generation) {
            // Offerings may have changed while offline: asked again, as after a page load.
            (
                ApiHelpers.instance as { contracts_for?: { disposeCache?: () => void } } | null
            )?.contracts_for?.disposeCache?.();
            // An idle bot engine moves onto the new socket (dbot.js), so the next Run works as after a page load.
            globalObserver.emit('session.reconnected', { generation });
        }
        // The fresh connection after a first auth error: a repeat within the window confirms it.
        if (this.auth_error_check && this.auth_error_check.generation !== generation) {
            this.auth_error_check.confirm_until = Date.now() + AUTH_ERROR_CONFIRM_WINDOW_MS;
        }
        this.scheduleExpiryTimer();
    }

    /** An error answering a socket's own balance handshake: retried, never a logout. */
    private onHandshakeError() {
        this.scheduleReconnect('handshake error');
    }

    /**
     * An auth error seen on a message (CoreStoreProvider); `api` is the socket
     * it came from. Counts only from the current, fully logged-in socket, and
     * only if it repeats after one fresh reconnect.
     */
    reportAuthError = (code: string, api: TApiBaseApi | null = this.api) => {
        if (this.is_session_expired) return;
        if (!this.isFullyLoggedIn(api)) {
            return;
        }
        const check = this.auth_error_check;
        if (check && check.generation === this.connection_generation) return; // already being checked
        const is_repeat = !!check && (check.confirm_until === null || Date.now() < check.confirm_until);
        if (is_repeat) {
            this.onSessionExpired(`${code} repeated after a fresh reconnect`);
            return;
        }
        this.auth_error_check = { generation: this.connection_generation, confirm_until: null };
        this.authorized_generation = -1;
        this.scheduleReconnect('auth error check', true);
    };

    private scheduleExpiryTimer() {
        if (this.expiry_timer) clearTimeout(this.expiry_timer);
        this.expiry_timer = null;
        const expires_at = OAuthTokenExchangeService.getAuthInfo()?.expires_at;
        this.session_expires_at = expires_at || null;
        if (!expires_at) return;
        // setTimeout caps at ~24.8 days.
        const delay = Math.min(Math.max(0, expires_at - Date.now()), 2147483647);
        this.expiry_timer = setTimeout(() => this.checkSessionExpiry(), delay);
    }

    /**
     * Genuine expiry by time: expires_at has passed for the session this page
     * had - by the timer's copy, or by the stored auth_info itself (which
     * getAuthInfo removes once expired, so a vanished one counts too).
     */
    checkSessionExpiry() {
        if (this.is_session_expired || !this.had_session) return false;
        if (!localStorage.getItem('active_loginid')) return false; // logged out on purpose
        const is_past_expiry = !!this.session_expires_at && Date.now() >= this.session_expires_at;
        if (!is_past_expiry && this.hasSession()) return false;
        this.onSessionExpired(is_past_expiry ? 'expires_at passed' : 'auth_info expired or gone');
        return true;
    }

    onSessionExpired = (reason: string) => {
        if (this.is_session_expired) return;
        this.is_session_expired = true;
        if (this.reconnect_timer) clearTimeout(this.reconnect_timer);
        if (this.expiry_timer) clearTimeout(this.expiry_timer);
        this.reconnect_timer = null;
        this.expiry_timer = null;
        this.auth_error_check = null;
        keep_alive.stop();
        session_status.setReconnecting(false);

        // Stop first (run-panel-store, ai-scanner-store), then log out.
        globalObserver.emit('session.expired', { reason });
        session_status.setNotice('session_expired');
        const client_store = globalObserver.getState('client.store');
        client_store?.logout?.();
    };

    toggleRunButton = (toggle: boolean) => {
        const run_button = document.querySelector('#db-animation__run-button');
        if (!run_button) return;
        (run_button as HTMLButtonElement).disabled = toggle;
    };

    setIsRunning(toggle = false) {
        this.is_running = toggle;
        // A running bot's tab must not be frozen (socket-keep-alive.ts).
        keep_alive.setBusy('bot', toggle);
    }

    /**
     * keep-alive (utils/socket-keep-alive.ts): a ping on the
     * current socket, so the server never closes it as idle - hidden tab or not.
     */
    sendKeepAlive() {
        const api = this.api;
        if (!api || api.connection?.readyState !== 1) return;
        try {
            const request = api.send({ ping: 1 });
            ct_perf.timePing(request);
            Promise.resolve(request).catch(() => {});
        } catch {
            // The close handler deals with a dead socket.
        }
    }

    /** Unsubscribes the bot engine's listeners without touching any timers (dbot.js engine refresh). */
    dropSubscriptions() {
        this.subscriptions.forEach(s => s.unsubscribe());
        this.subscriptions = [];
    }

    pushSubscription(subscription: CurrentSubscription) {
        this.subscriptions.push(subscription);
    }

    clearSubscriptions() {
        this.subscriptions.forEach(s => s.unsubscribe());
        this.subscriptions = [];

        // Resetting timeout resolvers
        const global_timeouts = globalObserver.getState('global_timeouts') ?? [];

        global_timeouts.forEach((_: unknown, i: number) => {
            clearTimeout(i);
        });
    }
}

export const api_base = new APIBase();
