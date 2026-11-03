import { startLog } from '@/utils/start-log';
import { getTradingTimes, TRADING_TIMES } from '../../../../components/shared/utils/common-data';
import PendingPromise from '../../utils/pending-promise';
import { api_base } from './api-base';

/** How long the bot area's start-up waits for an answer before asking again. */
export const TRADING_TIMES_TIMEOUT_MS = 8000;
const NO_ANSWER = Symbol('no answer');

export default class TradingTimes {
    constructor({ ws, server_time }) {
        this.init_promise = new PendingPromise();
        this.is_initialised = false;
        this.trading_times = {};
        this.ws = ws;
        this.server_time = server_time.clone();
    }

    async initialise() {
        if (this.is_initialised) {
            return this.init_promise;
        }

        this.is_initialised = true;
        this.last_update_moment = this.server_time.local();

        if (!Object.keys(this.trading_times).length) {
            await this.updateTradingTimes();
            this.init_promise.resolve();

            const periodicUpdate = async () => {
                const changes = this.updateMarketOpenClosed();

                if (Object.keys(changes).length > 0 && this.onMarketOpenCloseChanged) {
                    this.onMarketOpenCloseChanged(changes);
                }

                let next_update_date = this.nextUpdateDate();

                if (!next_update_date) {
                    const now_moment = this.server_time.local();
                    const next_update_moment = this.last_update_moment.clone().add(1, 'days');

                    if (now_moment.isAfter(next_update_moment)) {
                        this.last_update_moment = now_moment.clone();
                    } else {
                        this.last_update_moment = next_update_moment.clone();
                    }

                    // Retain the current market open close status, because the trade times
                    // will now be the following day:
                    const is_open_map = {};

                    Object.keys(this.trading_times).forEach(symbol_name => {
                        is_open_map[symbol_name] = this.trading_times[symbol_name].is_opened;
                    });

                    await this.updateTradingTimes();

                    Object.keys(this.trading_times).forEach(symbol_name => {
                        this.trading_times[symbol_name].is_opened = is_open_map[symbol_name];
                    });

                    // next update date will be 00:00 hours (UTC) of the following day:
                    next_update_moment.set({ hour: 0, minute: 0, second: 0 });
                    next_update_date = next_update_moment.toDate();
                }

                const wait_period = next_update_date - this.server_time.local().toDate();
                this.update_timer = setTimeout(periodicUpdate, wait_period);
            };

            // Not awaited: start-up only needs the synchronous part (today's
            // open/closed marks, set before periodicUpdate's first await).
            // When today has no session left (after 22:00 UTC with the
            // built-in hours) it goes on to fetch tomorrow's hours - awaiting
            // that put a second request, and on a socket that never answers a
            // second 8 s wait, in front of every start-up.
            periodicUpdate();
        }

        return this.init_promise;
    }

    async updateTradingTimes() {
        const last_update_date = this.last_update_moment.format('YYYY-MM-DD');

        try {
            // Check if API is available
            if (!api_base.api && !this.ws) {
                this.setTradingTimes();
                return;
            }

            const response = await this.requestTradingTimes(last_update_date);
            if (response === NO_ANSWER) {
                startLog('trading_times: no answer - using the built-in market hours');
                this.setTradingTimes();
                return;
            }

            if (response?.error) {
                this.setTradingTimes();
                return;
            }

            this.trading_times = {};

            const now = this.server_time.local().toDate();
            const date_str = now.toISOString().substring(0, 11);
            const getUTCDate = hour => new Date(`${date_str}${hour}Z`);

            if (!response?.trading_times?.markets) {
                this.setTradingTimes();
                return;
            }

            const {
                trading_times: { markets },
            } = response;

            // Process markets within the try block
            markets?.forEach(market => {
                const { submarkets } = market;

                submarkets?.forEach(submarket => {
                    const { symbols } = submarket;

                    symbols?.forEach(symbol_obj => {
                        const { times, underlying_symbol } = symbol_obj;

                        // Validate symbol before processing
                        if (
                            !underlying_symbol ||
                            typeof underlying_symbol !== 'string' ||
                            underlying_symbol.trim() === ''
                        ) {
                            console.warn(`[TradingTimes] Invalid symbol in API response:`, symbol_obj);
                            return;
                        }

                        // Validate times data
                        if (!times || !times.open || !times.close) {
                            console.warn(`[TradingTimes] Invalid times data for symbol ${underlying_symbol}:`, times);
                            return;
                        }
                        const { open, close } = times;
                        const is_open_all_day = open.length === 1 && open[0] === '00:00:00' && close[0] === '23:59:59';
                        const is_closed_all_day = open.length === 1 && open[0] === '--' && close[0] === '--';

                        let processed_times;

                        if (!is_open_all_day && !is_closed_all_day) {
                            processed_times = open.map((open_time, index) => ({
                                open: getUTCDate(open_time),
                                close: getUTCDate(close[index]),
                            }));
                        }
                        this.trading_times[underlying_symbol] = {
                            is_open_all_day,
                            is_closed_all_day,
                            times: processed_times,
                        };
                    });
                });
            });

            // Inject additional 1s volatility indices that may not be in the API response
            this.injectAdditionalTradingTimes();

            // If no trading times were processed, use fallback
            if (Object.keys(this.trading_times).length === 0) {
                this.setTradingTimes();
            }
        } catch (error) {
            this.setTradingTimes();
            return;
        }
    }

    /**
     * Asks the current socket. A request on a socket that closes before it
     * answers is never answered (deriv-api) - e.g. the public socket a login
     * return replaces with the logged-in one - so the wait is bounded, and the
     * new socket is asked once if the socket changed meanwhile.
     */
    async requestTradingTimes(date) {
        for (let attempt = 1; attempt <= 2; attempt++) {
            const socket = api_base.api || this.ws;
            if (!socket) return NO_ANSWER;
            let timer;
            const timeout = new Promise(resolve => {
                timer = setTimeout(() => resolve(NO_ANSWER), TRADING_TIMES_TIMEOUT_MS);
            });
            // eslint-disable-next-line no-await-in-loop
            const response = await Promise.race([socket.send({ trading_times: date }), timeout]);
            clearTimeout(timer);
            if (response !== NO_ANSWER) return response;
            const current = api_base.api || this.ws;
            if (attempt === 1 && current && current !== socket) {
                startLog('trading_times: no answer on a socket that was replaced - asking the new one');
                continue; // eslint-disable-line no-continue
            }
            return NO_ANSWER;
        }
        return NO_ANSWER;
    }

    /** The safety net's retry (app-content): start over instead of waiting on a request that never ends. */
    reset() {
        clearTimeout(this.update_timer);
        this.is_initialised = false;
        this.init_promise = new PendingPromise();
    }

    injectAdditionalTradingTimes() {
        // Additional 1s volatility indices to inject if not present in trading times response
        const additionalSymbols = ['1HZ15V', '1HZ30V', '1HZ90V'];

        additionalSymbols.forEach(symbol => {
            if (!this.trading_times[symbol]) {
                // Add trading times for 1s volatility indices (they are open 24/7)
                this.trading_times[symbol] = {
                    is_open_all_day: true,
                    is_closed_all_day: false,
                    times: undefined,
                    is_opened: true, // Always open for volatility indices
                };
            }
        });
    }

    setTradingTimes() {
        this.trading_times = {};

        TRADING_TIMES.SYMBOLS.forEach(symbol => {
            // Validate symbol before processing
            if (symbol && typeof symbol === 'string' && symbol.trim() !== '') {
                try {
                    const tradingTimeData = getTradingTimes(symbol);
                    // Only add if we get valid data
                    if (tradingTimeData && typeof tradingTimeData === 'object') {
                        this.trading_times[symbol] = tradingTimeData;
                    }
                } catch (error) {
                    console.warn(`[TradingTimes] Failed to get trading times for symbol: ${symbol}`, error);
                }
            } else {
                console.warn(`[TradingTimes] Invalid symbol encountered: ${symbol}`);
            }
        });
    }

    updateMarketOpenClosed() {
        const changes = {};

        Object.keys(this.trading_times).forEach(symbol_name => {
            const is_opened = this.calcIsMarketOpened(symbol_name);
            const symbol_obj = this.trading_times[symbol_name];

            if (symbol_obj.is_opened !== is_opened) {
                symbol_obj.is_opened = is_opened;
                changes[symbol_name] = is_opened;
            }
        });

        return changes;
    }

    calcIsMarketOpened(symbol_name) {
        const now = this.server_time.local().unix();
        const { times, is_open_all_day, is_closed_all_day } = this.trading_times[symbol_name];

        if (is_closed_all_day) {
            return false;
        }

        if (is_open_all_day) {
            return true;
        }

        return times.some(session => {
            const { open, close } = session;
            return now >= open && now < close;
        });
    }

    nextUpdateDate() {
        const now = this.server_time.local().toDate();

        let nextDate;

        Object.keys(this.trading_times).forEach(symbol_name => {
            const { times, is_open_all_day, is_closed_all_day } = this.trading_times[symbol_name];

            if (is_open_all_day || is_closed_all_day) {
                return;
            }

            times.forEach(session => {
                const { open, close } = session;

                if (open > now && (!nextDate || open < nextDate)) {
                    nextDate = open;
                }
                if (close > now && (!nextDate || close < nextDate)) {
                    nextDate = close;
                }
            });
        });

        return nextDate;
    }

    isMarketOpened(symbol_name) {
        const symbol_names = Object.keys(this.trading_times);

        if (!symbol_names.length || !symbol_names.includes(symbol_name)) {
            return false;
        }

        const isOpened = this.trading_times[symbol_name].is_opened;
        return isOpened;
    }

    // Method to get display name for symbols (used by active symbols)
    getSymbolDisplayName(symbol) {
        return TRADING_TIMES.SYMBOL_DISPLAY_NAMES[symbol] || symbol;
    }
}
