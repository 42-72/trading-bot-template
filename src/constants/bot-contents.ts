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
