import {
    EXECUTION_MODE_STORAGE_KEY,
    isExecutionModeLocked,
    readStoredExecutionMode,
    storeExecutionMode,
} from '../execution-mode';

describe('execution mode setting (per browser)', () => {
    beforeEach(() => localStorage.clear());

    it('defaults to Normal', () => {
        expect(readStoredExecutionMode()).toBe('normal');
    });

    it('is saved under ct_execution_mode and read back', () => {
        storeExecutionMode('fast');
        expect(localStorage.getItem('ct_execution_mode')).toBe('fast');
        expect(readStoredExecutionMode()).toBe('fast');
        storeExecutionMode('normal');
        expect(readStoredExecutionMode()).toBe('normal');
    });

    it('anything else stored reads as Normal', () => {
        localStorage.setItem(EXECUTION_MODE_STORAGE_KEY, 'turbo');
        expect(readStoredExecutionMode()).toBe('normal');
    });
});

describe('execution mode lock', () => {
    it('is unlocked when nothing runs', () => {
        expect(isExecutionModeLocked(false, 'idle')).toBe(false);
        expect(isExecutionModeLocked(false, 'scanning')).toBe(false);
        expect(isExecutionModeLocked(false, 'stopped')).toBe(false);
        expect(isExecutionModeLocked(false)).toBe(false);
    });

    it('is locked while a bot runs', () => {
        expect(isExecutionModeLocked(true, 'idle')).toBe(true);
    });

    it('is locked while the AI Scanner is starting or running', () => {
        expect(isExecutionModeLocked(false, 'starting')).toBe(true);
        expect(isExecutionModeLocked(false, 'running')).toBe(true);
    });
});
