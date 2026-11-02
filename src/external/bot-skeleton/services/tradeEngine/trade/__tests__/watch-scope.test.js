import { applyMiddleware, createStore } from 'redux';
import { thunk } from 'redux-thunk';
import { FAST_MIN_BUY_GAP_MS, getBuyGapDelayMs } from '../../utils/execution-mode';
import { openContractReceived, proposalsReady, purchaseSuccessful, sell, start } from '../state/actions';
import * as constants from '../state/constants';
import rootReducer from '../state/reducers';
import { watchBefore, watchDuring } from '../watch-scope';

let epoch = 1000;
const newTick = store => store.dispatch({ type: constants.NEW_TICK, payload: ++epoch });

/** Resolved value, or 'pending' if the promise hasn't settled once queued callbacks have run. */
const settled = promise => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve('pending'), 0))]);

const makeStore = () => createStore(rootReducer, applyMiddleware(thunk));

/** A store with a contract bought and open, the way the engine has it during a purchase. */
const storeWithOpenContract = () => {
    const store = makeStore();
    store.dispatch(proposalsReady());
    store.dispatch(start());
    store.dispatch(purchaseSuccessful());
    store.dispatch(openContractReceived());
    newTick(store);
    return store;
};

/** A store just after a result: sold, then Bot.start for the next contract. */
const storeAfterResult = ({ proposals_ready = true } = {}) => {
    const store = storeWithOpenContract();
    store.dispatch(sell());
    if (!proposals_ready) store.dispatch({ type: constants.CLEAR_PROPOSALS });
    store.dispatch(start());
    return store;
};

/** One During Purchase pass: watch, then the next store update; the engine's own order of messages. */
const passDuring = (store, dispatchUpdate, resolve_stop_without_tick = false) => {
    const during = watchDuring(store, resolve_stop_without_tick);
    dispatchUpdate();
    return settled(during);
};

describe("Normal execution (today's path)", () => {
    it('result right after a contract update: "during" ends only on the next new tick', async () => {
        const store = storeWithOpenContract();
        expect(await passDuring(store, () => newTick(store))).toBe(true);
        expect(await passDuring(store, () => store.dispatch(openContractReceived()))).toBe(true);
        const during = watchDuring(store);
        store.dispatch(sell());
        expect(await settled(during)).toBe('pending');
        newTick(store);
        expect(await settled(during)).toBe(false);
    });

    it('result right after a tick: "during" already ends at once (reducer drops newTick on SELL)', async () => {
        const store = storeWithOpenContract();
        expect(await passDuring(store, () => newTick(store))).toBe(true);
        expect(await passDuring(store, () => store.dispatch(sell()))).toBe(false);
    });

    it('"before" passes only on a new tick, even when the bot is ready', async () => {
        const store = storeAfterResult();
        const before = watchBefore(store);
        expect(await settled(before)).toBe('pending');
        newTick(store);
        expect(await settled(before)).toBe(true);
    });
});

describe('Fast execution', () => {
    it('result right after a contract update: "during" ends at once - no new tick needed', async () => {
        const store = storeWithOpenContract();
        expect(await passDuring(store, () => newTick(store), true)).toBe(true);
        expect(await passDuring(store, () => store.dispatch(openContractReceived()), true)).toBe(true);
        expect(await passDuring(store, () => store.dispatch(sell()), true)).toBe(false);
    });

    it('"during" still waits for a new tick while the contract is open', async () => {
        const store = storeWithOpenContract();
        // One During Purchase pass per tick, as in the engine's loop (also syncs the
        // module's shared last-seen tick with this store).
        const first_pass = watchDuring(store, true);
        newTick(store);
        expect(await settled(first_pass)).toBe(true);

        const during = watchDuring(store, true);
        // A store update that keeps the same tick (proposals arriving). Note: the
        // reducer drops newTick on OPEN_CONTRACT/SELL/START, so the engine (in both
        // modes) already treats each contract update as "new" - unchanged here.
        store.dispatch(proposalsReady());
        expect(await settled(during)).toBe('pending');
        newTick(store);
        expect(await settled(during)).toBe(true);
    });

    it('with the pass, "before" passes at once when the bot is ready', async () => {
        const store = storeAfterResult();
        expect(await settled(watchBefore(store, true))).toBe(true);
    });

    it('with the pass, "before" does not pass while proposals are not ready - then passes when they are', async () => {
        const store = storeAfterResult({ proposals_ready: false });
        const before = watchBefore(store, true);
        expect(await settled(before)).toBe('pending');
        store.dispatch(proposalsReady());
        expect(await settled(before)).toBe(true);
    });

    it('without the pass (already spent), "before" waits for a new tick as in Normal', async () => {
        const store = storeAfterResult();
        const before = watchBefore(store, false);
        expect(await settled(before)).toBe('pending');
        newTick(store);
        expect(await settled(before)).toBe(true);
    });

    it('never passes "before" while a contract is open', async () => {
        const store = storeWithOpenContract();
        expect(await settled(watchBefore(store, true))).toBe(false);
    });
});

describe('Fast minimum gap between buys', () => {
    it('no wait for the first buy', () => {
        expect(getBuyGapDelayMs(undefined, 10_000)).toBe(0);
    });

    it('waits out the rest of the gap', () => {
        expect(getBuyGapDelayMs(10_000, 10_200)).toBe(FAST_MIN_BUY_GAP_MS - 200);
    });

    it('no wait once the gap has passed', () => {
        expect(getBuyGapDelayMs(10_000, 10_000 + FAST_MIN_BUY_GAP_MS)).toBe(0);
        expect(getBuyGapDelayMs(10_000, 14_000)).toBe(0);
    });

    it('the gap is about 500 ms', () => {
        expect(FAST_MIN_BUY_GAP_MS).toBe(500);
    });
});
