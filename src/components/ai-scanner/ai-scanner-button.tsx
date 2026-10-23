import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import {
    clampToBounds,
    defaultPosition,
    getSafeBounds,
    readStoredPosition,
    storePosition,
    TBounds,
    TPoint,
} from './ai-scanner-layout';
import { useAiScanner } from './use-ai-scanner';

// Movement under this many px is a tap, not a drag.
const DRAG_THRESHOLD = 6;

type TAiScannerButton = {
    is_desktop: boolean;
    onLayout: (layout: { position: TPoint; size: number; bounds: TBounds }) => void;
};

/**
 * The round, draggable "AI" button. Its remembered spot (per desktop/mobile)
 * is only ever displayed clamped into the live safe area (ai-scanner-layout.ts),
 * so it can't sit on the Run bar, the run panel or its toggle, or the mobile
 * run bar - including after a tab switch or the run panel sliding open.
 */
const AiScannerButton = observer(({ is_desktop, onLayout }: TAiScannerButton) => {
    const { run_panel, dashboard } = useStore();
    const ai_scanner = useAiScanner();
    const button_ref = useRef<HTMLButtonElement>(null);
    const drag_ref = useRef<{ pointer_id: number; start: TPoint; origin: TPoint; moved: boolean } | null>(null);
    const [stored, setStored] = useState<TPoint | null>(() => readStoredPosition(is_desktop));
    const [drag_position, setDragPosition] = useState<TPoint | null>(null);
    const [bounds, setBounds] = useState<TBounds>(() => getSafeBounds());

    useEffect(() => setStored(readStoredPosition(is_desktop)), [is_desktop]);

    // Re-measure on resize, tab switch, drawer toggle (after its 0.3s slide)
    // and Run state, plus a slow poll for anything else that moves the run
    // controls.
    const { active_tab } = dashboard;
    const { is_drawer_open, is_running } = run_panel;
    useEffect(() => {
        const measure = () => setBounds(getSafeBounds());
        measure();
        const settle = setTimeout(measure, 350);
        const poll = setInterval(measure, 1000);
        window.addEventListener('resize', measure);
        return () => {
            clearTimeout(settle);
            clearInterval(poll);
            window.removeEventListener('resize', measure);
        };
    }, [active_tab, is_drawer_open, is_running, is_desktop]);

    const size = button_ref.current?.offsetWidth || 56;
    const position = clampToBounds(drag_position ?? stored ?? defaultPosition(size, bounds, is_desktop), size, bounds);

    useLayoutEffect(() => {
        onLayout({ position, size, bounds });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [position.x, position.y, size, bounds.top, bounds.left, bounds.right, bounds.bottom]);

    const onPointerDown = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            if (event.button !== 0) return;
            drag_ref.current = {
                pointer_id: event.pointerId,
                start: { x: event.clientX, y: event.clientY },
                origin: position,
                moved: false,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
        },
        [position]
    );

    const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        const drag = drag_ref.current;
        if (!drag || drag.pointer_id !== event.pointerId) return;
        const dx = event.clientX - drag.start.x;
        const dy = event.clientY - drag.start.y;
        if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.moved = true;
        setDragPosition(clampToBounds({ x: drag.origin.x + dx, y: drag.origin.y + dy }, size, bounds));
    };

    const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
        const drag = drag_ref.current;
        if (!drag || drag.pointer_id !== event.pointerId) return;
        drag_ref.current = null;
        if (drag.moved && drag_position) {
            storePosition(is_desktop, drag_position);
            setStored(drag_position);
            setDragPosition(null);
        } else {
            ai_scanner.togglePanel();
        }
    };

    const onPointerCancel = () => {
        drag_ref.current = null;
        setDragPosition(null);
    };

    return (
        <button
            ref={button_ref}
            type='button'
            className={clsx('ai-scanner-button', {
                'ai-scanner-button--active': ai_scanner.is_active,
                'ai-scanner-button--dragging': !!drag_position,
            })}
            style={{ left: position.x, top: position.y }}
            aria-label={localize('AI Scanner')}
            aria-expanded={ai_scanner.is_panel_open}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    ai_scanner.togglePanel();
                }
            }}
        >
            AI
        </button>
    );
});

export default AiScannerButton;
