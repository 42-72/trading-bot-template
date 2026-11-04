import { AFTER_DRAW_MS, BOOT_SPLASH_MAX_MS, hideBootSplash, isBootSplashHidden, startBootSplash } from '../boot-splash';

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

    it('lets the chart finish on a fast load, then goes', () => {
        const cover = document.createElement('div');
        cover.className = 'cover';
        document.getElementById('mw-boot-splash')?.appendChild(cover);
        const draw = { currentTime: 500, effect: { getComputedTiming: () => ({ endTime: 1800 }) } };
        cover.getAnimations = () => [draw] as unknown as Animation[];
        startBootSplash();

        hideBootSplash('landing page');
        jest.advanceTimersByTime(1300 + AFTER_DRAW_MS - 1);
        expect(document.getElementById('mw-boot-splash')).not.toBeNull();
        expect(document.documentElement.classList.contains('mw-boot')).toBe(true);

        jest.advanceTimersByTime(1);
        expect(document.getElementById('mw-boot-splash')).toBeNull();
        expect(document.documentElement.classList.contains('mw-boot')).toBe(false);
    });

    it('does not wait once the chart has finished', () => {
        const cover = document.createElement('div');
        cover.className = 'cover';
        document.getElementById('mw-boot-splash')?.appendChild(cover);
        const draw = { currentTime: 4000, effect: { getComputedTiming: () => ({ endTime: 1800 }) } };
        cover.getAnimations = () => [draw] as unknown as Animation[];
        startBootSplash();

        hideBootSplash('app ready');
        expect(document.getElementById('mw-boot-splash')).toBeNull();
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
