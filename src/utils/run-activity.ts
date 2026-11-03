type TRunActivityStores = {
    run_panel: { is_stop_button_visible: boolean };
    ai_scanner: { is_active: boolean };
};

/**
 * A bot is running (or still has an open contract) or the AI Scanner is busy
 * (checking, scanning, starting, running or stopping). Read inside a MobX
 * observer / reaction so callers follow it.
 */
export const isBotOrScannerRunning = ({ run_panel, ai_scanner }: TRunActivityStores) =>
    !!run_panel?.is_stop_button_visible || !!ai_scanner?.is_active;
