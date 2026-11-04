// Where the AI Scanner's floating button and panel may sit: the viewport less
// the header, the Run controls and the footer, measured live from the DOM
// rather than repeated as magic numbers - the Run controls only exist on
// some tabs, the run panel column slides open and closed, and the mobile run bar
// grows by the safe-area inset. Anything that needs to stay uncovered is in
// BLOCKERS; the button is kept fully inside what's left.

export type TBounds = { top: number; left: number; right: number; bottom: number };
export type TPoint = { x: number; y: number };

const EDGE_GAP = 8;

// Header, desktop nav tab row (from 1280px: phones and tablets keep their
// bounds; Tbots and DTrader have no Run bar below it), desktop Run bar
// (run-strategy.tsx), run panel column with its toggle (run-panel.tsx; below
// 1280px only, see getSafeBounds), desktop footer, mobile run bar
// (.controls__section), and the run drawer's toggle bar on its own: below
// 1280px the closed drawer's container measures 0 tall while its full-width ▲
// toggle bar still shows, so the container alone missed it. The toggle bar
// gets a 12px gap (clampToBounds adds EDGE_GAP, the rest is added here).
// top_band: caps the top like a band across the screen, whatever its width -
// the Run bar floats at the right end, and below it is the only place that
// keeps the button clear of both it and the nav row above it.
const DESKTOP_LAYOUT_MIN_WIDTH = 1280;
const BLOCKERS: { selector: string; gap: number; top_band?: boolean; min_width?: number }[] = [
    { selector: '.deriv-header', gap: EDGE_GAP },
    { selector: '.dc-tabs__list--main__tabs', gap: EDGE_GAP, min_width: DESKTOP_LAYOUT_MIN_WIDTH },
    { selector: '.run-strategy-bar', gap: EDGE_GAP, top_band: true },
    { selector: '.run-panel__container', gap: EDGE_GAP },
    { selector: '.dc-drawer__toggle', gap: 12 },
    { selector: '.app-footer', gap: EDGE_GAP },
    { selector: '.controls__section', gap: EDGE_GAP },
    // Phones, Tbots / DTrader: the slim Stop bar that replaces the run drawer
    // while something runs, and DTrader's own bottom bar (Trade / Positions /
    // Menu) inside its frame, marked by an invisible guard (dtrader/index.tsx).
    { selector: '.run-panel-slim-stop', gap: EDGE_GAP },
    { selector: '.dtrader-panel__bottom-bar-guard', gap: EDGE_GAP },
];

const visibleRect = (element: Element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) {
        return null;
    }
    return rect;
};

/**
 * Whether the run drawer is open, read from the page itself (its toggle bar
 * carries --open), not from the store: the panel must follow what is on
 * screen. `fallback` when there is no toggle bar.
 */
export const isRunDrawerOpen = (fallback: boolean) => {
    const toggle = document.querySelector('.dc-drawer__toggle');
    return toggle ? toggle.classList.contains('dc-drawer__toggle--open') : fallback;
};

/**
 * `ignore_run_drawer`: leave the run drawer out (the mobile AI panel when the
 * drawer is open - it covers the whole screen and would leave no room).
 * From 1280px the run panel never counts: the default spot keeps clear of it on
 * its own (defaultRight), and a spot the trader dragged onto the panel stays
 * there, so opening the panel can't move it. The AI panel doesn't use these
 * bounds at those widths.
 */
export const getSafeBounds = ({ ignore_run_drawer = false } = {}): TBounds => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bounds: TBounds = { top: 0, left: 0, right: vw, bottom: vh };
    const skip_run_drawer = ignore_run_drawer || vw >= DESKTOP_LAYOUT_MIN_WIDTH;

    BLOCKERS.forEach(({ selector, gap, top_band = false, min_width = 0 }) => {
        if (vw < min_width) return;
        if (skip_run_drawer && (selector === '.run-panel__container' || selector === '.dc-drawer__toggle')) return;
        const extra = gap - EDGE_GAP;
        document.querySelectorAll(selector).forEach(element => {
            const rect = visibleRect(element);
            if (!rect) return;
            if (top_band || rect.width >= vw * 0.6) {
                // A band across the screen: it caps the top or the bottom,
                // whichever half it's in.
                if (rect.top + rect.height / 2 < vh / 2) bounds.top = Math.max(bounds.top, rect.bottom + extra);
                else bounds.bottom = Math.min(bounds.bottom, rect.top - extra);
            } else if (rect.right >= vw - 1) {
                // A column on the right.
                bounds.right = Math.min(bounds.right, rect.left - extra);
            }
        });
    });

    return bounds;
};

/** Keep a size x size box fully inside `bounds` (with a small gap). */
export const clampToBounds = (point: TPoint, size: number, bounds: TBounds): TPoint => {
    const min_x = bounds.left + EDGE_GAP;
    const max_x = Math.max(min_x, bounds.right - EDGE_GAP - size);
    const min_y = bounds.top + EDGE_GAP;
    const max_y = Math.max(min_y, bounds.bottom - EDGE_GAP - size);
    return {
        x: Math.min(max_x, Math.max(min_x, point.x)),
        y: Math.min(max_y, Math.max(min_y, point.y)),
    };
};

/** Window widths from this up count as desktop / laptop for the button and the panel size. */
export const WIDE_MIN_WIDTH = 768;
export const isWideScreen = () => window.innerWidth >= WIDE_MIN_WIDTH;

/**
 * Bottom-right on every screen: on a desktop / laptop above the footer, on a
 * phone above the run bar - `bounds` already leaves those out. `right`: end
 * further left than the screen edge, at the same height (defaultRight).
 */
export const defaultPosition = (size: number, bounds: TBounds, right = bounds.right): TPoint => ({
    x: right - 2 * EDGE_GAP - size,
    y: bounds.bottom - 2 * EDGE_GAP - size,
});

// Blockly's can, lid included. Not the element's rectangle: that is its whole
// unclipped sprite, 96 x 124.
const TRASH_CAN_WIDTH = 47;
const TRASH_CAN_HEIGHT = 60;

/**
 * The Bot Builder's trash can, or null when it isn't on screen. Read from its
 * transform, which is where it ends up: the can takes 0.4s to get there
 * (main.scss), so its rectangle would be somewhere along the way.
 */
const trashCanRect = (): TBounds | null => {
    const trash = document.querySelector('.bot-builder--active .blocklyTrash');
    const workspace = trash?.closest('svg');
    if (!trash || !workspace || !visibleRect(trash)) return null;
    const translate = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(trash.getAttribute('transform') ?? '');
    if (!translate) return null;
    const { left: origin_x, top: origin_y } = workspace.getBoundingClientRect();
    const left = origin_x + Number(translate[1]);
    const top = origin_y + Number(translate[2]);
    return { left, top, right: left + TRASH_CAN_WIDTH, bottom: top + TRASH_CAN_HEIGHT };
};

/**
 * From 1280px: where the right of the default spot has to be - the bounds'
 * edge, or the edge the open run panel slides to, then the left of the trash
 * can if the button would touch it there. Only ever a move to the left: the
 * height stays. Null below 1280px. Takes the store's `is_run_panel_open`, not
 * the page's: the toggle bar's --open class lands a render later, and the
 * button has to set off with the panel. The panel's own rectangle only says
 * whether it is on this tab (not on Tbots / DTrader) and how wide it is: its
 * position is somewhere along the slide. Only for the default spot: a spot the
 * trader chose stays where they left it.
 */
export const defaultRight = (size: number, bounds: TBounds, is_run_panel_open: boolean): number | null => {
    if (window.innerWidth < DESKTOP_LAYOUT_MIN_WIDTH) return null;
    const panel = is_run_panel_open && document.querySelector('.run-panel__container');
    const panel_rect = panel && visibleRect(panel);
    // Rounded: mid-slide the width differs by a hair, and any change of `left`,
    // however small, starts the button's transition over.
    const right = panel_rect ? Math.min(bounds.right, window.innerWidth - Math.round(panel_rect.width)) : bounds.right;

    const can = trashCanRect();
    if (!can) return right;
    const { x, y } = defaultPosition(size, bounds, right);
    const touches_can =
        x < can.right + EDGE_GAP &&
        x + size + EDGE_GAP > can.left &&
        y < can.bottom + EDGE_GAP &&
        y + size + EDGE_GAP > can.top;
    return touches_can ? can.left : right;
};

// v2 for desktop / laptop: everyone gets the new bottom-right default once
// (the old desktop key, bottom-left default, is removed). Phones keep theirs.
const WIDE_POSITION_KEY = 'ai_scanner_button_position_wide_v2';
const PHONE_POSITION_KEY = 'ai_scanner_button_position_mobile';
const OLD_DESKTOP_POSITION_KEY = 'ai_scanner_button_position_desktop';
try {
    localStorage.removeItem(OLD_DESKTOP_POSITION_KEY);
} catch {
    // Storage unavailable - nothing stored to clear.
}

const positionKey = (is_wide: boolean) => (is_wide ? WIDE_POSITION_KEY : PHONE_POSITION_KEY);

export const readStoredPosition = (is_wide: boolean): TPoint | null => {
    try {
        const parsed = JSON.parse(localStorage.getItem(positionKey(is_wide)) ?? 'null');
        return parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y) ? parsed : null;
    } catch {
        return null;
    }
};

export const storePosition = (is_wide: boolean, point: TPoint) => {
    try {
        localStorage.setItem(positionKey(is_wide), JSON.stringify(point));
    } catch {
        // Storage unavailable - the button just returns to its default spot.
    }
};
