import { DTRADER_EMBED_URL } from '@/utils/dtrader-embed';
import { getDTraderStartupFiles, scheduleDTraderWarmup, WARMUP_START_DELAY_MS } from '@/utils/dtrader-warmup';

const DTRADER_HTML = `<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link as="style" href="/css/core.vendor~a.111.main.css" rel="preload">
<link href="/css/core.vendor~a.111.main.css" rel="stylesheet">
<link href="/css/core.vendor~b.222.main.css" rel="stylesheet">
<link rel="prefetch" href="/trader/js/trader.trader-app-v2.333.js">
<link href="/manifest.json" rel="manifest">
<link href="https://fonts.googleapis.com/css2?family=x" rel="stylesheet">
</head><body>
<script defer="defer" src="/js/core.framework-vendor.444.js"></script>
<script defer="defer" src="/js/core.main~d5.555.js"></script>
<script src="https://evil.example/js/x.js"></script>
</body></html>`;

const EXPECTED_FILES = [
    'https://dtrader.charlestraders.com/js/core.framework-vendor.444.js',
    'https://dtrader.charlestraders.com/js/core.main~d5.555.js',
    'https://dtrader.charlestraders.com/css/core.vendor~a.111.main.css',
    'https://dtrader.charlestraders.com/css/core.vendor~b.222.main.css',
    'https://dtrader.charlestraders.com/trader/js/trader.trader-app-v2.333.js',
];

/** Advances fake time by `ms`, then 1 ms more for the idle callback (setTimeout 0 in jsdom) it schedules. */
const tick = (ms: number) => {
    jest.advanceTimersByTime(ms);
    jest.advanceTimersByTime(1);
};

const prefetchLinks = () =>
    Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="prefetch"]')).map(link => link.href);

/** Lets the pending fetch / text() promises settle. */
const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve(); // eslint-disable-line no-await-in-loop
};

/** Finishes the prefetch now in the document (the warm-up waits for it) and lets the next one start. */
const finishCurrentPrefetch = async () => {
    const link = document.head.querySelector<HTMLLinkElement>('link[rel="prefetch"]');
    link?.dispatchEvent(new Event('load'));
    await flush();
};

describe('getDTraderStartupFiles', () => {
    it("lists DTrader's own JS / CSS files once each, and nothing from other origins", () => {
        expect(getDTraderStartupFiles(DTRADER_HTML).sort()).toEqual([...EXPECTED_FILES].sort());
    });
});

describe('scheduleDTraderWarmup', () => {
    let fetch_mock: jest.Mock;

    beforeEach(() => {
        jest.useFakeTimers();
        sessionStorage.clear();
        document.head.innerHTML = '';
        fetch_mock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(DTRADER_HTML) });
        global.fetch = fetch_mock;
        Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    const start = (opts: Partial<{ isBusy: () => boolean; isOpened: () => boolean }> = {}) =>
        scheduleDTraderWarmup({ isBusy: () => false, isOpened: () => false, ...opts });

    const runAll = async () => {
        await flush();
        for (let i = 0; i < EXPECTED_FILES.length; i++) await finishCurrentPrefetch(); // eslint-disable-line no-await-in-loop
    };

    it('does nothing during start-up', async () => {
        start();
        jest.advanceTimersByTime(WARMUP_START_DELAY_MS - 1);
        await flush();
        expect(fetch_mock).not.toHaveBeenCalled();
    });

    it("then reads DTrader's page and prefetches its files one at a time", async () => {
        start();
        tick(WARMUP_START_DELAY_MS);
        await flush();
        expect(fetch_mock).toHaveBeenCalledWith(DTRADER_EMBED_URL, { credentials: 'omit' });
        expect(prefetchLinks()).toHaveLength(1);

        const seen: string[] = [];
        for (let i = 0; i < EXPECTED_FILES.length; i++) {
            seen.push(...prefetchLinks());
            await finishCurrentPrefetch(); // eslint-disable-line no-await-in-loop
        }
        expect(seen.sort()).toEqual([...EXPECTED_FILES].sort());
        expect(prefetchLinks()).toHaveLength(0);
        expect(sessionStorage.getItem('ct_dtrader_warmed')).toBe('1');
    });

    it('never starts while a bot or the AI Scanner is running, and resumes after the run', async () => {
        let is_busy = true;
        start({ isBusy: () => is_busy });
        tick(WARMUP_START_DELAY_MS);
        await flush();
        expect(fetch_mock).not.toHaveBeenCalled();

        tick(60000);
        await flush();
        expect(fetch_mock).not.toHaveBeenCalled();

        is_busy = false;
        tick(30000);
        await flush();
        expect(fetch_mock).toHaveBeenCalledTimes(1);
    });

    it('stops downloading as soon as a run starts mid-way', async () => {
        let is_busy = false;
        start({ isBusy: () => is_busy });
        tick(WARMUP_START_DELAY_MS);
        await flush();
        expect(prefetchLinks()).toHaveLength(1);

        is_busy = true;
        await finishCurrentPrefetch();
        expect(prefetchLinks()).toHaveLength(0);
        tick(120000);
        await flush();
        expect(prefetchLinks()).toHaveLength(0);
        expect(sessionStorage.getItem('ct_dtrader_warmed')).toBeNull();
    });

    it('is skipped once DTrader has been opened (the frame loads its files itself)', async () => {
        start({ isOpened: () => true });
        tick(WARMUP_START_DELAY_MS);
        await flush();
        expect(fetch_mock).not.toHaveBeenCalled();
    });

    it('is skipped on Data Saver', async () => {
        Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
        start();
        tick(WARMUP_START_DELAY_MS);
        await flush();
        expect(fetch_mock).not.toHaveBeenCalled();
    });

    describe('on a phone', () => {
        const laptop_width = window.innerWidth;
        const setConnection = (value?: object) =>
            Object.defineProperty(navigator, 'connection', { value, configurable: true });
        const setWidth = (value: number) =>
            Object.defineProperty(window, 'innerWidth', { value, configurable: true, writable: true });

        beforeEach(() => setWidth(390));
        afterEach(() => setWidth(laptop_width));

        it.each(['wifi', 'ethernet'])('warms up on %s', async type => {
            setConnection({ type, effectiveType: '4g' });
            start();
            tick(WARMUP_START_DELAY_MS);
            await flush();
            expect(fetch_mock).toHaveBeenCalledTimes(1);
        });

        it.each([
            ['mobile data', { type: 'cellular', effectiveType: '4g' }],
            ['an unknown connection', { type: 'unknown', effectiveType: '4g' }],
            ['a browser that only knows the speed', { effectiveType: '4g' }],
            ['a browser with no connection info (iPhone)', undefined],
            ['Wi-Fi with Data Saver', { type: 'wifi', saveData: true }],
            ['slow Wi-Fi (2G)', { type: 'wifi', effectiveType: '2g' }],
        ])('downloads nothing on %s, not even the page', async (_name, connection) => {
            setConnection(connection);
            start();
            tick(WARMUP_START_DELAY_MS);
            await flush();
            tick(120000);
            await flush();
            expect(fetch_mock).not.toHaveBeenCalled();
            expect(prefetchLinks()).toHaveLength(0);
        });

        it('stops if the phone leaves Wi-Fi mid-way', async () => {
            const connection = { type: 'wifi' };
            setConnection(connection);
            start();
            tick(WARMUP_START_DELAY_MS);
            await flush();
            expect(prefetchLinks()).toHaveLength(1);

            connection.type = 'cellular';
            await finishCurrentPrefetch();
            expect(prefetchLinks()).toHaveLength(0);
            expect(sessionStorage.getItem('ct_dtrader_warmed')).toBeNull();
        });

        it('never during a run, on Wi-Fi too', async () => {
            setConnection({ type: 'wifi' });
            start({ isBusy: () => true });
            tick(WARMUP_START_DELAY_MS);
            await flush();
            expect(fetch_mock).not.toHaveBeenCalled();
        });

        it('once per tab session, on Wi-Fi too', async () => {
            setConnection({ type: 'wifi' });
            start();
            tick(WARMUP_START_DELAY_MS);
            await runAll();
            start();
            tick(WARMUP_START_DELAY_MS);
            await flush();
            expect(fetch_mock).toHaveBeenCalledTimes(1);
        });

        it('767px is a phone, 768px is not', async () => {
            setConnection({ type: 'cellular' });
            setWidth(767);
            start();
            tick(WARMUP_START_DELAY_MS);
            await flush();
            expect(fetch_mock).not.toHaveBeenCalled();

            setWidth(768);
            start();
            tick(WARMUP_START_DELAY_MS);
            await flush();
            expect(fetch_mock).toHaveBeenCalledTimes(1);
        });
    });

    it.each([
        ['no connection info', undefined],
        ['a connection type it cannot read', { effectiveType: '4g' }],
        ['mobile data', { type: 'cellular', effectiveType: '4g' }],
    ])('laptops are unchanged: warms up with %s', async (_name, connection) => {
        Object.defineProperty(navigator, 'connection', { value: connection, configurable: true });
        start();
        tick(WARMUP_START_DELAY_MS);
        await flush();
        expect(fetch_mock).toHaveBeenCalledTimes(1);
    });

    it('runs once per browser tab session', async () => {
        start();
        tick(WARMUP_START_DELAY_MS);
        await runAll();
        expect(fetch_mock).toHaveBeenCalledTimes(1);

        start();
        tick(WARMUP_START_DELAY_MS);
        await flush();
        expect(fetch_mock).toHaveBeenCalledTimes(1);
    });

    it('can be cancelled (the panel unmounts)', async () => {
        const cancel = start();
        cancel();
        tick(WARMUP_START_DELAY_MS);
        await flush();
        expect(fetch_mock).not.toHaveBeenCalled();
    });

    it('gives up quietly when DTrader cannot be reached', async () => {
        fetch_mock.mockRejectedValueOnce(new Error('offline'));
        start();
        tick(WARMUP_START_DELAY_MS);
        await flush();
        expect(prefetchLinks()).toHaveLength(0);
    });
});
