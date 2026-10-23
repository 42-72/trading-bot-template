import { clampToBounds, defaultPosition, getSafeBounds } from '../ai-scanner-layout';

const BUTTON = 56;

// jsdom has no layout: give each element the rectangle measured on the preview.
const place = (className: string, rect: { top: number; bottom: number; left: number; right: number }) => {
    const element = document.createElement('div');
    element.className = className;
    element.getBoundingClientRect = () =>
        ({
            ...rect,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
            x: rect.left,
            y: rect.top,
        }) as DOMRect;
    document.body.appendChild(element);
    return element;
};

const setViewport = (width: number, height: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
};

describe('AI button vs the run drawer toggle bar', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it.each([
        // viewport, toggle bar (as measured on the ai-scanner preview), run bar below it
        [375, 812, 714, 750],
        [1024, 768, 670, 706],
    ])('%ix%i: the whole button sits 12px+ above the toggle bar', (width, height, toggle_top, toggle_bottom) => {
        setViewport(width, height);
        place('deriv-header', { top: 0, bottom: 56, left: 0, right: width });
        // The closed drawer's container measures 0 tall - only its toggle bar shows.
        place('run-panel__container run-panel__container--mobile-closed', {
            top: toggle_top,
            bottom: toggle_top,
            left: 0,
            right: width,
        });
        place('dc-drawer__toggle', { top: toggle_top, bottom: toggle_bottom, left: 0, right: width });
        place('controls__section', { top: toggle_bottom, bottom: height, left: 0, right: width });

        const bounds = getSafeBounds();

        // Default spot.
        const by_default = clampToBounds(defaultPosition(BUTTON, bounds, false), BUTTON, bounds);
        expect(by_default.y + BUTTON).toBeLessThanOrEqual(toggle_top - 12);

        // A dragged / saved spot on top of the bar moves to the nearest safe spot.
        const unsafe = { x: 100, y: toggle_top - 20 };
        const moved = clampToBounds(unsafe, BUTTON, bounds);
        expect(moved.y + BUTTON).toBe(toggle_top - 12);
        expect(moved.x).toBe(100);

        // A spot that was already safe is left alone.
        const safe = { x: 100, y: 300 };
        expect(clampToBounds(safe, BUTTON, bounds)).toEqual(safe);
    });

    it('with no toggle bar on screen, only the other run controls bound the button', () => {
        setViewport(375, 812);
        place('controls__section', { top: 750, bottom: 812, left: 0, right: 375 });
        expect(getSafeBounds().bottom).toBe(750);
    });
});
