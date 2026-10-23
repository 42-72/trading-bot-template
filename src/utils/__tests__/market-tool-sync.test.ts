import { syncBotBuilderSymbol } from '../market-tool-sync';

jest.mock('@/external/bot-skeleton', () => ({ ApiHelpers: { instance: null } }));

describe('syncBotBuilderSymbol', () => {
    it('never overwrites the market while the AI Scanner owns the workspace', () => {
        const getAllBlocks = jest.fn(() => []);
        (window as unknown as { Blockly: unknown }).Blockly = {
            derivWorkspace: { getAllBlocks },
            Events: { getGroup: () => '', setGroup: jest.fn() },
        };
        expect(
            syncBotBuilderSymbol('1HZ25V', { is_bot_live: false, is_ai_scanner_active: true, offered: ['1HZ25V'] })
        ).toBe('ai-scanner');
        expect(getAllBlocks).not.toHaveBeenCalled();
        // Without the scanner, the sync goes on to look at the workspace as before.
        syncBotBuilderSymbol('1HZ25V', { is_bot_live: false, offered: ['1HZ25V'] });
        expect(getAllBlocks).toHaveBeenCalled();
    });
});
