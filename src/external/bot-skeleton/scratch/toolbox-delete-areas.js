import { validateErrorOnBlockDelete } from './utils';

// The toolbox and its flyout are React, not Blockly's own (none is given to
// inject, and the store's flyout is never initialised), so Blockly doesn't know
// they are there: these tell it. Desktop only in practice: below 1280px the
// toolbox is a dialog, which can't be open during a drag.
const DELETE_AREA_SELECTORS = ['.db-toolbox', '.flyout'];

/** Dropping a block on the toolbox or the open flyout deletes it. */
export const addToolboxDeleteAreas = workspace => {
    class ToolboxDeleteArea extends window.Blockly.DeleteArea {
        constructor(selector) {
            super();
            this.id = `delete_area_${selector}`;
            this.selector = selector;
        }

        getClientRect() {
            const rect = document.querySelector(this.selector)?.getBoundingClientRect();
            if (!rect?.width || !rect.height) return null;
            return new window.Blockly.utils.Rect(rect.top, rect.bottom, rect.left, rect.right);
        }

        // Over these, a block that could connect is still deleted, as with
        // Blockly's own toolbox: what it could connect to is hidden underneath.
        wouldDelete(element) {
            return super.wouldDelete(element, false);
        }

        shouldPreventMove(element) {
            return !element.isDeletable();
        }

        // A block that can't be deleted goes back where it came from, rather
        // than staying out of sight under the toolbox. By hand: shouldPreventMove
        // only stops Blockly recording the move, the block stays where it is.
        onDrop(element) {
            validateErrorOnBlockDelete(element);
            const start = workspace.currentGesture_?.getCurrentDragger()?.startXY_;
            if (start && !element.isDeletable()) element.moveDuringDrag(start);
        }
    }

    const { Capability } = window.Blockly.ComponentManager;
    DELETE_AREA_SELECTORS.forEach(selector => {
        workspace.getComponentManager().addComponent({
            component: new ToolboxDeleteArea(selector),
            weight: 1,
            capabilities: [Capability.DELETE_AREA, Capability.DRAG_TARGET],
        });
    });

    // Blockly keeps the areas' rectangles from the last resize, but the flyout
    // comes and goes without one, and the toolbox has no size until its tab shows.
    workspace.addChangeListener(event => {
        if (event.type === window.Blockly.Events.BLOCK_DRAG && event.isStart) workspace.recordDragTargets();
    });
};
