import { EXECUTION_MODES, setExecutionMode } from '../../utils/execution-mode';
import TradeEngine from '..';

jest.mock('../../../api/api-base', () => ({ api_base: { api: null, pushSubscription: jest.fn() } }));

const mockWatchBefore = jest.fn(() => Promise.resolve(true));
const mockWatchDuring = jest.fn(() => Promise.resolve(false));
jest.mock('../watch-scope', () => ({
    watchBefore: (...args) => mockWatchBefore(...args),
    watchDuring: (...args) => mockWatchDuring(...args),
}));

/** Just the engine's watch() on a bare object - no API, no ticks. */
const engine = has_fast_pass => ({ store: {}, has_fast_pass });
const watch = (target, name) => TradeEngine.prototype.watch.call(target, name);

describe('TradeEngine.watch fast pass', () => {
    beforeEach(() => {
        mockWatchBefore.mockClear();
        mockWatchDuring.mockClear();
    });
    afterAll(() => setExecutionMode(EXECUTION_MODES.NORMAL));

    it('Fast: the pass is used once - the next "before" waits for ticks', () => {
        setExecutionMode(EXECUTION_MODES.FAST);
        const target = engine(true);
        watch(target, 'before');
        watch(target, 'before');
        expect(mockWatchBefore.mock.calls.map(call => call[1])).toEqual([true, false]);
        expect(target.has_fast_pass).toBe(false);
    });

    it('Fast: no pass granted (first buy of a run) -> "before" waits for a tick', () => {
        setExecutionMode(EXECUTION_MODES.FAST);
        watch(engine(false), 'before');
        expect(mockWatchBefore).toHaveBeenCalledWith({}, false);
    });

    it('Fast: "during" ends on the result without a tick', () => {
        setExecutionMode(EXECUTION_MODES.FAST);
        watch(engine(false), 'during');
        expect(mockWatchDuring).toHaveBeenCalledWith({}, true);
    });

    it('Normal: never uses a pass, and "during" waits for a tick', () => {
        setExecutionMode(EXECUTION_MODES.NORMAL);
        watch(engine(true), 'before');
        watch(engine(true), 'during');
        expect(mockWatchBefore).toHaveBeenCalledWith({}, false);
        expect(mockWatchDuring).toHaveBeenCalledWith({}, false);
    });

    it('an unknown mode falls back to Normal', () => {
        setExecutionMode('turbo');
        watch(engine(true), 'before');
        expect(mockWatchBefore).toHaveBeenCalledWith({}, false);
    });
});
