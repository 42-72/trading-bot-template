/* eslint-disable no-confusing-arrow */
import { Map } from 'immutable';
import { ct_perf } from '@/utils/ct-perf';
import { getLast, historyToTicks } from '../../utils/binary-utils';
import { observer as globalObserver } from '../../utils/observer';
import { doUntilDone, getUUID } from '../tradeEngine/utils/helpers';
import { api_base } from './api-base';

const parseTick = tick => ({
    epoch: +tick.epoch,
    quote: +tick.quote,
});

const parseOhlc = ohlc => ({
    open: +ohlc.open,
    high: +ohlc.high,
    low: +ohlc.low,
    close: +ohlc.close,
    epoch: +(ohlc.open_time || ohlc.epoch),
});

const parseCandles = candles => candles.map(t => parseOhlc(t));

const updateTicks = (ticks, newTick) => (getLast(ticks).epoch >= newTick.epoch ? ticks : [...ticks.slice(1), newTick]);

const updateCandles = (candles, ohlc) => {
    const lastCandle = getLast(candles);
    if (
        (lastCandle.open === ohlc.open &&
            lastCandle.high === ohlc.high &&
            lastCandle.low === ohlc.low &&
            lastCandle.close === ohlc.close &&
            lastCandle.epoch === ohlc.epoch) ||
        lastCandle.epoch > ohlc.epoch
    ) {
        return candles;
    }
    const prevCandles = lastCandle.epoch === ohlc.epoch ? candles.slice(0, -1) : candles.slice(1);
    return [...prevCandles, ohlc];
};

const getType = isCandle => (isCandle ? 'candles' : 'ticks');

/**
 * A request sent on a closed socket is never answered by
 * deriv-api (its promise neither resolves nor rejects), so a forget on it
 * would hang the Stop path forever. Its subscriptions died with it anyway.
 */
const isSocketGone = () => api_base.api?.connection?.readyState !== 1;

export default class TicksService {
    constructor() {
        this.ticks = new Map();
        this.candles = new Map();
        this.tickListeners = new Map();
        this.ohlcListeners = new Map();
        this.subscriptions = new Map();
        this.ticks_history_promise = null;
        this.active_symbols_promise = null;
        this.candles_promise = null;
        // Symbols whose tick stream belongs to another part of the app (Market Tool, AI
        // Scanner, chart) on this same socket: Deriv allows one stream per symbol per
        // socket, so the bot reads that one instead of its own (see shareTickStream).
        this.shared_symbols = new Set();

        this.observe();
    }

    requestPipSizes() {
        if (this.pipSizes) {
            return Promise.resolve(this.pipSizes);
        }

        if (!this.active_symbols_promise) {
            this.active_symbols_promise = new Promise(resolve => {
                this.pipSizes = api_base.pip_sizes;
                resolve(this.pipSizes);
            });
        }
        return this.active_symbols_promise;
    }

    async request(options) {
        return new Promise((resolve, reject) => {
            const { symbol, granularity } = options;

            const style = getType(granularity);

            if (style === 'ticks' && this.ticks.has(symbol)) {
                resolve(this.ticks.get(symbol));
            }

            if (style === 'candles' && this.candles.hasIn([symbol, Number(granularity)])) {
                resolve(this.candles.getIn([symbol, Number(granularity)]));
            }
            this.requestStream({ ...options, style })
                .then(res => {
                    resolve(res);
                })
                .catch(e => {
                    reject(e);
                });
        });
    }

    monitor(options) {
        return new Promise((resolve, reject) => {
            const { symbol, granularity, callback } = options;

            const type = getType(granularity);

            const key = getUUID();
            this.request(options)
                .then(() => {
                    if (type === 'ticks') {
                        this.tickListeners = this.tickListeners.setIn([symbol, key], callback);
                        globalObserver.emit('bot.bot_ready');
                        api_base.toggleRunButton(false);
                    } else {
                        this.ohlcListeners = this.ohlcListeners.setIn([symbol, Number(granularity), key], callback);
                    }
                    resolve(key);
                })
                .catch(e => {
                    globalObserver.emit('Error', e);
                    this.ticks_history_promise = null;
                    api_base.toggleRunButton(false);
                    reject(e);
                });
        });
    }

    async stopMonitor(options) {
        const { symbol, granularity, key } = options;
        const type = getType(granularity);

        if (type === 'ticks' && this.tickListeners.hasIn([symbol, key])) {
            this.tickListeners = this.tickListeners.deleteIn([symbol, key]);
        }

        if (type === 'candles' && this.ohlcListeners.hasIn([symbol, Number(granularity), key])) {
            this.ohlcListeners = this.ohlcListeners.deleteIn([symbol, Number(granularity), key]);
        }

        await this.unsubscribeIfEmptyListeners(options);
    }

    async unsubscribeIfEmptyListeners(options) {
        const { symbol, granularity } = options;

        let needToUnsubscribe = false;

        const tickListener = this.tickListeners.get(symbol);

        if (tickListener && !tickListener.size) {
            this.tickListeners = this.tickListeners.delete(symbol);
            this.ticks = this.ticks.delete(symbol);
            needToUnsubscribe = true;
        }

        const ohlcListener = this.ohlcListeners.getIn([symbol, Number(granularity)]);

        if (ohlcListener && !ohlcListener.size) {
            this.ohlcListeners = this.ohlcListeners.deleteIn([symbol, Number(granularity)]);
            this.candles = this.candles.deleteIn([symbol, Number(granularity)]);
            needToUnsubscribe = true;
        }

        if (needToUnsubscribe) {
            await this.unsubscribeAllAndSubscribeListeners(symbol);
        }
    }

    unsubscribeAllAndSubscribeListeners(symbol) {
        const ohlcSubscriptions = this.subscriptions.getIn(['ohlc', symbol]);

        const subscription = [...(ohlcSubscriptions ? Array.from(ohlcSubscriptions.values()) : [])];

        Promise.all(subscription.map(id => doUntilDone(() => api_base.api.forget(id))));

        this.subscriptions = new Map();
    }

    updateTicksAndCallListeners(symbol, ticks) {
        if (this.ticks.get(symbol) === ticks) {
            return;
        }
        this.ticks = this.ticks.set(symbol, ticks);

        const listeners = this.tickListeners.get(symbol);

        if (listeners) {
            listeners.forEach(callback => callback(this.ticks.get(symbol)));
        }
    }

    updateCandlesAndCallListeners(address, candles) {
        if (this.ticks.getIn(address) === candles) {
            return;
        }
        this.candles = this.candles.setIn(address, candles);

        const listeners = this.ohlcListeners.getIn(address);

        if (listeners) {
            listeners.forEach(callback => callback(this.candles.getIn(address)));
        }
    }

    observe() {
        if (api_base.api) {
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'tick') {
                    const { tick } = data;
                    const { symbol, id } = tick;
                    if (this.ticks.has(symbol)) {
                        ct_perf.botTick();
                        this.subscriptions = this.subscriptions.setIn(['tick', symbol], id);
                        this.updateTicksAndCallListeners(symbol, updateTicks(this.ticks.get(symbol), parseTick(tick)));
                    }
                }

                // The stream the bot was sharing was forgotten by its owner (e.g. the
                // Market Tool closed): the bot subscribes in its own right, so its ticks
                // never stop. Only a single `forget` - the bot's own forget_all on stop
                // must not bring the stream back.
                if (data.msg_type === 'forget' && data.forget === 1 && data.echo_req?.forget) {
                    this.onSharedStreamForgotten(String(data.echo_req.forget));
                }

                if (data.msg_type === 'ohlc') {
                    const { ohlc } = data;
                    const { symbol, granularity, id } = ohlc;
                    if (this.candles.hasIn([symbol, Number(granularity)])) {
                        this.subscriptions = this.subscriptions.setIn(['ohlc', symbol, Number(granularity)], id);
                        const address = [symbol, Number(granularity)];
                        this.updateCandlesAndCallListeners(
                            address,
                            updateCandles(this.candles.getIn(address), parseOhlc(ohlc))
                        );
                    }
                }
            });
            api_base.pushSubscription(subscription);
        }
    }

    requestStream(options) {
        const { style } = options;
        const stringified_options = JSON.stringify(options);

        if (style === 'ticks') {
            // Check if we already have a promise for these exact options
            if (!this.ticks_history_promise || this.ticks_history_promise.stringified_options !== stringified_options) {
                this.ticks_history_promise = {
                    promise: this.requestPipSizes().then(() => this.requestTicks(options)),
                    stringified_options,
                };
            }

            return this.ticks_history_promise.promise;
        }

        if (style === 'candles') {
            // Check if we already have a promise for these exact options
            if (!this.candles_promise || this.candles_promise.stringified_options !== stringified_options) {
                this.candles_promise = {
                    promise: this.requestPipSizes().then(() => this.requestTicks(options)),
                    stringified_options,
                };
            }

            return this.candles_promise.promise;
        }

        return [];
    }

    requestTicks(options) {
        const { symbol, granularity, style } = options;
        const request_object = {
            ticks_history: symbol === 'na' ? 'R_100' : symbol,
            subscribe: 1,
            end: 'latest',
            count: 1000,
            granularity: granularity ? Number(granularity) : undefined,
            style,
        };
        return new Promise((resolve, reject) => {
            if (!api_base.api) resolve([]);
            // AlreadySubscribed is not retried (it used to be, forever, while a bot ran):
            // the stream already exists, so the bot shares it (catch below).
            doUntilDone(() => api_base.api.send(request_object), [], api_base)
                .then(r => {
                    if (style === 'ticks') {
                        this.shared_symbols.delete(symbol);
                        const ticks = historyToTicks(r.history);

                        this.updateTicksAndCallListeners(symbol, ticks);
                        resolve(ticks);
                    } else {
                        const candles = parseCandles(r.candles);

                        this.updateCandlesAndCallListeners([symbol, Number(granularity)], candles);

                        resolve(candles);
                    }
                })
                .catch(error => {
                    // Handle AlreadySubscribed errors gracefully - they're not fatal
                    if (error?.error?.code === 'AlreadySubscribed') {
                        // Another part of the app already streams this symbol's ticks on this
                        // socket: share that stream - never ignore its ticks.
                        if (style === 'ticks') {
                            this.shareTickStream(symbol, request_object.ticks_history).then(resolve, reject);
                            return;
                        }
                        // For AlreadySubscribed errors, we can still resolve with existing data
                        if (style === 'ticks' && this.ticks.has(symbol)) {
                            resolve(this.ticks.get(symbol));
                        } else if (style === 'candles' && this.candles.hasIn([symbol, Number(granularity)])) {
                            resolve(this.candles.getIn([symbol, Number(granularity)]));
                        } else {
                            resolve([]);
                        }
                        return;
                    }
                    // Don't clear auth data for InvalidSymbol errors as it causes unwanted logouts
                    // InvalidSymbol errors can occur for various reasons and don't necessarily mean the user is unauthorized
                    reject(error);
                });
        });
    }

    /**
     * The symbol's tick stream is already open on this socket (the Market Tool, the
     * AI Scanner or a chart opened it first), and Deriv refuses a second one. The bot
     * takes the history from a plain ticks_history and then reads that stream's ticks
     * like its own (observe() accepts every tick of a symbol it has ticks for).
     */
    shareTickStream(symbol, underlying = symbol) {
        const request = { ticks_history: underlying, end: 'latest', count: 1000, style: 'ticks' };
        return doUntilDone(() => api_base.api.send(request), [], api_base).then(r => {
            const ticks = historyToTicks(r.history);
            this.shared_symbols.add(symbol);
            ct_perf.log(`bot shares the ${underlying} tick stream (already streamed by another part of the app)`);
            this.updateTicksAndCallListeners(symbol, ticks);
            return ticks;
        });
    }

    /** A forgotten stream id: if it was the one the bot shares and the bot still needs it, subscribe in its own right. */
    onSharedStreamForgotten(forgotten_id) {
        this.shared_symbols.forEach(symbol => {
            if (this.subscriptions.getIn(['tick', symbol]) !== forgotten_id) return;
            if (!this.tickListeners.get(symbol)?.size) return;
            this.shared_symbols.delete(symbol);
            ct_perf.log(`the shared ${symbol} tick stream ended - the bot subscribes in its own right`);
            this.requestTicks({ symbol, style: 'ticks' }).catch(error => globalObserver.emit('Error', error));
        });
    }

    forget = () => {
        return new Promise((resolve, reject) => {
            if (api_base?.api && !isSocketGone()) {
                try {
                    api_base.api
                        .forgetAll('ticks')
                        .then(() => {
                            resolve();
                        })
                        .catch(reject);
                } catch (e) {
                    console.log('Error in forget ticks', e);
                }
            } else {
                resolve();
            }
        });
    };

    forgetCandleSubscription = () => {
        return new Promise((resolve, reject) => {
            if (api_base?.api && !isSocketGone()) {
                try {
                    api_base.api
                        .forgetAll('candles')
                        .then(() => {
                            resolve();
                        })
                        .catch(reject);
                } catch (e) {
                    console.log('Error in forget candles', e);
                }
            } else {
                resolve();
            }
        });
    };

    unsubscribeFromTicksService() {
        return new Promise((resolve, reject) => {
            this.forget()
                .then(() => {
                    try {
                        this.forgetCandleSubscription()
                            .then(() => {
                                resolve();
                            })
                            .catch(reject);
                    } catch (e) {
                        console.log('Error in unsubscribeFromTicksService', e);
                    }
                })
                .catch(reject);
            this.ticks_history_promise = null;
        });
    }
}
