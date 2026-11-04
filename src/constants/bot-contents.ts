type TTabsTitle = {
    [key: string]: string | number;
};

type TDashboardTabIndex = {
    [key: string]: number;
};

export const tabs_title: TTabsTitle = Object.freeze({
    WORKSPACE: 'Workspace',
    CHART: 'Chart',
});

export const DBOT_TABS: TDashboardTabIndex = Object.freeze({
    DASHBOARD: 0,
    BOT_BUILDER: 1,
    TBOTS: 2,
    MARKET_TOOL: 3,
    DTRADER: 4,
    TRADINGVIEW: 5,
    CHART: 6,
    COPY_TRADING: 7,
});

// Tabs where the phone / tablet run bar (.controls__section) has nothing
// meaningful to run against - Tbots loads a strategy but doesn't run it from
// here, DTrader redirects away entirely. Below 1280px only: the desktop Run
// bar and run panel are on every tab (run-strategy.tsx, run-panel.tsx).
export const RUN_BAR_HIDDEN_TABS = [DBOT_TABS.TBOTS, DBOT_TABS.DTRADER];

// Phones only (< 768px): on these tabs the run panel drawer (Summary /
// Transactions / Journal) and its handle are hidden, so the tab gets the full
// height (DTrader's own bottom bar sits at the bottom of the screen). While a
// bot or the AI Scanner is running, a slim Stop bar is shown instead
// (run-panel.tsx, SlimStopBar).
export const PHONE_FULL_HEIGHT_TABS = [DBOT_TABS.TBOTS, DBOT_TABS.DTRADER];

export const MAX_STRATEGIES = 10;

export const TAB_IDS = [
    'id-dbot-dashboard',
    'id-bot-builder',
    'id-tbots',
    'id-market-tool',
    'id-dtrader',
    'id-tradingview',
    'id-charts',
    'id-copy-trading',
];

export const DEBOUNCE_INTERVAL_TIME = 500;
