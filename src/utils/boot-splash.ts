import { ct_perf } from './ct-perf';

/**
 * One start-up loader: the branded splash in index.html stays up until the
 * app can actually be used, instead of handing over to three different
 * full-screen loaders in a row ("Please wait while we connect...",
 * "Loading...", "Initializing...") that looked like reloads. Those loaders
 * still render underneath (html.mw-boot hides #root), so nothing about how
 * the app loads changes - only what the trader sees.
 *
 * Hidden by whichever comes first: the app is ready (app-content), the
 * landing page shows (logged-out visitors), a start-up failure or error
 * screen shows, or the safety cap - after which the normal loaders show.
 * A load faster than the splash's chart waits for the drawing to finish.
 */
export const BOOT_SPLASH_MAX_MS = 12000;

// A moment on the finished chart, with the dot pulsing, before moving on.
export const AFTER_DRAW_MS = 700;

let is_hidden = false;
let cap_timer: ReturnType<typeof setTimeout> | null = null;
let stopPerfLoader: (() => void) | null = null;

/** Called once at start-up (main.tsx). */
export const startBootSplash = () => {
    is_hidden = false;
    if (typeof document === 'undefined' || !document.getElementById('mw-boot-splash')) {
        is_hidden = true;
        return;
    }
    stopPerfLoader = ct_perf.loaderShown('boot splash');
    cap_timer = setTimeout(() => hideBootSplash('safety cap'), BOOT_SPLASH_MAX_MS);
};

// Read from the animation itself, so it counts from when the splash really
// appeared. No animation (reduce motion) means nothing to wait for.
const getDrawTimeLeft = () => {
    const draw = document.querySelector('#mw-boot-splash .cover')?.getAnimations?.()[0];
    if (!draw) return 0;
    const end_time = Number(draw.effect?.getComputedTiming().endTime ?? 0);
    return Math.max(0, end_time + AFTER_DRAW_MS - Number(draw.currentTime ?? 0));
};

export const hideBootSplash = (reason: string) => {
    if (is_hidden) return;
    is_hidden = true;
    if (cap_timer) clearTimeout(cap_timer);
    cap_timer = null;

    const removeSplash = () => {
        if (typeof document !== 'undefined') {
            document.documentElement.classList.remove('mw-boot');
            document.getElementById('mw-boot-splash')?.remove();
        }
        stopPerfLoader?.();
        stopPerfLoader = null;
        ct_perf.mark(`boot splash hidden (${reason})`);
    };

    const time_left = typeof document === 'undefined' ? 0 : getDrawTimeLeft();
    if (time_left) setTimeout(removeSplash, time_left);
    else removeSplash();
};

export const isBootSplashHidden = () => is_hidden;
