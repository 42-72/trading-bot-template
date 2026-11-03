import { BOOT_SPLASH_MAX_MS, hideBootSplash, isBootSplashHidden, startBootSplash } from '../boot-splash';

const addSplash = () => {
    document.documentElement.classList.add('mw-boot');
    const splash = document.createElement('div');
    splash.id = 'mw-boot-splash';
    document.body.appendChild(splash);
};

describe('boot splash (one start-up loader)', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        document.body.innerHTML = '';
        addSplash();
    });

    afterEach(() => jest.useRealTimers());

    it('stays up until the app is ready, then goes for good', () => {
        startBootSplash();
        expect(isBootSplashHidden()).toBe(false);
        expect(document.getElementById('mw-boot-splash')).not.toBeNull();

        hideBootSplash('app ready');
        expect(document.getElementById('mw-boot-splash')).toBeNull();
        expect(document.documentElement.classList.contains('mw-boot')).toBe(false);
        hideBootSplash('again'); // idempotent
        expect(isBootSplashHidden()).toBe(true);
    });

    it('never stays longer than the safety cap', () => {
        startBootSplash();
        jest.advanceTimersByTime(BOOT_SPLASH_MAX_MS - 1);
        expect(document.getElementById('mw-boot-splash')).not.toBeNull();
        jest.advanceTimersByTime(1);
        expect(document.getElementById('mw-boot-splash')).toBeNull();
        expect(document.documentElement.classList.contains('mw-boot')).toBe(false);
    });
});
