import { botNotification } from '@/components/bot-notification/bot-notification';
import { load, observer as globalObserver, save_types } from '@/external/bot-skeleton';
import { localize } from '@deriv-com/translations';

/**
 * Loads a bundled strategy into the main Blockly workspace, reusing the same
 * `load()` pipeline as the local-file/Google-Drive import paths (parses,
 * validates block types, names the workspace, saves to recent - see
 * external/bot-skeleton/scratch/utils/index.js). No file is downloaded.
 * The one load path for Tbots' "Load bot" (useLoadBotFromLibrary) and the AI
 * Scanner's engine. `strategy_id` null gets a fresh id from load().
 * Never starts the bot. Returns whether the workspace now holds the strategy;
 * on failure the error has already been shown (notification + Journal).
 */
export const loadBotIntoBuilder = async ({
    block_string,
    file_name,
    strategy_id = null,
}: {
    block_string: string;
    file_name: string;
    strategy_id?: string | null;
}): Promise<boolean> => {
    try {
        const result = await load({
            block_string,
            drop_event: {},
            file_name,
            strategy_id,
            from: save_types.UNSAVED,
            workspace: window.Blockly?.derivWorkspace,
            showIncompatibleStrategyDialog: false,
        });

        // load() already shows a visible error (notification + log) on
        // parse/validation failure - nothing more to show here.
        return !result?.error && !!window.Blockly?.derivWorkspace;
    } catch (error) {
        console.error('Failed to load bot:', error); // eslint-disable-line no-console
        const message = localize('Could not load this bot. Please try again.');
        botNotification(message);
        globalObserver.emit('ui.log.error', message);
        return false;
    }
};
