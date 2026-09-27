import { configure } from 'mobx';
import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
import { performVersionCheck } from './utils/version-check';
import './styles/index.scss';
// Removed AnalyticsInitializer import - analytics dependency removed
// See migrate-docs/ANALYTICS_IMPLEMENTATION_GUIDE.md for re-implementation
// sessionfix STEP 3 dev-only test triggers - side-effect import so it runs
// unconditionally on every page load, regardless of routing. See the module
// itself for why this can't live inside a component/hook.
import './utils/debug-auth-triggers';

// Configure MobX to handle multiple instances in production builds
configure({ isolateGlobalState: true });

// Perform version check FIRST - before any other operations
performVersionCheck();

// Removed AnalyticsInitializer() call - analytics dependency removed

ReactDOM.createRoot(document.getElementById('root')!).render(<AuthWrapper />);

const splash = document.getElementById('mw-boot-splash');
document.documentElement.classList.remove('mw-boot');
splash?.remove();
