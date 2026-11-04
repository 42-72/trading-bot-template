import { isDbotRTL } from '../../utils/workspace';

const TRASHCAN_WIDTH = 47;
const GAP_TO_RUN_PANEL = 16;

/**
 * Where the Bot Builder's trash can belongs, in workspace coordinates: just left
 * of the open run panel, or in its normal spot when the panel is closed. From
 * the panel's width, not its position: that is somewhere along the slide while
 * it opens. Rounded for the AI button, which keeps to the left of the can: any
 * change in its target, however small, starts its slide over.
 */
export const getTrashcanSpot = is_run_panel_open => {
    const y = window.innerHeight - 250;
    if (isDbotRTL()) return { x: is_run_panel_open ? 380 : 20, y };

    const panel_width = is_run_panel_open
        ? document.querySelector('.run-panel__container')?.getBoundingClientRect().width
        : 0;
    if (!panel_width) return { x: window.innerWidth - 100, y };

    const workspace_left = document.querySelector('.bot-builder--active .blocklySvg')?.getBoundingClientRect().left;
    const panel_left = window.innerWidth - Math.round(panel_width);
    return { x: panel_left - GAP_TO_RUN_PANEL - TRASHCAN_WIDTH - (workspace_left ?? 0), y };
};
