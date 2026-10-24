import { ENGINE_VARIABLES } from '@/constants/ai-engine';

// Writes the AI Scanner's locked values into a copy of the engine bot's XML.
//
// Every number goes into the ONE variables_set for that variable inside
// trade_definition's INITIALIZATION statement, found by the variable's NAME
// (<variables> maps name -> id, the set block's VAR field carries the id).
// Nothing here searches the text for numbers. A missing or duplicated target
// throws instead of guessing, so a changed engine file can never be run with
// a value silently left at its default.

export type TEngineValues = {
    market: string;
    submarket: string;
    symbol: string;
    ai_direction: 0 | 1;
    /** Over/Under engine only - the Even/Odd engine has no barriers. */
    first_barrier?: number;
    recovery_barrier?: number;
    stake: number;
    martingale: number;
    take_profit: number;
    stop_loss: number;
};

export class AiEngineXmlError extends Error {}

const childElements = (parent: Element, local_name: string, name?: string) =>
    Array.from(parent.children).filter(
        child => child.localName === local_name && (name === undefined || child.getAttribute('name') === name)
    );

const onlyChild = (parent: Element, local_name: string, name: string, what: string) => {
    const matches = childElements(parent, local_name, name);
    if (matches.length !== 1) throw new AiEngineXmlError(`${what}: expected 1, found ${matches.length}`);
    return matches[0];
};

const parse = (xml: string) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new AiEngineXmlError('engine XML does not parse');
    return doc;
};

const getTradeDefinition = (doc: Document) => {
    const roots = childElements(doc.documentElement, 'block').filter(
        block => block.getAttribute('type') === 'trade_definition'
    );
    if (roots.length !== 1) throw new AiEngineXmlError(`trade_definition: expected 1, found ${roots.length}`);
    return roots[0];
};

const getVariableId = (doc: Document, name: string) => {
    const [variables] = childElements(doc.documentElement, 'variables');
    const ids = (variables ? childElements(variables, 'variable') : [])
        .filter(variable => variable.textContent === name)
        .map(variable => variable.getAttribute('id'));
    if (ids.length !== 1 || !ids[0]) throw new AiEngineXmlError(`variable "${name}": expected 1, found ${ids.length}`);
    return ids[0];
};

/** The NUM field of the number block assigned to `name` in INITIALIZATION. */
const getInitialisationNumField = (doc: Document, name: string) => {
    const id = getVariableId(doc, name);
    const initialisation = onlyChild(getTradeDefinition(doc), 'statement', 'INITIALIZATION', 'INITIALIZATION');
    const set_blocks = Array.from(initialisation.getElementsByTagName('block')).filter(
        block =>
            block.getAttribute('type') === 'variables_set' &&
            childElements(block, 'field', 'VAR').some(field => field.getAttribute('id') === id)
    );
    if (set_blocks.length !== 1) {
        throw new AiEngineXmlError(`initialisation of "${name}": expected 1, found ${set_blocks.length}`);
    }
    const value = onlyChild(set_blocks[0], 'value', 'VALUE', `value of "${name}"`);
    const number_blocks = childElements(value, 'block').filter(block =>
        ['math_number', 'math_number_positive'].includes(block.getAttribute('type') ?? '')
    );
    if (number_blocks.length !== 1) throw new AiEngineXmlError(`"${name}" is not initialised to a number`);
    return onlyChild(number_blocks[0], 'field', 'NUM', `NUM of "${name}"`);
};

const getMarketBlock = (doc: Document) => {
    const trade_options = onlyChild(getTradeDefinition(doc), 'statement', 'TRADE_OPTIONS', 'TRADE_OPTIONS');
    const blocks = Array.from(trade_options.getElementsByTagName('block')).filter(
        block => block.getAttribute('type') === 'trade_definition_market'
    );
    if (blocks.length !== 1) throw new AiEngineXmlError(`market block: expected 1, found ${blocks.length}`);
    return blocks[0];
};

// Present in the Over/Under engine only: written when given, read back when
// the engine has them. Every other target must exist in every engine.
const OPTIONAL_TARGETS: (keyof typeof ENGINE_VARIABLES)[] = ['first_barrier', 'recovery_barrier'];

const hasVariable = (doc: Document, name: string) => {
    const [variables] = childElements(doc.documentElement, 'variables');
    return (variables ? childElements(variables, 'variable') : []).some(variable => variable.textContent === name);
};

const NUMBER_TARGETS: [keyof typeof ENGINE_VARIABLES, (values: TEngineValues) => number | undefined][] = [
    ['ai_direction', values => values.ai_direction],
    ['first_barrier', values => values.first_barrier],
    ['recovery_barrier', values => values.recovery_barrier],
    ['stake', values => values.stake],
    ['stake_2', values => values.stake],
    ['martingale', values => values.martingale],
    ['take_profit', values => values.take_profit],
    ['stop_loss', values => values.stop_loss],
];

export const writeEngineValues = (xml: string, values: TEngineValues): string => {
    const doc = parse(xml);

    NUMBER_TARGETS.forEach(([key, pick]) => {
        const value = pick(values);
        // A barrier not given (Even/Odd) is skipped; given, it must exist in
        // the engine (getInitialisationNumField throws otherwise).
        if (value === undefined && OPTIONAL_TARGETS.includes(key)) return;
        if (!Number.isFinite(value)) throw new AiEngineXmlError(`"${ENGINE_VARIABLES[key]}" is not a number`);
        getInitialisationNumField(doc, ENGINE_VARIABLES[key]).textContent = String(value);
    });

    const market_block = getMarketBlock(doc);
    onlyChild(market_block, 'field', 'MARKET_LIST', 'MARKET_LIST').textContent = values.market;
    onlyChild(market_block, 'field', 'SUBMARKET_LIST', 'SUBMARKET_LIST').textContent = values.submarket;
    onlyChild(market_block, 'field', 'SYMBOL_LIST', 'SYMBOL_LIST').textContent = values.symbol;

    return new XMLSerializer().serializeToString(doc);
};

/** Read back what writeEngineValues wrote - for tests and a pre-run sanity check. */
export const readEngineValues = (xml: string) => {
    const doc = parse(xml);
    const numbers = Object.fromEntries(
        (Object.keys(ENGINE_VARIABLES) as (keyof typeof ENGINE_VARIABLES)[])
            .filter(key => !OPTIONAL_TARGETS.includes(key) || hasVariable(doc, ENGINE_VARIABLES[key]))
            .map(key => [key, Number(getInitialisationNumField(doc, ENGINE_VARIABLES[key]).textContent)])
    ) as Record<Exclude<keyof typeof ENGINE_VARIABLES, 'first_barrier' | 'recovery_barrier'>, number> & {
        first_barrier?: number;
        recovery_barrier?: number;
    };
    const market_block = getMarketBlock(doc);
    const field = (name: string) => onlyChild(market_block, 'field', name, name).textContent ?? '';
    return {
        ...numbers,
        market: field('MARKET_LIST'),
        submarket: field('SUBMARKET_LIST'),
        symbol: field('SYMBOL_LIST'),
    };
};
