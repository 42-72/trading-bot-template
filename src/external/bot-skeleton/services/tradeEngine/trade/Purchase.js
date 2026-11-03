import { checkAiScannerBuy } from '@/utils/ai-scanner-trade-guard';
import { describeTrade, logTradeError } from '@/utils/trade-log';
import { LogTypes } from '../../../constants/messages';
import { createError } from '../../../utils/error';
import { api_base } from '../../api/api-base';
import { contractStatus, info, log } from '../utils/broadcast';
import { getBuyGapDelayMs, isFastExecution } from '../utils/execution-mode';
import { doUntilDone, getUUID, recoverFromError, tradeOptionToBuy } from '../utils/helpers';
import { purchaseSuccessful } from './state/actions';
import { BEFORE_PURCHASE } from './state/constants';

let delayIndex = 0;
let purchase_reference;

export default Engine =>
    class Purchase extends Engine {
        purchase(contract_type) {
            // Prevent calling purchase twice
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            const gap_ms = isFastExecution() ? getBuyGapDelayMs(this.last_buy_sent_at, Date.now()) : 0;
            if (gap_ms > 0) {
                return new Promise(resolve => setTimeout(resolve, gap_ms)).then(() => {
                    // Stopped, or no longer before purchase, while waiting: don't buy.
                    if (!api_base.is_running || this.store.getState().scope !== BEFORE_PURCHASE) return undefined;
                    return this.sendPurchase(contract_type);
                });
            }
            return this.sendPurchase(contract_type);
        }

        sendPurchase(contract_type) {
            this.last_buy_sent_at = Date.now();

            const onSuccess = response => {
                // Don't unnecessarily send a forget request for a purchased contract.
                const { buy } = response;

                contractStatus({
                    id: 'contract.purchase_received',
                    data: buy.transaction_id,
                    buy,
                });

                this.contractId = buy.contract_id;
                api_base.noteBuy?.(describeTrade(this.last_buy_request));
                this.store.dispatch(purchaseSuccessful());

                if (this.is_proposal_subscription_required) {
                    this.renewProposalsOnPurchase();
                }

                delayIndex = 0;
                log(LogTypes.PURCHASE, { transaction_id: buy.transaction_id });
                info({
                    accountID: this.accountInfo.loginid,
                    totalRuns: this.updateAndReturnTotalRuns(),
                    transaction_ids: { buy: buy.transaction_id },
                    contract_type,
                    buy_price: buy.buy_price,
                });
            };

            if (this.is_proposal_subscription_required) {
                const { id, askPrice } = this.selectProposal(contract_type);
                const template = this.proposal_templates?.find(proposal => proposal.contract_type === contract_type);
                this.last_buy_request = template ?? { contract_type };
                const logFailure = error => {
                    logTradeError('buy', error, this.last_buy_request);
                    throw error;
                };

                const action = () => api_base.api.send({ buy: id, price: askPrice });

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                if (!this.options.timeMachineEnabled) {
                    return doUntilDone(action).then(onSuccess, logFailure);
                }

                return recoverFromError(
                    action,
                    (errorCode, makeDelay) => {
                        // if disconnected no need to resubscription (handled by live-api)
                        if (errorCode !== 'DisconnectError') {
                            this.renewProposalsOnPurchase();
                        } else {
                            this.clearProposals();
                        }

                        const unsubscribe = this.store.subscribe(() => {
                            const { scope, proposalsReady } = this.store.getState();
                            if (scope === BEFORE_PURCHASE && proposalsReady) {
                                makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                                unsubscribe();
                            }
                        });
                    },
                    ['PriceMoved', 'InvalidContractProposal'],
                    delayIndex++
                ).then(onSuccess, logFailure);
            }
            const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);
            this.last_buy_request = trade_option;
            // ct_session_v2: the AI Scanner never buys anything but its locked trade.
            const mismatch = checkAiScannerBuy(trade_option);
            if (mismatch) return Promise.reject(createError('AiTradeMismatch', mismatch));
            const logFailure = error => {
                logTradeError('buy', error, trade_option);
                throw error;
            };
            const action = () => api_base.api.send(trade_option);

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            if (!this.options.timeMachineEnabled) {
                return doUntilDone(action).then(onSuccess, logFailure);
            }

            return recoverFromError(
                action,
                (errorCode, makeDelay) => {
                    if (errorCode === 'DisconnectError') {
                        this.clearProposals();
                    }
                    const unsubscribe = this.store.subscribe(() => {
                        const { scope } = this.store.getState();
                        if (scope === BEFORE_PURCHASE) {
                            makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                            unsubscribe();
                        }
                    });
                },
                ['PriceMoved', 'InvalidContractProposal'],
                delayIndex++
            ).then(onSuccess, logFailure);
        }
        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };
