import {
    clampToBounds,
    defaultPosition,
    getSafeBounds,
    readStoredPosition,
    runBarTopBeside,
    storePosition,
} from '../ai-scanner-layout';

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
        const by_default = clampToBounds(defaultPosition(BUTTON, bounds), BUTTON, bounds);
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

describe('AI button default spot on a desktop / laptop', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
    });

    // 1366x768 Bot Builder, as measured on the dev server.
    const desktop = () => {
        setViewport(1366, 768);
        place('deriv-header', { top: 0, bottom: 56, left: 0, right: 1366 });
        const bar = place('run-strategy-bar', { top: 122, bottom: 186, left: 0, right: 1366 });
        const controls = document.createElement('div');
        controls.getBoundingClientRect = () =>
            ({ top: 134, bottom: 174, left: 967, right: 1358, width: 391, height: 40, x: 967, y: 134 }) as DOMRect;
        bar.appendChild(controls);
        place('run-panel__container', { top: 186, bottom: 732, left: 943, right: 1366 });
        place('dc-drawer__toggle', { top: 186, bottom: 732, left: 943, right: 959 });
        place('app-footer', { top: 732, bottom: 768, left: 0, right: 1366 });
    };

    it('bottom-right of the content area: clear of the run panel, its toggle, the Run bar and the footer', () => {
        desktop();
        const bounds = getSafeBounds();
        const spot = clampToBounds(defaultPosition(BUTTON, bounds), BUTTON, bounds);
        expect(spot).toEqual({ x: 871, y: 660 });
        expect(spot.x + BUTTON).toBeLessThan(943); // run panel column and its toggle
        expect(spot.y + BUTTON).toBeLessThan(732); // footer
        expect(spot.y).toBeGreaterThan(186); // Run bar
    });

    it('the empty left part of the Run bar band is usable, never the part with its controls', () => {
        desktop();
        expect(runBarTopBeside(443, 863)).toBe(122);
        expect(runBarTopBeside(600, 1000)).toBeNull();
    });

    it('desktop / laptop and phone spots are remembered apart, under the new key', () => {
        storePosition(true, { x: 10, y: 20 });
        storePosition(false, { x: 30, y: 40 });
        expect(readStoredPosition(true)).toEqual({ x: 10, y: 20 });
        expect(readStoredPosition(false)).toEqual({ x: 30, y: 40 });
        expect(localStorage.getItem('ai_scanner_button_position_wide_v2')).not.toBeNull();
        expect(localStorage.getItem('ai_scanner_button_position_desktop')).toBeNull();
    });

    it('a desktop spot saved before (old key) is cleared once, so the new default shows', () => {
        localStorage.setItem('ai_scanner_button_position_desktop', JSON.stringify({ x: 16, y: 660 }));
        localStorage.setItem('ai_scanner_button_position_mobile', JSON.stringify({ x: 5, y: 6 }));
        jest.isolateModules(() => {
            const layout = jest.requireActual('../ai-scanner-layout');
            expect(localStorage.getItem('ai_scanner_button_position_desktop')).toBeNull();
            expect(layout.readStoredPosition(true)).toBeNull();
            expect(layout.readStoredPosition(false)).toEqual({ x: 5, y: 6 }); // phones keep theirs
        });
    });
});
