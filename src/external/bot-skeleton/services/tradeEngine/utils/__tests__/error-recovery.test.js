import { recoverable_errors, unrecoverable_errors } from '../../../../constants/messages';
import {
    createRetryBudget,
    getBotStoppedMessage,
    isRecoverableError,
    MAX_RETRIES,
    RETRY_WINDOW_MS,
} from '../error-recovery';

jest.mock('@deriv-com/translations', () => ({
    localize: (text, values = {}) => text.replace(/{{(\w+)}}/g, (match, key) => values[key] ?? match),
}));

describe('which errors a bot tries again after', () => {
    it.each(['InternalServerError', 'RateLimit', 'PriceMoved', 'InvalidContractProposal', 'BuyCheckFailed'])(
        '%s is recoverable',
        code => expect(isRecoverableError(code)).toBe(true)
    );

    it.each([
        'InsufficientBalance',
        'MarketIsClosed',
        'OfferingsValidationError',
        'TradingDurationNotAllowed',
        'InvalidSymbol',
        'InvalidToken',
        'AuthorizationRequired',
        'ClientUnwelcome',
        'TradingDisabled',
        'PermissionDenied',
        'CustomLimitsReached',
        'DailyLossLimitExceeded',
        'OpenPositionLimitExceeded',
        'AiTradeMismatch',
        'NeverSeenBefore',
        undefined,
    ])('%s is not', code => expect(isRecoverableError(code)).toBe(false));

    it('nothing is on both lists, except PriceMoved, which only the old stop list still names', () => {
        expect(recoverable_errors.filter(code => unrecoverable_errors.includes(code))).toEqual(['PriceMoved']);
    });
});

describe('createRetryBudget', () => {
    afterEach(() => jest.restoreAllMocks());

    it('allows 1 s, 2 s, 4 s and then no more', () => {
        const budget = createRetryBudget();
        expect([1, 2, 3, 4].map(() => budget.next('InternalServerError'))).toEqual([1000, 2000, 4000, null]);
        expect(MAX_RETRIES).toBe(3);
    });

    it('waits longer on a rate limit, with every wait inside the 60 s', () => {
        const budget = createRetryBudget();
        const waits = [1, 2, 3].map(() => budget.next('RateLimit'));
        expect(waits.reduce((sum, ms) => sum + ms, 0)).toBeLessThan(RETRY_WINDOW_MS);
        expect(budget.next('RateLimit')).toBeNull();
    });

    it('gives up when 60 s have passed, whatever the tries left', () => {
        const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
        const budget = createRetryBudget();
        expect(budget.next('InternalServerError')).toBe(1000);
        now.mockReturnValue(1000 + RETRY_WINDOW_MS);
        expect(budget.next('InternalServerError')).toBeNull();
    });

    it('starts over after a reset', () => {
        const budget = createRetryBudget();
        [1, 2, 3].forEach(() => budget.next('InternalServerError'));
        budget.reset();
        expect(budget.next('InternalServerError')).toBe(1000);
    });
});

describe('getBotStoppedMessage', () => {
    it('gives the reason, without doubling its full stop', () => {
        expect(getBotStoppedMessage({ code: 'NeverSeenBefore', message: 'Something broke.' })).toBe(
            'Bot stopped: Something broke. Press Run to start again.'
        );
    });

    it('never shows an unfilled template', () => {
        expect(getBotStoppedMessage({ code: 'MarketIsClosed', message: 'This market is presently closed.' })).toBe(
            'Bot stopped: This market is presently closed. Press Run to start again.'
        );
    });

    it('still says something when there is no reason', () => {
        expect(getBotStoppedMessage({})).toMatch(/^Bot stopped: .+\. Press Run to start again\.$/);
    });
});
