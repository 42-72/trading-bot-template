import { configure } from 'mobx';
import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
// Removed AnalyticsInitializer import - analytics dependency removed
// See migrate-docs/ANALYTICS_IMPLEMENTATION_GUIDE.md for re-implementation
import { performVersionCheck } from './utils/version-check';
import './styles/index.scss';

// TEMPORARY DIAGNOSTIC - not a fix, remove alongside the ?tourdebug=1
// overlay in onboarding-tour-mobile.tsx once the real-device measurement is
// taken. The Deriv OAuth redirect strips query params - the user leaves
// with ?tourdebug=1 on the URL and returns to a bare charlestraders.com, so
// the overlay never showed post-login. Persisting the flag to localStorage
// here, on every app load (before any React rendering, so it can't miss a
// redirect that lands on a different tab/route), survives that round trip.
try {
    const tourdebug_param = new URLSearchParams(window.location.search).get('tourdebug');
    if (tourdebug_param === '1') {
        localStorage.setItem('tourdebug', '1');
    } else if (tourdebug_param === '0') {
        localStorage.removeItem('tourdebug');
    }
} catch {
    // localStorage can throw in some privacy modes - never block app boot over this.
}

// Configure MobX to handle multiple instances in production builds
configure({ isolateGlobalState: true });

// Perform version check FIRST - before any other operations
performVersionCheck();

// Removed AnalyticsInitializer() call - analytics dependency removed

ReactDOM.createRoot(document.getElementById('root')!).render(<AuthWrapper />);

const splash = document.getElementById('mw-boot-splash');
document.documentElement.classList.remove('mw-boot');
splash?.remove();
