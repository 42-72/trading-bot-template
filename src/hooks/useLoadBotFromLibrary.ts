import { useCallback } from 'react';
import { TBotLibraryEntry } from '@/constants/bot-library';
import { DBOT_TABS } from '@/constants/bot-contents';
import { botNotification } from '@/components/bot-notification/bot-notification';
import { load, observer as globalObserver, save_types } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';

/**
 * Loads a bundled bot-library strategy into the main Blockly workspace, reusing
 * the same `load()` pipeline as the local-file/Google-Drive import paths (parses,
 * validates block types, names the workspace, saves to recent - see
 * external/bot-skeleton/scratch/utils/index.js). load() itself calls
 * saveWorkspaceToRecent, so whatever was in the workspace stays recoverable from
 * Recent - there is no confirmation before replacing it.
 * Never starts the bot; the user reviews the loaded blocks and presses Run themselves.
 */
export const useLoadBotFromLibrary = () => {
    const { dashboard } = useStore();
    const { setActiveTab } = dashboard;

    const loadBot = useCallback(
        async (bot: TBotLibraryEntry) => {
            const workspace = window.Blockly?.derivWorkspace;

            try {
                const result = await load({
                    block_string: bot.file,
                    drop_event: {},
                    file_name: bot.name,
                    strategy_id: null,
                    from: save_types.UNSAVED,
                    workspace,
                    showIncompatibleStrategyDialog: false,
                });

                // load() already shows a visible error (notification + log) on
                // parse/validation failure - don't switch tabs on top of that.
                if (result?.error) return;

                setActiveTab(DBOT_TABS.BOT_BUILDER);
            } catch (error) {
                console.error('Failed to load bot from library:', error); // eslint-disable-line no-console
                const message = localize('Could not load this bot. Please try again.');
                botNotification(message);
                globalObserver.emit('ui.log.error', message);
            }
        },
        [setActiveTab]
    );

    return { loadBot };
};
