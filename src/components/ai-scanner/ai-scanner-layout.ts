// Where the AI Scanner's floating button and panel may sit: the viewport less
// the header, the Run controls and the footer, measured live from the DOM
// rather than repeated as magic numbers - the Run bar only exists on some
// tabs, the run panel column slides open and closed, and the mobile run bar
// grows by the safe-area inset. Anything that needs to stay uncovered is in
// BLOCKERS; the button is kept fully inside what's left.

export type TBounds = { top: number; left: number; right: number; bottom: number };
export type TPoint = { x: number; y: number };

const EDGE_GAP = 8;

// Header, desktop Run bar (run-strategy.tsx), desktop run panel column with
// its toggle (run-panel.tsx), desktop footer, mobile run bar
// (.controls__section), and the run drawer's toggle bar on its own: below
// 1280px the closed drawer's container measures 0 tall while its full-width
// ▲ toggle bar still shows, so the container alone missed it. The toggle bar
// gets a 12px gap (clampToBounds adds EDGE_GAP, the rest is added here).
const BLOCKERS: { selector: string; gap: number }[] = [
    { selector: '.deriv-header', gap: EDGE_GAP },
    { selector: '.run-strategy-bar', gap: EDGE_GAP },
    { selector: '.run-panel__container', gap: EDGE_GAP },
    { selector: '.dc-drawer__toggle', gap: 12 },
    { selector: '.app-footer', gap: EDGE_GAP },
    { selector: '.controls__section', gap: EDGE_GAP },
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
 * `ignore_run_drawer`: leave the run drawer out (the mobile AI panel when the
 * drawer is open - it covers the whole screen and would leave no room).
 */
export const getSafeBounds = ({ ignore_run_drawer = false } = {}): TBounds => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bounds: TBounds = { top: 0, left: 0, right: vw, bottom: vh };

    BLOCKERS.forEach(({ selector, gap }) => {
        if (ignore_run_drawer && (selector === '.run-panel__container' || selector === '.dc-drawer__toggle')) return;
        const extra = gap - EDGE_GAP;
        document.querySelectorAll(selector).forEach(element => {
            const rect = visibleRect(element);
            if (!rect) return;
            if (rect.width >= vw * 0.6) {
                // A band across the screen: it caps the top or the bottom,
                // whichever half it's in.
                if (rect.top + rect.height / 2 < vh / 2) bounds.top = Math.max(bounds.top, rect.bottom + extra);
                else bounds.bottom = Math.min(bounds.bottom, rect.top - extra);
            } else if (rect.right >= vw - 1) {
                // A column on the right (the desktop run panel, or just its
                // toggle sliver when closed).
                bounds.right = Math.min(bounds.right, rect.left - extra);
            }
        });
    });

    return bounds;
};

/**
 * The Run bar is a full-width band, but its controls (Run button, status)
 * only fill its right end. A box spanning `left`..`right` that stays clear of
 * them may also use the empty rest of the band, up to the nav row: returns
 * that higher top, or null when there's no Run bar or the box would reach a
 * control.
 */
export const runBarTopBeside = (left: number, right: number): number | null => {
    const bar = document.querySelector('.run-strategy-bar');
    const bar_rect = bar && visibleRect(bar);
    if (!bar || !bar_rect) return null;
    const controls = Array.from(bar.children)
        .map(visibleRect)
        .filter((rect): rect is DOMRect => !!rect);
    const reaches_control = controls.some(rect => left < rect.right + EDGE_GAP && right > rect.left - EDGE_GAP);
    return reaches_control ? null : bar_rect.top;
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
 * Bottom-right of the content area on every screen: on a desktop / laptop
 * (>= 768px) left of the run panel column and above the footer, on a phone
 * above the run bar - `bounds` already leaves those out.
 */
export const defaultPosition = (size: number, bounds: TBounds): TPoint => ({
    x: bounds.right - 2 * EDGE_GAP - size,
    y: bounds.bottom - 2 * EDGE_GAP - size,
});

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
