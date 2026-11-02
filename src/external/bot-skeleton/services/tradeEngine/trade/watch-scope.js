import * as constants from './state/constants';

/* The watchScope function is called randomly and resets the prevTick
 * which leads to the same problem we try to solve. So prevTick is isolated
 */
let prevTick;

/**
 * Resolves true when the store reaches passScope with passFlag set, false
 * when it reaches stopScope. Normally both are only checked on a store
 * update that carries a NEW tick.
 *
 * Fast execution adds two exceptions, both off by default (Normal):
 * - resolve_stop_without_tick: resolve false as soon as stopScope is reached
 *   (the contract's result is in), instead of on the next tick.
 * - fast_pass: resolve true as soon as passScope + passFlag hold, instead of
 *   on the next tick. Single use - the caller grants it once per result.
 */
export const watchScope = ({
    store,
    stopScope,
    passScope,
    passFlag,
    resolve_stop_without_tick = false,
    fast_pass = false,
}) => {
    // in case watch is called after stop is fired
    if (store.getState().scope === stopScope) {
        return Promise.resolve(false);
    }
    const isPassing = state => state.scope === passScope && state[passFlag];
    if (fast_pass && isPassing(store.getState())) {
        return Promise.resolve(true);
    }
    return new Promise(resolve => {
        const unsubscribe = store.subscribe(() => {
            const newState = store.getState();

            if (resolve_stop_without_tick && newState.scope === stopScope) {
                unsubscribe();
                resolve(false);
                return;
            }
            if (fast_pass && isPassing(newState)) {
                unsubscribe();
                resolve(true);
                return;
            }

            if (newState.newTick === prevTick) return;
            prevTick = newState.newTick;

            if (isPassing(newState)) {
                unsubscribe();
                resolve(true);
            }

            if (newState.scope === stopScope) {
                unsubscribe();
                resolve(false);
            }
        });
    });
};

export const watchBefore = (store, fast_pass = false) =>
    watchScope({
        store,
        stopScope: constants.DURING_PURCHASE,
        passScope: constants.BEFORE_PURCHASE,
        passFlag: 'proposalsReady',
        fast_pass,
    });

export const watchDuring = (store, resolve_stop_without_tick = false) =>
    watchScope({
        store,
        stopScope: constants.STOP,
        passScope: constants.DURING_PURCHASE,
        passFlag: 'openContract',
        resolve_stop_without_tick,
    });
