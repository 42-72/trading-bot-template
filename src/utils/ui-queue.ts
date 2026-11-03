/**
 * UI work of the trade engine's events (Transactions, Summary, Journal, the
 * run panel's stage, Google Tag Manager), run AFTER the engine is done with
 * the message that caused it.
 *
 * The engine's events are synchronous (globalObserver.emit), and in Fast
 * mode the next buy is sent from promise callbacks that run right after the
 * contract-update message is handled - so every UI listener used to sit
 * between "the result is in" and "the next buy is sent". Listeners wrapped
 * with deferUi() are queued instead and run, in order, in the next task (a
 * MessageChannel task: not throttled in a hidden tab like setTimeout).
 *
 * flushUi() runs everything queued at once. Synchronous listeners that read
 * or change the same state (bot stop, errors) call it first, so the order of
 * events is exactly as before - only the moment the UI catches up changes.
 */
type TJob = () => void;

const queue: TJob[] = [];
let is_scheduled = false;
let channel: MessageChannel | null = null;

const schedule = () => {
    if (is_scheduled) return;
    is_scheduled = true;
    try {
        if (!channel && typeof MessageChannel !== 'undefined') {
            channel = new MessageChannel();
            channel.port1.onmessage = () => flushUi();
        }
    } catch {
        channel = null;
    }
    if (channel) channel.port2.postMessage(null);
    else setTimeout(flushUi, 0);
};

/** Runs every queued UI job now, in order. */
export const flushUi = () => {
    is_scheduled = false;
    while (queue.length) {
        const job = queue.shift() as TJob;
        try {
            job();
        } catch (error) {
            // One failing UI update must never stop the others (or reach the engine).
            // eslint-disable-next-line no-console
            console.error('[ui-queue]', error);
        }
    }
};

/** A listener that runs later, in order with the other deferred UI listeners. */
export const deferUi =
    <TArgs extends unknown[]>(listener: (...args: TArgs) => void) =>
    (...args: TArgs) => {
        queue.push(() => listener(...args));
        schedule();
    };

/** A listener that first lets the deferred UI catch up (keeps the order of events). */
export const afterUi =
    <TArgs extends unknown[], TResult>(listener: (...args: TArgs) => TResult) =>
    (...args: TArgs): TResult => {
        flushUi();
        return listener(...args);
    };

/** Jobs still waiting (tests, [CT perf]). */
export const pendingUiJobs = () => queue.length;
