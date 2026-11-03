import { configure } from 'mobx';
import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
// Removed AnalyticsInitializer import - analytics dependency removed
// See migrate-docs/ANALYTICS_IMPLEMENTATION_GUIDE.md for re-implementation
import { ct_perf, installCtPerf } from './utils/ct-perf';
import { removeRetiredStorageKeys } from './utils/page-start';
import { performVersionCheck } from './utils/version-check';
import './styles/index.scss';

// Configure MobX to handle multiple instances in production builds
configure({ isolateGlobalState: true });

// eslint-disable-next-line no-console
console.info(`[Build] ${process.env.BUILD_COMMIT} @ ${process.env.BUILD_TIME}`);

// [CT perf] (console only): execution timing, stalls, subscriptions - window.__ctPerf()
installCtPerf();
const hideBootSplashLoader = ct_perf.loaderShown('boot splash');

// Perform version check FIRST - before any other operations
performVersionCheck();

// Storage keys of removed features (connection log, old session switch)
removeRetiredStorageKeys();

// Removed AnalyticsInitializer() call - analytics dependency removed

ReactDOM.createRoot(document.getElementById('root')!).render(<AuthWrapper />);

const splash = document.getElementById('mw-boot-splash');
document.documentElement.classList.remove('mw-boot');
splash?.remove();
hideBootSplashLoader();
