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
 * From 1280px the run panel never counts: the AI button keeps its spot at the
 * bottom right of the screen and floats over the panel when that is open, so
 * opening the panel can't move it (ai-scanner.scss). The AI panel doesn't use
 * these bounds at those widths.
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
 * phone above the run bar - `bounds` already leaves those out. `bottom`:
 * end higher than that (openRunPanelBottom).
 */
export const defaultPosition = (size: number, bounds: TBounds, bottom = bounds.bottom): TPoint => ({
    x: bounds.right - 2 * EDGE_GAP - size,
    y: bottom - 2 * EDGE_GAP - size,
});

/**
 * From 1280px, with the run panel open: where the button's default spot has to
 * end so it leaves the panel's stats and Reset uncovered - the top of the
 * stats block, or of the Reset row on Journal, which has no stats. The whole
 * block, not just Total profit/loss: its label and No. of runs sit right above
 * that value. Null otherwise. Only for the default spot: a spot the trader
 * chose stays where they left it.
 */
export const openRunPanelBottom = (): number | null => {
    if (window.innerWidth < DESKTOP_LAYOUT_MIN_WIDTH || !isRunDrawerOpen(false)) return null;
    const element =
        document.querySelector('.run-panel__container .run-panel__stat') ??
        document.querySelector('.run-panel__container .dc-drawer__footer');
    const rect = element && visibleRect(element);
    return rect ? rect.top : null;
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
