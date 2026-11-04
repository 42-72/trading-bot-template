import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useApiBase } from '@/hooks/useApiBase';
import { useAuthActions } from '@/hooks/useAuthActions';
import { useStore } from '@/hooks/useStore';
import { hideBootSplash } from '@/utils/boot-splash';
import { session_status } from '@/utils/session-status';
import { Localize, localize } from '@deriv-com/translations';
import DigitRain from './DigitRain';
import MarketChart from './MarketChart';
import './landing-page.scss';

const DISMISS_KEY = 'ct-landing-dismissed';
const CYCLE_MS = 4000;
const TYPE_SPEED_MS = 40;

const HEADLINE_PAIRS = [
    {
        title: 'Automate your trades',
        description: "Build, import and run trading bots on Deriv's markets — no coding required.",
    },
    {
        title: 'Analyse before you act',
        description: "Live digit and tick analysis for synthetic indices, so you're reading the market.",
    },
    {
        title: 'Run bots, not spreadsheets',
        description: 'Import a strategy or build one block by block, then let it run while you get on with your day.',
    },
    {
        title: 'Everything in one workspace',
        description: 'Bot builder, charts, market tools, copy trading and DTrader — one login, one place.',
    },
];

const FACTS = [
    { text: 'Powered by Deriv' },
    { text: 'Free demo account with virtual funds' },
    { text: 'Import your own strategies' },
    { text: 'Trade at your own risk', isCaution: true },
];

// Synchronous check: does ANY token exist that could still resolve to a logged-in
// session? If not, the visitor is definitively logged out right now — there is no
// pending API call that will ever change that (see api-base.ts's
// handleTokenExchangeIfNeeded, which only ever authorizes when an account id is
// already present). Only when a token exists is waiting on isAuthorizing correct.
const hasStoredAuthToken = () => {
    try {
        return Boolean(
            localStorage.getItem('authToken') ||
            localStorage.getItem('active_loginid') ||
            sessionStorage.getItem('auth_info')
        );
    } catch {
        // Storage inaccessible (private browsing, etc.) — nothing to validate either way.
        return false;
    }
};

const LandingPage = observer(() => {
    const { isAuthorizing, activeLoginid } = useApiBase();
    const { handleLogin, handleSignup } = useAuthActions();
    // Demo <-> real switch: the old account is cleared before the new one logs in.
    // That gap is not "logged out" - showing this full-screen page in it looked like a reload.
    const is_switching_account = !!useStore()?.client?.is_account_regenerating;

    const [isDismissed, setIsDismissed] = useState(() => {
        try {
            return sessionStorage.getItem(DISMISS_KEY) === '1';
        } catch {
            return false;
        }
    });

    const prefersReducedMotion = useRef(
        typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ).current;

    const [pairIndex, setPairIndex] = useState(0);
    const [typedLength, setTypedLength] = useState(prefersReducedMotion ? HEADLINE_PAIRS[0].title.length : 0);

    useEffect(() => {
        if (prefersReducedMotion) return undefined;

        const title = HEADLINE_PAIRS[pairIndex].title;
        setTypedLength(0);
        let typed = 0;
        const typeTimer = setInterval(() => {
            typed += 1;
            setTypedLength(typed);
            if (typed >= title.length) clearInterval(typeTimer);
        }, TYPE_SPEED_MS);

        const cycleTimer = setTimeout(() => {
            setPairIndex(prev => (prev + 1) % HEADLINE_PAIRS.length);
        }, CYCLE_MS);

        return () => {
            clearInterval(typeTimer);
            clearTimeout(cycleTimer);
        };
    }, [pairIndex, prefersReducedMotion]);

    // "Still checking" (a token exists, not yet validated) and "checked, logged out"
    // (no token, or validation resolved to no active login) are different states —
    // only the first is a reason to wait.
    const hasStoredToken = hasStoredAuthToken();
    const isStillChecking = hasStoredToken && (isAuthorizing || is_switching_account);
    const isConfirmedLoggedIn = hasStoredToken && !isAuthorizing && Boolean(activeLoginid);
    // Logged out for being away: the trader stays on the page they left.
    const is_hidden = isDismissed || isStillChecking || isConfirmedLoggedIn || session_status.is_idle_logged_out;

    // This page is a full screen of its own: the start-up splash makes way for it.
    useEffect(() => {
        if (!is_hidden) hideBootSplash('landing page');
    }, [is_hidden]);

    if (is_hidden) return null;

    const activePair = HEADLINE_PAIRS[pairIndex];

    const handleDismiss = () => {
        try {
            sessionStorage.setItem(DISMISS_KEY, '1');
        } catch {
            // sessionStorage unavailable — dismiss still applies for this render
        }
        setIsDismissed(true);
    };

    return (
        <div className='landing-page'>
            <MarketChart />
            <DigitRain />
            <div className='landing-page__vignette' aria-hidden='true' />

            <h1 className='landing-page__sr-title'>{localize('CharlesTraders — automated trading on Deriv')}</h1>

            <div className='landing-page__content'>
                <span className='landing-page__badge'>
                    <Localize i18n_default_text='Powered by Deriv' />
                </span>

                <div className='landing-page__wordmark brand-wordmark'>
                    <span className='brand-wordmark__charles'>Charles</span>
                    <span className='brand-wordmark__traders'>Traders</span>
                </div>

                <div className='landing-page__headline' aria-hidden='true'>
                    <div className='landing-page__title'>
                        {activePair.title.slice(0, typedLength)}
                        <span className='landing-page__caret' />
                    </div>
                    <p key={pairIndex} className='landing-page__description'>
                        {activePair.description}
                    </p>
                </div>

                <div className='landing-page__ctas'>
                    <button
                        type='button'
                        className='landing-page__cta landing-page__cta--primary'
                        onClick={handleSignup}
                    >
                        <Localize i18n_default_text='Sign up' />
                    </button>
                    <button
                        type='button'
                        className='landing-page__cta landing-page__cta--secondary'
                        onClick={handleLogin}
                    >
                        <Localize i18n_default_text='Log in' />
                    </button>
                </div>

                <ul className='landing-page__facts'>
                    {FACTS.map(fact => (
                        <li
                            key={fact.text}
                            className={fact.isCaution ? 'landing-page__facts-item--caution' : undefined}
                        >
                            {fact.text}
                        </li>
                    ))}
                </ul>
            </div>

            <button type='button' className='landing-page__dismiss' onClick={handleDismiss}>
                <Localize i18n_default_text='Continue without an account' />
            </button>
        </div>
    );
});

export default LandingPage;
