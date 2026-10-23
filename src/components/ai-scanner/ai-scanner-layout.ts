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
// (.controls__section) and the mobile run drawer with its toggle.
const BLOCKERS = ['.deriv-header', '.run-strategy-bar', '.run-panel__container', '.app-footer', '.controls__section'];

const visibleRect = (element: Element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) {
        return null;
    }
    return rect;
};

export const getSafeBounds = (): TBounds => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bounds: TBounds = { top: 0, left: 0, right: vw, bottom: vh };

    BLOCKERS.forEach(selector => {
        document.querySelectorAll(selector).forEach(element => {
            const rect = visibleRect(element);
            if (!rect) return;
            if (rect.width >= vw * 0.6) {
                // A band across the screen: it caps the top or the bottom,
                // whichever half it's in.
                if (rect.top + rect.height / 2 < vh / 2) bounds.top = Math.max(bounds.top, rect.bottom);
                else bounds.bottom = Math.min(bounds.bottom, rect.top);
            } else if (rect.right >= vw - 1) {
                // A column on the right (the desktop run panel, or just its
                // toggle sliver when closed).
                bounds.right = Math.min(bounds.right, rect.left);
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

/** Desktop: bottom-left, clear of the Blockly zoom/trash controls on the right. Mobile: bottom-right, above the run bar. */
export const defaultPosition = (size: number, bounds: TBounds, is_desktop: boolean): TPoint => ({
    x: is_desktop ? bounds.left + 2 * EDGE_GAP : bounds.right - 2 * EDGE_GAP - size,
    y: bounds.bottom - 2 * EDGE_GAP - size,
});

const positionKey = (is_desktop: boolean) => `ai_scanner_button_position_${is_desktop ? 'desktop' : 'mobile'}`;

export const readStoredPosition = (is_desktop: boolean): TPoint | null => {
    try {
        const parsed = JSON.parse(localStorage.getItem(positionKey(is_desktop)) ?? 'null');
        return parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y) ? parsed : null;
    } catch {
        return null;
    }
};

export const storePosition = (is_desktop: boolean, point: TPoint) => {
    try {
        localStorage.setItem(positionKey(is_desktop), JSON.stringify(point));
    } catch {
        // Storage unavailable - the button just returns to its default spot.
    }
};
