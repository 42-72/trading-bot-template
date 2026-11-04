import {
    clampToBounds,
    defaultPosition,
    getSafeBounds,
    openRunPanelBottom,
    readStoredPosition,
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
    const desktop = (is_panel_open = true) => {
        setViewport(1366, 768);
        place('deriv-header', { top: 0, bottom: 56, left: 0, right: 1366 });
        place('dc-tabs__list--main__tabs', { top: 72, bottom: 122, left: 16, right: 1350 });
        // Floats at the right end, over the panel's top row.
        place('run-strategy-bar', { top: 130, bottom: 170, left: 967, right: 1358 });
        if (is_panel_open) {
            place('run-panel__container', { top: 122, bottom: 732, left: 943, right: 1366 });
            place('dc-drawer__toggle dc-drawer__toggle--open', { top: 122, bottom: 732, left: 943, right: 959 });
        } else {
            place('run-panel__container', { top: 122, bottom: 732, left: 1350, right: 1773 });
            place('dc-drawer__toggle', { top: 122, bottom: 732, left: 1350, right: 1366 });
        }
        place('app-footer', { top: 732, bottom: 768, left: 0, right: 1366 });
    };

    it.each([
        ['open', true],
        ['closed', false],
    ])('bottom-right of the screen, above the footer, with the run panel %s', (_name, is_panel_open) => {
        desktop(is_panel_open);
        const bounds = getSafeBounds();
        expect(clampToBounds(defaultPosition(BUTTON, bounds), BUTTON, bounds)).toEqual({ x: 1294, y: 660 });
    });

    const placeInPanel = (className: string, rect: Parameters<typeof place>[1]) => {
        place(className, rect);
        const element = document.body.lastElementChild as HTMLElement;
        document.querySelector('.run-panel__container')?.appendChild(element);
    };

    it('panel open: the default spot ends above the stats, clear of Total profit/loss and Reset', () => {
        desktop(true);
        placeInPanel('run-panel__stat', { top: 554, bottom: 675, left: 959, right: 1366 });
        placeInPanel('dc-drawer__footer', { top: 675, bottom: 732, left: 959, right: 1366 });
        const bounds = getSafeBounds();
        const spot = defaultPosition(BUTTON, bounds, openRunPanelBottom() ?? bounds.bottom);
        expect(spot).toEqual({ x: 1294, y: 482 });
        expect(spot.y + BUTTON).toBeLessThan(554);
    });

    it('panel open on Journal (no stats): just above the Reset row', () => {
        desktop(true);
        placeInPanel('dc-drawer__footer', { top: 675, bottom: 732, left: 959, right: 1366 });
        expect(openRunPanelBottom()).toBe(675);
    });

    it('panel closed: nothing to clear, however the panel measures', () => {
        desktop(false);
        placeInPanel('dc-drawer__footer', { top: 675, bottom: 732, left: 1350, right: 1773 });
        expect(openRunPanelBottom()).toBeNull();
    });

    it('below 1280px: never lifted', () => {
        setViewport(1024, 768);
        place('dc-drawer__toggle dc-drawer__toggle--open', { top: 700, bottom: 736, left: 0, right: 1024 });
        place('run-panel__container', { top: 100, bottom: 700, left: 0, right: 1024 });
        placeInPanel('run-panel__stat', { top: 500, bottom: 620, left: 0, right: 1024 });
        expect(openRunPanelBottom()).toBeNull();
    });

    it("Tbots / DTrader, no Run bar: still can't be dragged onto the nav row", () => {
        setViewport(1366, 768);
        place('deriv-header', { top: 0, bottom: 56, left: 0, right: 1366 });
        place('dc-tabs__list--main__tabs', { top: 72, bottom: 122, left: 16, right: 1350 });
        const bounds = getSafeBounds();
        expect(bounds.top).toBe(122);
        expect(clampToBounds({ x: 600, y: 90 }, BUTTON, bounds).y).toBe(130);
    });

    it('opening the panel does not move a remembered spot at the right edge', () => {
        const spot = { x: 1280, y: 400 };
        desktop(false);
        expect(clampToBounds(spot, BUTTON, getSafeBounds())).toEqual(spot);
        document.body.innerHTML = '';
        desktop(true);
        expect(clampToBounds(spot, BUTTON, getSafeBounds())).toEqual(spot);
    });

    it('can never be dragged under the Run bar or onto the nav row, anywhere across the screen', () => {
        desktop();
        const bounds = getSafeBounds();
        expect(bounds.top).toBe(170);
        expect(clampToBounds({ x: 1200, y: 140 }, BUTTON, bounds).y).toBe(178);
        expect(clampToBounds({ x: 100, y: 80 }, BUTTON, bounds).y).toBe(178);
    });

    it('below 1280px the run panel column still bounds the button, as before', () => {
        setViewport(1279, 768);
        place('run-panel__container', { top: 122, bottom: 732, left: 900, right: 1279 });
        expect(getSafeBounds().right).toBe(900);
    });

    it('phones and tablets (< 1280px) keep their bounds: no Run bar there, and the nav row is no blocker', () => {
        setViewport(1024, 768);
        place('deriv-header', { top: 0, bottom: 56, left: 0, right: 1024 });
        place('dc-tabs__list--main__tabs', { top: 56, bottom: 112, left: 0, right: 1024 });
        expect(getSafeBounds().top).toBe(56);
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
