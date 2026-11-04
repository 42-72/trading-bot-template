import { validateErrorOnBlockDelete } from '../utils';
import { addToolboxDeleteAreas } from '../toolbox-delete-areas';

jest.mock('../utils', () => ({ validateErrorOnBlockDelete: jest.fn() }));

const place = (className, rect) => {
    const element = document.createElement('div');
    element.className = className;
    element.getBoundingClientRect = () => rect;
    document.body.appendChild(element);
};

describe('addToolboxDeleteAreas', () => {
    let components;
    let listener;
    let workspace;

    const area = name => components.find(({ component }) => component.id.includes(name)).component;

    beforeEach(() => {
        class DeleteArea {
            wouldDelete(_element, could_connect) {
                return !could_connect;
            }
        }
        function Rect(top, bottom, left, right) {
            Object.assign(this, { top, bottom, left, right });
        }
        window.Blockly = {
            DeleteArea,
            ComponentManager: { Capability: { DELETE_AREA: 'delete_area', DRAG_TARGET: 'drag_target' } },
            Events: { BLOCK_DRAG: 'drag' },
            utils: { Rect },
        };
        components = [];
        workspace = {
            addChangeListener: jest.fn(callback => {
                listener = callback;
            }),
            getComponentManager: () => ({ addComponent: component => components.push(component) }),
            recordDragTargets: jest.fn(),
        };
        addToolboxDeleteAreas(workspace);
    });

    afterEach(() => {
        document.body.innerHTML = '';
        validateErrorOnBlockDelete.mockClear();
    });

    it('registers the toolbox and the open flyout as delete areas and drag targets', () => {
        expect(components).toHaveLength(2);
        components.forEach(({ capabilities }) => expect(capabilities).toEqual(['delete_area', 'drag_target']));
        expect(new Set(components.map(({ component }) => component.id)).size).toBe(2);
    });

    it('covers the toolbox as it is on the page', () => {
        place('db-toolbox', { top: 130, bottom: 700, left: 24, right: 244, width: 220, height: 570 });
        expect(area('db-toolbox').getClientRect()).toMatchObject({ top: 130, bottom: 700, left: 24, right: 244 });
    });

    it('is no target when not on the page, or folded to nothing', () => {
        expect(area('db-toolbox').getClientRect()).toBeNull();
        place('flyout', { width: 0, height: 0 });
        expect(area('flyout').getClientRect()).toBeNull();
    });

    it('deletes a block that could connect to something hidden underneath', () => {
        expect(area('flyout').wouldDelete({}, true)).toBe(true);
    });

    it('sends a block that cannot be deleted back, and lets a deletable one through', () => {
        expect(area('db-toolbox').shouldPreventMove({ isDeletable: () => false })).toBe(true);
        expect(area('db-toolbox').shouldPreventMove({ isDeletable: () => true })).toBe(false);
    });

    it('checks a dropped block for the "mandatory block" message', () => {
        const block = { type: 'trade_definition', isDeletable: () => false, moveDuringDrag: jest.fn() };
        area('db-toolbox').onDrop(block);
        expect(validateErrorOnBlockDelete).toHaveBeenCalledWith(block);
    });

    describe('dropped during a drag', () => {
        const start = { x: 40, y: 60 };

        beforeEach(() => {
            workspace.currentGesture_ = { getCurrentDragger: () => ({ startXY_: start }) };
        });

        it('a block that cannot be deleted goes back where the drag started', () => {
            const block = { isDeletable: () => false, moveDuringDrag: jest.fn() };
            area('db-toolbox').onDrop(block);
            expect(block.moveDuringDrag).toHaveBeenCalledWith(start);
        });

        it('a deletable block is left for Blockly to delete', () => {
            const block = { isDeletable: () => true, moveDuringDrag: jest.fn() };
            area('db-toolbox').onDrop(block);
            expect(block.moveDuringDrag).not.toHaveBeenCalled();
        });
    });

    it('measures again at the start of each drag, not during or after it', () => {
        listener({ type: 'drag', isStart: false });
        listener({ type: 'change', isStart: true });
        expect(workspace.recordDragTargets).not.toHaveBeenCalled();
        listener({ type: 'drag', isStart: true });
        expect(workspace.recordDragTargets).toHaveBeenCalledTimes(1);
    });
});
