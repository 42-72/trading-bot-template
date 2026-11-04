import { isDbotRTL } from '../../../utils/workspace';
import { getTrashcanSpot } from '../trashcan-spot';

jest.mock('../../../utils/workspace', () => ({ isDbotRTL: jest.fn(() => false) }));

const place = (className, rect) => {
    const element = document.createElement('div');
    element.className = className;
    element.getBoundingClientRect = () => rect;
    document.body.appendChild(element);
    return element;
};

const setViewport = (width, height) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
};

const botBuilder = panel_width => {
    place('run-panel__container', { width: panel_width });
    const builder = place('bot-builder--active', {});
    const svg = place('blocklySvg', { left: 16 });
    builder.appendChild(svg);
};

describe('getTrashcanSpot', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        isDbotRTL.mockReturnValue(false);
    });

    it.each([
        [1280, 720, 396.8],
        [1366, 768, 423.46],
        [1536, 864, 476.16],
        [1920, 1080, 595.2],
    ])('%ix%i, panel open: the whole can sits 16px left of the panel', (width, height, panel_width) => {
        setViewport(width, height);
        botBuilder(panel_width);
        const { x, y } = getTrashcanSpot(true);
        expect(16 + x + 47 + 16).toBe(width - Math.round(panel_width));
        expect(y).toBe(height - 250);
    });

    it('panel closed: its normal spot', () => {
        setViewport(1366, 768);
        botBuilder(423.46);
        expect(getTrashcanSpot(false)).toEqual({ x: 1266, y: 518 });
    });

    it("mid-slide, a hair's difference in the panel's width keeps the same spot", () => {
        setViewport(1280, 720);
        botBuilder(396.796875);
        const spot = getTrashcanSpot(true);
        document.body.innerHTML = '';
        botBuilder(396.80001);
        expect(getTrashcanSpot(true)).toEqual(spot);
    });

    it('no panel on the page: its normal spot', () => {
        setViewport(1366, 768);
        expect(getTrashcanSpot(true)).toEqual({ x: 1266, y: 518 });
    });

    it.each([
        ['open', true, 380],
        ['closed', false, 20],
    ])('right-to-left, panel %s: as before', (_name, is_open, x) => {
        isDbotRTL.mockReturnValue(true);
        setViewport(1366, 768);
        botBuilder(423.46);
        expect(getTrashcanSpot(is_open)).toEqual({ x, y: 518 });
    });
});

describe("Blockly's own positioning of the can", () => {
    const blocklyPosition = jest.fn();
    let setTrashcanPosition;

    beforeAll(() => {
        function Trashcan() {}
        Trashcan.prototype.position = blocklyPosition;
        window.Blockly = { Trashcan };
        jest.isolateModules(() => {
            require('../../hooks/trashcan'); // eslint-disable-line global-require
        });
    });

    beforeEach(() => {
        blocklyPosition.mockClear();
        setViewport(1536, 864);
        botBuilder(476.16);
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    const mainCan = () => {
        const can = new window.Blockly.Trashcan();
        setTrashcanPosition = jest.fn();
        can.setTrashcanPosition = setTrashcanPosition;
        window.Blockly.derivWorkspace = { trashcan: can };
        return can;
    };

    it('any workspace resize keeps the can left of the open panel', () => {
        document.querySelector('.run-panel__container').classList.add('dc-drawer--open');
        mainCan().position('metrics', 'saved');
        expect(blocklyPosition).toHaveBeenCalledWith('metrics', 'saved');
        expect(setTrashcanPosition).toHaveBeenCalledWith(981, 614);
    });

    it("panel closed: back to its normal spot, not Blockly's", () => {
        mainCan().position();
        expect(setTrashcanPosition).toHaveBeenCalledWith(1436, 614);
    });

    it("another workspace's can is left to Blockly", () => {
        mainCan();
        const other = new window.Blockly.Trashcan();
        other.setTrashcanPosition = jest.fn();
        other.position();
        expect(blocklyPosition).toHaveBeenCalled();
        expect(other.setTrashcanPosition).not.toHaveBeenCalled();
    });
});
