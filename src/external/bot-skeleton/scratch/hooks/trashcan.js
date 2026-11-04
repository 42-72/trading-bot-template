import { getTrashcanSpot } from '../utils/trashcan-spot';

/**
 * Inspect the contents of the trash.
 * @deriv/bot: Noop for us, restore original functionality when trashcan can be inspected.
 */
window.Blockly.Trashcan.prototype.click = function () {};

window.Blockly.Trashcan.prototype.setTrashcanPosition = (position_right, position_top) => {
    const trashcan_instance = window.Blockly.derivWorkspace?.trashcan?.svgGroup;
    trashcan_instance?.setAttribute('transform', `translate(${position_right}, ${position_top})`);
};

/**
 * Blockly puts the can back in its own corner, behind the open run panel, on
 * every workspace resize: the window's, and any Blockly.svgResize (opening the
 * flyout, deleting a comment). Its own positioning still runs for its
 * bookkeeping; the can then goes back where it belongs. The panel isn't sliding
 * here, so its class says whether it is open (main.tsx handles the toggle).
 */
const blocklyPosition = window.Blockly.Trashcan.prototype.position;
window.Blockly.Trashcan.prototype.position = function (...args) {
    blocklyPosition.apply(this, args);
    if (this !== window.Blockly.derivWorkspace?.trashcan) return;
    const { x, y } = getTrashcanSpot(!!document.querySelector('.run-panel__container.dc-drawer--open'));
    this.setTrashcanPosition(x, y);
};
