// The only errors a running bot tries again after (utils/error-recovery.js).
// Each says "not now", never "not this trade", and leaves no contract behind.
// Anything else - any code not listed - stops the bot: retrying an error nobody
// has looked at could keep spending money on a trade that can't work.
export const recoverable_errors = [
    // Deriv's own short failures.
    'InternalServerError',
    'TradeTemporarilyUnavailable',
    'RateLimit',
    'RateLimitExceeded',
    // A price or proposal that went stale between asking and buying.
    'PriceMoved',
    'InvalidContractProposal',
    'GetProposalFailure',
    // Deriv's clock or price feed lagging for a moment.
    'TransactionTimeTooOld',
    'TransactionTimeTooYoung',
    'MissingMarketData',
    'MissingTickMarketData',
    'MissingSpotMarketData',
    'MissingVolatilityMarketData',
    'OldMarketData',
    'OutdatedVolatilityData',
    // A reply lost or garbled on the way. While the connection is really down
    // the session code stops the bot, as it always has.
    'CallError',
    'WrongResponse',
    'DisconnectError',
    // Ours: could not find out whether the last buy went through (Purchase.js).
    'BuyCheckFailed',
];

export const unrecoverable_errors = [
    'InsufficientBalance',
    'CustomLimitsReached',
    'OfferingsValidationError',
    'InvalidCurrency',
    'ContractBuyValidationError',
    'NotDefaultCurrency',
    'PleaseAuthenticate',
    'FinancialAssessmentRequired',
    'PositiveIntegerExpected',
    'OptionError',
    'IncorrectPayoutDecimals',
    'IncorrectStakeDecimals',
    'NoMFProfessionalClient',
    'AuthorizationRequired',
    'InvalidToken',
    'DailyLossLimitExceeded',
    'InputValidationFailed',
    'ClientUnwelcome',
    'PriceMoved',
];

export enum MessageTypes {
    ERROR = 'error',
    NOTIFY = 'notify',
    SUCCESS = 'success',
}

export enum ErrorTypes {
    RECOVERABLE_ERRORS = 'recoverable_errors',
    UNRECOVERABLE_ERRORS = 'unrecoverable_errors',
}

export enum LogTypes {
    LOAD_BLOCK = 'load_block',
    PURCHASE = 'purchase',
    SELL = 'sell',
    NOT_OFFERED = 'not_offered',
    PROFIT = 'profit',
    LOST = 'lost',
    WELCOME_BACK = 'welcome_back',
    WELCOME = 'welcome',
}
