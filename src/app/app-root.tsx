import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import ErrorBoundary from '@/components/error-component/error-boundary';
import ErrorComponent from '@/components/error-component/error-component';
import ChunkLoader from '@/components/loader/chunk-loader';
import SessionNotice from '@/components/session-notice/session-notice';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { idle_logout } from '@/utils/idle-logout';
import { isOAuthCallbackURL, whenOAuthExchangeSettled } from '@/utils/oauth-start';
import { isPrerendering, whenPageActivated } from '@/utils/page-start';
import { isBotOrScannerRunning } from '@/utils/run-activity';
import { startLog } from '@/utils/start-log';
import { localize } from '@deriv-com/translations';
import './app-root.scss';

const AppContent = lazy(() => import('./app-content'));

const AppRootLoader = () => {
    return <ChunkLoader message={localize('Loading...')} />;
};

const ErrorComponentWrapper = observer(() => {
    const { common } = useStore();

    if (!common.error) return null;

    return (
        <ErrorComponent
            header={common.error?.header}
            message={common.error?.message}
            redirect_label={common.error?.redirect_label}
            redirectOnClick={common.error?.redirectOnClick}
            should_clear_error_on_click={common.error?.should_clear_error_on_click}
            setError={common.setError}
            redirect_to={common.error?.redirect_to}
            should_redirect={common.error?.should_redirect}
        />
    );
});

const AppRoot = () => {
    const store = useStore();
    const api_base_initialized = useRef(false);
    const [is_api_initialized, setIsApiInitialized] = useState(false);

    // Initialize API. The store is created in the effect right after this one's first run.
    const has_store = !!store;
    useEffect(() => {
        if (!has_store) return undefined;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        const initializeApi = async () => {
            startLog(`page start${isOAuthCallbackURL() ? ' (login return)' : ''}`);
            // A page prerendered from the address bar can't see the tab's login
            // (sessionStorage) yet: opening the socket now would start it logged out.
            if (isPrerendering()) startLog('prerendered - waiting until the page is shown');
            await whenPageActivated();
            // Before the socket: an expired login must not start a logged-in one.
            await idle_logout.start({
                isBusy: () => isBotOrScannerRunning(store) || api_base.is_running,
                logout: () => store.client.logout(),
                onLoggedOut: () => api_base.onIdleLogout(),
                restorePage: () => {
                    const last_tab = Number(localStorage.getItem('active_tab'));
                    if (last_tab && !window.location.hash) store.dashboard.setActiveTab(last_tab);
                },
            });
            // Login return: the token exchange opens the logged-in socket itself.
            // A public socket opened meanwhile would be closed again by it, and
            // what waits on it would never be answered.
            if (isOAuthCallbackURL()) {
                startLog('login return - waiting for the token exchange before connecting');
                await whenOAuthExchangeSettled();
            }
            timeoutId = setTimeout(() => {
                if (!is_api_initialized) {
                    setIsApiInitialized(true);
                }
            }, 5000);
            if (!api_base_initialized.current) {
                try {
                    const ready_state = api_base.api?.connection?.readyState;
                    if (ready_state === 0 || ready_state === 1) {
                        startLog('connection already opened by the token exchange - using it');
                    } else {
                        startLog('connecting');
                        await api_base.init();
                    }
                    api_base_initialized.current = true;
                } catch (error) {
                    console.error('API initialization failed:', error);
                    api_base_initialized.current = false;
                } finally {
                    setIsApiInitialized(true);
                    clearTimeout(timeoutId); // Clear timeout if API init completes
                }
            }
        };

        initializeApi();
        return () => clearTimeout(timeoutId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [has_store]);

    if (!store || !is_api_initialized) return <AppRootLoader />;

    return (
        <>
            <Suspense fallback={<AppRootLoader />}>
                <ErrorBoundary root_store={store}>
                    <ErrorComponentWrapper />
                    <AppContent />
                </ErrorBoundary>
            </Suspense>
            <SessionNotice />
        </>
    );
};

export default AppRoot;
