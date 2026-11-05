import { getLocalizedErrorMessage } from '@/constants/backend-error-messages';
import { checkAiScannerBuy } from '@/utils/ai-scanner-trade-guard';
import { ct_perf } from '@/utils/ct-perf';
import { localize } from '@deriv-com/translations';
import { LogTypes } from '../../../constants/messages';
import { createError } from '../../../utils/error';
import { api_base } from '../../api/api-base';
import { contractStatus, info, log, notify } from '../utils/broadcast';
import { getBuyGapDelayMs, isFastExecution } from '../utils/execution-mode';
import { failOnMarketClosed, getUUID, recoverFromError, tradeOptionToBuy } from '../utils/helpers';
import { purchaseSuccessful } from './state/actions';
import { BEFORE_PURCHASE } from './state/constants';

const BUY_CHECK_TIMEOUT_MS = 10000;
const PROPOSALS_TIMEOUT_MS = 10000;
// Seconds a contract's purchase_time may be before the last tick seen at the send.
const PURCHASE_TIME_MARGIN_S = 2;

let delayIndex = 0;
let purchase_reference;

const rejectAfter = (ms, error) => {
    let timer;
    const promise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(error), ms);
    });
    return { promise, cancel: () => clearTimeout(timer) };
};

export default Engine =>
    class Purchase extends Engine {
        purchase(contract_type) {
            // Prevent calling purchase twice
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            // The last buy failed: never send another before knowing it didn't go through.
            if (this.pending_buy) {
                return this.settlePendingBuy(contract_type).then(was_placed =>
                    was_placed ? undefined : this.purchase(contract_type)
                );
            }

            const gap_ms = isFastExecution() ? getBuyGapDelayMs(this.last_buy_sent_at, Date.now()) : 0;
            if (gap_ms > 0) {
                ct_perf.designWait(gap_ms);
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
            ct_perf.buyCalled(isFastExecution() ? 'fast' : 'normal');

            const onSuccess = response => this.onBuyConfirmed(response.buy, contract_type);

            if (this.is_proposal_subscription_required) {
                const { id, askPrice } = this.selectProposal(contract_type);

                const action = () => {
                    ct_perf.buySent();
                    this.rememberBuy(contract_type, askPrice);
                    return failOnMarketClosed(api_base.api.send({ buy: id, price: askPrice }));
                };

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                // One send: a failed buy is tried again by the interpreter, after the check.
                if (!this.options.timeMachineEnabled) {
                    return action().then(onSuccess);
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
                ).then(onSuccess);
            }
            const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);
            // The AI Scanner never buys anything but its locked trade.
            const mismatch = checkAiScannerBuy(trade_option);
            if (mismatch) return Promise.reject(createError('AiTradeMismatch', mismatch));
            const action = () => {
                ct_perf.buySent();
                this.rememberBuy(contract_type, this.tradeOptions.amount);
                return failOnMarketClosed(api_base.api.send(trade_option));
            };

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            // One send: a failed buy is tried again by the interpreter, after the check.
            if (!this.options.timeMachineEnabled) {
                return action().then(onSuccess);
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
            ).then(onSuccess);
        }

        onBuyConfirmed(buy, contract_type) {
            // Don't unnecessarily send a forget request for a purchased contract.
            this.pending_buy = null;
            ct_perf.buyConfirmed();

            contractStatus({
                id: 'contract.purchase_received',
                data: buy.transaction_id,
                buy,
            });

            this.contractId = buy.contract_id;
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
        }

        /** What settlePendingBuy needs to recognise this buy. The tick's epoch is Deriv's clock, not the trader's. */
        rememberBuy(contract_type, amount) {
            this.pending_buy = {
                contract_type,
                amount: Number(amount),
                symbol: this.options.symbol,
                sent_at_epoch: this.store.getState().newTick || Math.floor(Date.now() / 1000),
                transactions: [],
            };
        }

        /**
         * Did the failed buy go through after all? Resolves true when it did -
         * the engine then follows that contract, whether it is open or already
         * over - and false when it didn't. Rejects when it can't tell, so that
         * no buy is sent on a guess.
         */
        async settlePendingBuy(contract_type) {
            const pending = this.pending_buy;
            const placed = await this.findPlacedContract(pending);
            if (placed) {
                this.isSold = false;
                this.onBuyConfirmed(placed, contract_type);
                notify('journal__text--warn', localize('The last buy went through after all. Waiting for its result.'));
                // The result may have passed before the engine was listening for this contract.
                api_base.api.send({ proposal_open_contract: 1, contract_id: placed.contract_id }).catch(() => {});
                return true;
            }
            this.pending_buy = null;
            if (this.is_proposal_subscription_required) await this.waitForFreshProposals();
            return false;
        }

        async findPlacedContract(pending) {
            const isThisBuy = ({ symbol, underlying_symbol, price }) => {
                const contract_symbol = underlying_symbol ?? symbol;
                // A field this API leaves out counts as a match: a wrong wait costs far less than a double buy.
                return (
                    (contract_symbol === undefined || contract_symbol === pending.symbol) &&
                    (price === undefined || Math.abs(Number(price)) === pending.amount)
                );
            };
            const fromTransactions = () => {
                const transaction = pending.transactions.find(item => isThisBuy({ ...item, price: item.amount }));
                return transaction && { ...transaction, buy_price: Math.abs(Number(transaction.amount)) };
            };

            const seen = fromTransactions();
            if (seen) return seen;

            const failure = createError(
                'BuyCheckFailed',
                localize('Could not check whether the last buy went through')
            );
            const timeout = rejectAfter(BUY_CHECK_TIMEOUT_MS, failure);
            let response;
            try {
                response = await Promise.race([api_base.api.send({ portfolio: 1 }), timeout.promise]);
            } catch {
                throw failure;
            } finally {
                timeout.cancel();
            }
            const contracts = response?.portfolio?.contracts;
            if (!Array.isArray(contracts)) throw failure;

            const open = contracts.find(
                contract =>
                    isThisBuy({ ...contract, price: contract.buy_price }) &&
                    (contract.contract_type === undefined || contract.contract_type === pending.contract_type) &&
                    (contract.purchase_time === undefined ||
                        contract.purchase_time >= pending.sent_at_epoch - PURCHASE_TIME_MARGIN_S)
            );
            // The stream may have delivered it while the portfolio was on its way.
            return open ?? fromTransactions();
        }

        /** A failed buy's proposal is spent or stale: the next one needs new ones. */
        waitForFreshProposals() {
            return new Promise((resolve, reject) => {
                let unsubscribe = () => {};
                const timer = setTimeout(() => {
                    unsubscribe();
                    reject(createError('GetProposalFailure', getLocalizedErrorMessage('ProposalsNotReady')));
                }, PROPOSALS_TIMEOUT_MS);
                this.renewProposalsOnPurchase();
                unsubscribe = this.store.subscribe(() => {
                    if (!this.store.getState().proposalsReady) return;
                    clearTimeout(timer);
                    unsubscribe();
                    resolve();
                });
            });
        }

        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };
