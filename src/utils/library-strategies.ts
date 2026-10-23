// Strategy ids (Blockly workspace current_strategy_id) of bots loaded from the
// Tbots library (useLoadBotFromLibrary). Bot Builder reopens the newest entry
// in Recent on startup (dbot.js); ids listed here are skipped, so a library
// bot only ever opens when it is loaded deliberately from Tbots. An explicit
// Save (save-modal-store) removes the id - a bot the user chose to save is
// theirs to resume.

const STORAGE_KEY = 'library_strategy_ids';
// Recent itself keeps at most 10 workspaces (local-storage.js); this only has
// to outlive them.
const MAX_IDS = 50;

const readIds = (): string[] => {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
        return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
    } catch {
        return [];
    }
};

const writeIds = (ids: string[]) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(-MAX_IDS)));
    } catch {
        // Storage unavailable (private mode, quota) - startup then falls back to
        // upstream behaviour (newest Recent entry), nothing worse.
    }
};

export const addLibraryStrategyId = (id?: string | null) => {
    if (!id) return;
    const ids = readIds().filter(existing => existing !== id);
    writeIds([...ids, id]);
};

export const removeLibraryStrategyId = (id?: string | null) => {
    if (!id) return;
    const ids = readIds();
    if (ids.includes(id)) writeIds(ids.filter(existing => existing !== id));
};

export const isLibraryStrategyId = (id?: string | null) => !!id && readIds().includes(id);
