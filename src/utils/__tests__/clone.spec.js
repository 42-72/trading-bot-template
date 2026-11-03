import JSInterpreter from '@deriv/js-interpreter';
import cloneThorough from '../clone';
import cloneOriginal from '../test-fixtures/clone-original';

/** True when a and b are the same object graph: same shape, prototypes, descriptors, values and cycles. */
const sameGraph = (a, b, seen = new Map()) => {
    if (a === null || typeof a !== 'object') return Object.is(a, b);
    if (b === null || typeof b !== 'object') return false;
    if (seen.has(a)) return seen.get(a) === b;
    seen.set(a, b);
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    const keysA = Reflect.ownKeys(a);
    const keysB = Reflect.ownKeys(b);
    if (keysA.length !== keysB.length || keysA.some((k, i) => k !== keysB[i])) return false;
    return keysA.every(key => {
        const da = Object.getOwnPropertyDescriptor(a, key);
        const db = Object.getOwnPropertyDescriptor(b, key);
        if (da.enumerable !== db.enumerable || da.writable !== db.writable || da.configurable !== db.configurable) {
            return false;
        }
        if ('value' in da) return sameGraph(da.value, db.value, seen);
        return da.get === db.get && da.set === db.set;
    });
};

const CODE = `
    var stake = 1, log = [], obj = { a: [1, 2, { deep: 'x' }], when: new Date(0), re: /a+/g };
    obj.self = obj;
    function martingale(win) { stake = win ? 1 : stake * 2; log.push(stake); return stake; }
    for (var i = 0; i < 5; i++) martingale(i % 2 === 0);
`;

const interpreterMidway = () => {
    const interpreter = new JSInterpreter(CODE, () => {});
    for (let i = 0; i < 400; i++) interpreter.step();
    return interpreter;
};

describe('cloneThorough (the restart-on-error snapshot of the interpreter state)', () => {
    it('produces exactly the same graph as the original clone, for a real interpreter state', () => {
        const { stateStack } = interpreterMidway();
        const fast = cloneThorough(stateStack, undefined, undefined, undefined, true);
        const original = cloneOriginal(stateStack, undefined, undefined, undefined, true);
        expect(sameGraph(fast, original)).toBe(true);
        expect(fast).not.toBe(stateStack);
        expect(fast[0]).not.toBe(stateStack[0]);
    });

    it('handles circular references, Map, Set, Date, RegExp, arrays and non-enumerable properties like the original', () => {
        const source = { list: [1, 'two', { three: 3 }], map: new Map([['k', { v: 1 }]]), set: new Set([1, 2]) };
        source.date = new Date(1730000000000);
        source.re = /x/gi;
        source.self = source;
        source.list.push(source);
        Object.defineProperty(source, 'hidden', { value: { secret: true }, enumerable: false });
        const fast = cloneThorough(source, undefined, undefined, undefined, true);
        const original = cloneOriginal(source, undefined, undefined, undefined, true);
        expect(sameGraph(fast, original)).toBe(true);
        expect(fast.self).toBe(fast);
        expect(fast.list[3]).toBe(fast);
        expect(fast.hidden).toEqual({ secret: true });
        expect(fast.map.get('k')).not.toBe(source.map.get('k'));
    });

    it('a restored snapshot carries on exactly as the original run', () => {
        const run = interpreter => {
            while (interpreter.step());
            return interpreter.pseudoToNative(interpreter.getValueFromScope('log'));
        };
        const reference = run(new JSInterpreter(CODE, () => {}));

        // As takeStateSnapshot / restoreStateSnapshot in tradeEngine/utils/interpreter.js.
        const restoreAndRun = clone => {
            const interpreter = interpreterMidway();
            const snapshot = clone(interpreter.stateStack, undefined, undefined, undefined, true);
            run(interpreter); // the original goes on and finishes
            interpreter.stateStack = clone(snapshot, undefined, undefined, undefined, true);
            interpreter.global = interpreter.stateStack[0].scope.object || interpreter.stateStack[0].scope;
            interpreter.initFunc_(interpreter, interpreter.global);
            return run(interpreter);
        };
        expect(restoreAndRun(cloneThorough)).toEqual(restoreAndRun(cloneOriginal));
        expect(Object.values(restoreAndRun(cloneThorough))).toEqual(Object.values(reference));
    });

    it('is no longer quadratic: a large state clones much faster than with the original', () => {
        const big = { items: Array.from({ length: 6000 }, (_, i) => ({ i, nested: { v: i } })) };
        let t = performance.now();
        cloneOriginal(big, undefined, undefined, undefined, true);
        const original_ms = performance.now() - t;
        t = performance.now();
        cloneThorough(big, undefined, undefined, undefined, true);
        const fast_ms = performance.now() - t;
        // eslint-disable-next-line no-console
        console.log(`clone of 12,000 objects: original ${original_ms.toFixed(0)} ms, now ${fast_ms.toFixed(0)} ms`);
        expect(fast_ms * 5).toBeLessThan(original_ms);
    });
});
