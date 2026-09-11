import { action, computed, makeObservable, observable } from 'mobx';
import { tabs_title } from '@/constants/bot-contents';
import { getSavedWorkspaces, onWorkspaceResize } from '@/external/bot-skeleton';
import { getSetting, storeSetting } from '@/utils/settings';
import RootStore from './root-store';

export default class BlocklyStore {
    root_store: RootStore;

    constructor(root_store: RootStore) {
        makeObservable(this, {
            is_loading: observable,
            active_tab: observable,
            _has_saved_bots: observable,
            pristine_workspace_xml: observable,
            has_active_bot: computed,
            has_saved_bots: computed,
            setLoading: action,
            setActiveTab: action,
            checkForSavedBots: action,
            setPristineWorkspaceXml: action,
        });
        this.root_store = root_store;
    }

    is_loading = false;
    active_tab = tabs_title.WORKSPACE;

    // Snapshot of the workspace XML taken right after it was last (re)loaded - see
    // DBot.initWorkspace() (default/recent-file load on first run) and load() in
    // scratch/utils (every subsequent explicit strategy load), both of which write
    // this at their end regardless of how the workspace got populated. isWorkspaceDirty
    // compares the live workspace against this rather than inferring edits from
    // Blockly change events, which fire for programmatic housekeeping (e.g. cleanUp's
    // block repositioning) as well as real user edits and can't be reliably told apart.
    pristine_workspace_xml = '';

    // Computed property to check if there's an active bot
    get has_active_bot(): boolean {
        // Check if there's an active bot in the workspace
        const workspace = window.Blockly?.derivWorkspace;
        if (!workspace) return false;

        // Check if there are any blocks in the workspace
        const top_blocks = workspace.getTopBlocks();
        return top_blocks && top_blocks.length > 0;
    }

    // Computed property to check if there are saved bots
    get has_saved_bots(): boolean {
        // Since we can't make this async, we'll use a cached value
        // This value will be updated when the component mounts
        return this._has_saved_bots;
    }

    // Private property to cache the result of the async check
    _has_saved_bots = false;

    // Method to check for saved bots and update the cache
    checkForSavedBots = async (): Promise<void> => {
        try {
            const workspaces = await getSavedWorkspaces();
            // Use action to update observable property
            this._has_saved_bots = Array.isArray(workspaces) && workspaces.length > 0;
        } catch (e) {
            console.error('Error checking for saved workspaces:', e);
            this._has_saved_bots = false;
        }
    };

    setActiveTab = (tab: string): void => {
        this.active_tab = tab;
        storeSetting('active_tab', this.active_tab);
    };

    setContainerSize = (): void => {
        if (this.active_tab === tabs_title.WORKSPACE) {
            onWorkspaceResize();
        }
    };

    onMount = (): void => {
        window.addEventListener('resize', this.setContainerSize);
        // Check for saved bots when the component mounts
        this.checkForSavedBots();
    };

    getCachedActiveTab = (): void => {
        if (getSetting('active_tab')) {
            this.active_tab = getSetting('active_tab');
        }
    };

    onUnmount = (): void => {
        window.removeEventListener('resize', this.setContainerSize);
    };

    setLoading = (is_loading: boolean): void => {
        this.is_loading = is_loading;
    };

    setPristineWorkspaceXml = (xml: string): void => {
        this.pristine_workspace_xml = xml;
    };

    // Strips attributes Blockly regenerates on every serialization (block/variable
    // ids, canvas position) and collapses whitespace, so only attributes that
    // represent actual user intent - block type, field values, connections,
    // collapsed/disabled state - are compared.
    private normaliseXml = (xml: string): string =>
        xml
            .replace(/\s(?:id|x|y)="[^"]*"/g, '')
            .replace(/>\s+</g, '><')
            .replace(/\s+/g, ' ')
            .trim();

    isWorkspaceDirty = (): boolean => {
        const workspace = window.Blockly?.derivWorkspace;
        if (!workspace) return false;

        // No snapshot to compare against (e.g. it failed to write) - assume dirty.
        // A spurious "replace strategy?" dialog is safe; silently replacing whatever
        // is actually in the workspace is not.
        if (!this.pristine_workspace_xml) return true;

        const current_xml = window.Blockly.Xml.domToText(window.Blockly.Xml.workspaceToDom(workspace));
        return this.normaliseXml(current_xml) !== this.normaliseXml(this.pristine_workspace_xml);
    };
}
