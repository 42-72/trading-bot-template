import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import {
    connectionStatus$,
    isAuthorized$,
} from '@/external/bot-skeleton/services/api/observables/connection-status-stream';

// TEMPORARY diagnostics for "every scanner feed goes silent at once". Every
// line is tagged [AI-SILENCE]. Remove this file, and its calls
// (ai-scanner-store.ts, useDigitAnalysis.ts), when no longer needed.
//
// Logs: socket open / close / error and every connection-status and
// authorized change; every forget / forget_all sent on the app's socket,
// with who sent it; the time of the last message of any kind; and a ping
// probe that tells a stalled socket (no reply) from Deriv pausing streams
// on a live one (quick reply).

type TApi = {
    send: (request: Record<string, unknown>) => Promise<unknown>;
    connection?: WebSocket;
    onMessage: () => { subscribe: (listener: (message: unknown) => void) => { unsubscribe: () => void } };
    __ai_silence_wrapped?: boolean;
};

const stamp = () => new Date().toISOString().slice(11, 23);

export const silenceLog = (...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.info(`[AI-SILENCE] ${stamp()}`, ...args);
};

/** The line of the stack that called `send` - the code asking for the forget. */
const caller = () => {
    const lines = (new Error().stack ?? '').split('\n').map(line => line.trim());
    return lines.slice(3, 6).join(' <- ') || 'unknown';
};

let last_message_at = 0;
let installed_on: TApi | null = null;
let message_subscription: { unsubscribe: () => void } | null = null;

/** When the app's socket last delivered anything (ms since epoch; 0 = nothing yet). */
export const lastSocketMessageAt = () => last_message_at;

// Diagnostics must never break the app: every step is guarded.
const watchApi = () => {
    try {
        watchApiUnsafe();
    } catch (error) {
        silenceLog('could not watch the socket', error);
    }
};

const watchApiUnsafe = () => {
    const api = api_base.api as unknown as TApi | null;
    if (!api || api === installed_on || typeof api.send !== 'function') return;
    silenceLog('watching a new api_base socket', { readyState: api.connection?.readyState });
    message_subscription?.unsubscribe();
    installed_on = api;

    if (typeof api.onMessage === 'function') {
        message_subscription = api.onMessage().subscribe(() => {
            last_message_at = Date.now();
        });
    }

    const connection = api.connection;
    if (typeof connection?.addEventListener !== 'function') return;
    connection.addEventListener('open', () => silenceLog('socket open'));
    connection.addEventListener('close', event =>
        silenceLog('socket close', { code: event.code, reason: event.reason, was_clean: event.wasClean })
    );
    connection.addEventListener('error', () => silenceLog('socket error'));

    if (!api.__ai_silence_wrapped) {
        const send = api.send.bind(api);
        api.send = (request: Record<string, unknown>) => {
            if (request && ('forget' in request || 'forget_all' in request)) {
                silenceLog('sent', JSON.stringify(request), 'from', caller());
            }
            return send(request);
        };
        api.__ai_silence_wrapped = true;
    }
};

let is_installed = false;

/** Start the diagnostics (once). */
export const installSilenceLog = () => {
    if (is_installed) return;
    is_installed = true;
    connectionStatus$.subscribe(status => {
        silenceLog('connection status', status);
        watchApi();
    });
    isAuthorized$.subscribe(is_authorized => silenceLog('authorized', is_authorized));
    // The socket can be replaced (reconnect, account switch): keep following it.
    setInterval(watchApi, 2000);
};

/**
 * Ping the app's socket: a quick reply means the socket is alive (Deriv
 * stopped sending ticks); no reply within 3s means the socket itself stalled.
 */
export const probeSocket = (label: string) => {
    const api = api_base.api as unknown as TApi | null;
    if (typeof api?.send !== 'function') return;
    const sent_at = Date.now();
    const timeout = setTimeout(
        () => silenceLog(`${label}: ping got NO reply within 3s - the socket / network itself stalled`),
        3000
    );
    api.send({ ping: 1 })
        .then(() => {
            clearTimeout(timeout);
            silenceLog(`${label}: ping replied in ${Date.now() - sent_at}ms - the socket is alive`);
        })
        .catch(error => {
            clearTimeout(timeout);
            silenceLog(`${label}: ping failed`, error);
        });
};
