/**
 * Transport layer wrapper for SmartCharts Champion Adapter
 * Wraps the existing chart_api.api to match the TTransport interface
 */

import chart_api from '@/external/bot-skeleton/services/api/chart-api';
import type { TTransport } from './types';

// Logger utility for transport layer
const logger = {
    log: () => {}, // Disabled in production
    warn: console.warn.bind(console, '[SmartCharts Transport]'),
    error: console.error.bind(console, '[SmartCharts Transport]'),
};

/**
 * Create transport wrapper around chart_api.api
 * @returns TTransport implementation
 */
export function createTransport(): TTransport {
    const subscriptions = new Map<string, any>();

    return {
        /**
         * Send one-shot API request
         */
        async send(request: any): Promise<any> {
            if (!chart_api.api) {
                await chart_api.init();
            }
            return chart_api.api.send(request);
        },

        /**
         * Subscribe to streaming data
         * @param request - API request with subscribe: 1
         * @param callback - Callback for streaming updates
         * @returns subscription ID
         */
        subscribe(request: any, callback: (response: any) => void): string {
            if (!chart_api.api) {
                throw new Error('Chart API not initialized');
            }
            // Generate a unique temporary ID for tracking
            const tempId = `temp-${Date.now()}-${Math.random()}`;

            // Send initial subscription request
            const subscribeRequest = { ...request, subscribe: 1 };

            // Set up global message listener first (before sending request). The socket is
            // shared with a running bot, the Market Tool and the AI Scanner: only messages of
            // THIS subscription (its id comes from the reply to its own request, below) are
            // forwarded - never adopt another stream's id, or leaving the chart would forget it.
            const messageSubscription = chart_api.api.onMessage()?.subscribe(({ data }: { data: any }) => {
                const subscriptionId = data?.subscription?.id;
                const storedSub = subscriptions.get(tempId);
                if (storedSub?.realSubscriptionId && subscriptionId === storedSub.realSubscriptionId) {
                    callback(data);
                }
            });

            // Store subscription info with temp ID
            subscriptions.set(tempId, {
                request: subscribeRequest,
                callback,
                messageSubscription,
                realSubscriptionId: null, // Will be set when we get the first response
            });

            // Send the subscription request
            chart_api.api
                .send(subscribeRequest)
                .then((response: any) => {
                    const subscriptionId = response?.subscription?.id;

                    if (subscriptionId) {
                        // Unsubscribed while the request was on its way: forget it now.
                        if (!subscriptions.has(tempId)) {
                            chart_api.api?.forget(subscriptionId);
                            return;
                        }
                        // Update stored subscription with real ID
                        const storedSub = subscriptions.get(tempId);
                        if (storedSub) {
                            storedSub.realSubscriptionId = subscriptionId;
                            subscriptions.set(tempId, storedSub);
                        }

                        // Call callback with initial response
                        callback(response);
                    } else {
                        logger.error('No subscription ID in response:', response);
                    }
                })
                .catch((error: any) => {
                    logger.error('Subscription failed:', error);
                    // Clean up failed subscription
                    const storedSub = subscriptions.get(tempId);
                    if (storedSub?.messageSubscription) {
                        storedSub.messageSubscription.unsubscribe();
                    }
                    subscriptions.delete(tempId);
                });

            return tempId;
        },

        /**
         * Unsubscribe from streaming data
         * @param subscriptionId - Subscription ID to cancel (temp ID)
         */
        unsubscribe(subscriptionId: string): void {
            const subscription = subscriptions.get(subscriptionId);

            if (subscription) {
                // Cancel RxJS subscription
                if (subscription.messageSubscription) {
                    subscription.messageSubscription.unsubscribe();
                }

                // Send forget request to server using the real subscription ID
                if (chart_api.api && subscription.realSubscriptionId) {
                    chart_api.api.forget(subscription.realSubscriptionId);
                }

                // Clean up local storage
                subscriptions.delete(subscriptionId);
            } else {
                logger.warn('No subscription found for ID:', subscriptionId);
            }
        },

        /**
         * Unsubscribe from all of THIS chart's streaming data. Never forget_all: the socket
         * is shared, and forget_all would also end a running bot's tick stream and the
         * Market Tool's / AI Scanner's.
         * (A message type passed by older callers is ignored: only this chart's own go.)
         */
        unsubscribeAll(): void {
            subscriptions.forEach((subscription, tempId) => {
                subscription.messageSubscription?.unsubscribe?.();
                if (chart_api.api && subscription.realSubscriptionId) {
                    chart_api.api.forget(subscription.realSubscriptionId);
                }
                subscriptions.delete(tempId);
            });
        },
    };
}
