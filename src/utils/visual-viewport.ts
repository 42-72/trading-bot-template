/**
 * Maintains `--vv-bottom-gap` on <html>: the live gap, in px, between the LARGE
 * viewport (window.innerHeight - what CSS 100vh/100dvh both actually resolve to
 * on Android Chrome, since dvh was measured over-reporting by the gesture/nav
 * bar height) and the real visible viewport (window.visualViewport).
 *
 * CSS's own vh/dvh units can't express this - only the live VisualViewport API
 * has the true visible height, so this is computed in JS and pushed into a CSS
 * custom property that .controls__section (and anything else that needs it)
 * reads directly, rather than trying to approximate it with a unit.
 *
 * Feature-detects window.visualViewport; if it's absent, sets 0px once and does
 * nothing further. Never throws - a failure degrades to 0px, same as "no gap".
 */
export const initVisualViewportGap = (): void => {
    const root = document.documentElement;

    try {
        const vv = window.visualViewport;
        if (!vv) {
            root.style.setProperty('--vv-bottom-gap', '0px');
            return;
        }

        let rafId: number | null = null;

        const measure = () => {
            rafId = null;
            try {
                const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
                root.style.setProperty('--vv-bottom-gap', `${gap}px`);
            } catch {
                root.style.setProperty('--vv-bottom-gap', '0px');
            }
        };

        const scheduleMeasure = () => {
            if (rafId !== null) return;
            rafId = requestAnimationFrame(measure);
        };

        measure();
        vv.addEventListener('resize', scheduleMeasure);
        vv.addEventListener('scroll', scheduleMeasure);
        window.addEventListener('orientationchange', scheduleMeasure);
    } catch {
        try {
            root.style.setProperty('--vv-bottom-gap', '0px');
        } catch {
            // Nothing more we can safely do.
        }
    }
};
