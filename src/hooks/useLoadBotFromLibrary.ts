import { useCallback } from 'react';
import { DBOT_TABS } from '@/constants/bot-contents';
import { TBotLibraryEntry } from '@/constants/bot-library';
import { useStore } from '@/hooks/useStore';
import { addLibraryStrategyId } from '@/utils/library-strategies';
import { loadBotIntoBuilder } from '@/utils/load-bot-into-builder';

/**
 * Loads a bundled bot-library strategy into the main Blockly workspace
 * (loadBotIntoBuilder - the same load() pipeline as the local-file/Google-Drive
 * import paths). load() calls saveWorkspaceToRecent for the loaded bot; there
 * is no confirmation before replacing what was in the workspace.
 * Never starts the bot; the user reviews the loaded blocks and presses Run themselves.
 */
export const useLoadBotFromLibrary = () => {
    const { dashboard } = useStore();
    const { setActiveTab } = dashboard;

    const loadBot = useCallback(
        async (bot: TBotLibraryEntry) => {
            const is_loaded = await loadBotIntoBuilder({ block_string: bot.file, file_name: bot.name });
            // On failure the error is already visible - don't switch tabs on top of that.
            if (!is_loaded) return;

            // load() gave the workspace a fresh current_strategy_id; tag it so
            // Bot Builder doesn't reopen this bot on the next startup.
            addLibraryStrategyId(window.Blockly?.derivWorkspace?.current_strategy_id);
            setActiveTab(DBOT_TABS.BOT_BUILDER);
        },
        [setActiveTab]
    );

    return { loadBot };
};
