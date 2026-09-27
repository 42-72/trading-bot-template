import { isDebugAuthAllowed } from '@/components/shared/utils/config/config';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';

// TEMPORARY - sessionfix STEP 3 dev-only test triggers, remove once the fix
// has been verified live.
//
// This runs at module top level (not inside a hook, effect, constructor or
// class method) and is imported unconditionally from the app entry point
// (src/main.tsx), so it always executes on every route/page load -
// including ones where CoreStoreProvider or a running bot's interpreter
// instance never mount. Gated only by isDebugAuthAllowed(): never defined
// on the canonical production domain, and requires the `debugauth` opt-in
// everywhere else.
//
// Each trigger only emits the same globalObserver event the real error
// path emits - it does not fabricate a listener. So calling one of these
// still does nothing observable unless the real listener for that event
// happens to be registered elsewhere in the app at the time:
//   - __debugInjectAuthError emits 'InvalidToken', which
//     useInvalidTokenHandler (mounted by CoreStoreProvider) listens for.
//   - __debugInjectInvalidToken emits 'client.invalid_token', which
//     run-panel-store's handleInvalidToken (registered in its onMount)
//     listens for.
// Neither trigger can make interpreter.js's own run(code) promise settle
// via its reject(e) line, since that requires a real interpreter instance
// with a live run() in progress - a synthetic global emit cannot reach
// into that closure. Proving that specific line executes needs an actual
// running strategy hitting a real (or otherwise injected) InvalidToken
// from inside the interpreter itself, not this trigger.
if (isDebugAuthAllowed() && typeof window !== 'undefined') {
    window.__debugInjectInvalidToken = () => {
        globalObserver.emit('client.invalid_token');
    };

    window.__debugInjectAuthError = async () => {
        globalObserver.emit('InvalidToken');
    };
}
