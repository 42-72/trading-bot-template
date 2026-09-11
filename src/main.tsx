import { configure } from 'mobx';
import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
// Removed AnalyticsInitializer import - analytics dependency removed
// See migrate-docs/ANALYTICS_IMPLEMENTATION_GUIDE.md for re-implementation
import { performVersionCheck } from './utils/version-check';
import { initVisualViewportGap } from './utils/visual-viewport';
import './styles/index.scss';

// Configure MobX to handle multiple instances in production builds
configure({ isolateGlobalState: true });

// Perform version check FIRST - before any other operations
performVersionCheck();

// Removed AnalyticsInitializer() call - analytics dependency removed

// Lives for the page lifetime - no cleanup needed.
initVisualViewportGap();

ReactDOM.createRoot(document.getElementById('root')!).render(<AuthWrapper />);

const splash = document.getElementById('mw-boot-splash');
document.documentElement.classList.remove('mw-boot');
splash?.remove();
