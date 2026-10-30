import {
    DTRADER_ORIGIN,
    getDTraderSession,
    getSafeNavigateUrl,
    isDTraderEmbedEnabled,
    isDTraderMessage,
    postToDTrader,
} from '@/utils/dtrader-embed';

const setAuthInfo = (expires_at: number) => {
    sessionStorage.setItem(
        'auth_info',
        JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 60, expires_at })
    );
};

describe('dtrader-embed', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        window.history.replaceState({}, '', '/');
    });

    describe('isDTraderEmbedEnabled (test switch)', () => {
        it('is off by default', () => {
            expect(isDTraderEmbedEnabled()).toBe(false);
        });

        it('turns on with ?dtrader_embed=1, remembers it and cleans the URL', () => {
            window.history.replaceState({}, '', '/?dtrader_embed=1#dtrader');
            expect(isDTraderEmbedEnabled()).toBe(true);
            expect(localStorage.getItem('ct_dtrader_embed')).toBe('1');
            expect(window.location.search).toBe('');
            expect(window.location.hash).toBe('#dtrader');
            expect(isDTraderEmbedEnabled()).toBe(true);
        });

        it('turns off with ?dtrader_embed=0', () => {
            localStorage.setItem('ct_dtrader_embed', '1');
            window.history.replaceState({}, '', '/?dtrader_embed=0');
            expect(isDTraderEmbedEnabled()).toBe(false);
            expect(localStorage.getItem('ct_dtrader_embed')).toBeNull();
        });
    });

    describe('getDTraderSession', () => {
        it('is null when logged out', () => {
            expect(getDTraderSession()).toBeNull();
        });

        it('never includes the refresh token', () => {
            const expires_at = Date.now() + 60000;
            setAuthInfo(expires_at);
            localStorage.setItem('active_loginid', 'DEM123');
            expect(getDTraderSession()).toEqual({
                access_token: 'test-access',
                expires_at,
                account_id: 'DEM123',
                account_type: 'demo',
            });
            expect(JSON.stringify(getDTraderSession())).not.toContain('test-refresh');
        });

        it('marks non-demo accounts as real', () => {
            setAuthInfo(Date.now() + 60000);
            localStorage.setItem('active_loginid', 'CR123');
            expect(getDTraderSession()?.account_type).toBe('real');
        });

        it('is null once the token has expired', () => {
            setAuthInfo(Date.now() - 1);
            localStorage.setItem('active_loginid', 'DEM123');
            expect(getDTraderSession()).toBeNull();
        });
    });

    describe('messages', () => {
        const frame = { postMessage: jest.fn() } as unknown as Window;

        it('posts only to the exact DTrader origin', () => {
            postToDTrader(frame, { type: 'ct:logout' });
            expect(frame.postMessage).toHaveBeenCalledWith({ type: 'ct:logout' }, DTRADER_ORIGIN);
        });

        it('accepts only ct:* messages from the DTrader frame and origin', () => {
            const make = (origin: string, source: unknown, data: unknown) => ({ origin, source, data }) as MessageEvent;
            expect(isDTraderMessage(make(DTRADER_ORIGIN, frame, { type: 'ct:ready' }), frame)).toBe(true);
            expect(isDTraderMessage(make('https://evil.example', frame, { type: 'ct:ready' }), frame)).toBe(false);
            expect(isDTraderMessage(make(DTRADER_ORIGIN, {}, { type: 'ct:ready' }), frame)).toBe(false);
            expect(isDTraderMessage(make(DTRADER_ORIGIN, frame, { type: 'other' }), frame)).toBe(false);
            expect(isDTraderMessage(make(DTRADER_ORIGIN, frame, { type: 'ct:ready' }), null)).toBe(false);
        });

        it('only lets DTrader open pages on this site', () => {
            expect(getSafeNavigateUrl(`${window.location.origin}/transfer?x=1`)).toBe(
                `${window.location.origin}/transfer?x=1`
            );
            expect(getSafeNavigateUrl('https://evil.example/transfer')).toBeNull();
            expect(getSafeNavigateUrl('javascript:alert(1)')).toBeNull();
            expect(getSafeNavigateUrl(42)).toBeNull();
        });
    });
});
