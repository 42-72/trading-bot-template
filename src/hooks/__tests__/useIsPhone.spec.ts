import { PHONE_MEDIA_QUERY, useIsPhone } from '@/hooks/useIsPhone';
import { act, renderHook } from '@testing-library/react';

describe('useIsPhone', () => {
    const original_match_media = window.matchMedia;
    let listeners: Array<() => void>;
    let matches: boolean;

    beforeEach(() => {
        listeners = [];
        matches = true;
        window.matchMedia = jest.fn().mockImplementation((query: string) => ({
            get matches() {
                return matches;
            },
            media: query,
            addEventListener: (_type: string, fn: () => void) => listeners.push(fn),
            removeEventListener: jest.fn(),
        }));
    });

    afterEach(() => {
        window.matchMedia = original_match_media;
    });

    it('is a phone below 768px and follows the window width', () => {
        const { result } = renderHook(() => useIsPhone());
        expect(window.matchMedia).toHaveBeenCalledWith(PHONE_MEDIA_QUERY);
        expect(PHONE_MEDIA_QUERY).toBe('(max-width: 767px)');
        expect(result.current).toBe(true);

        matches = false;
        act(() => listeners.forEach(fn => fn()));
        expect(result.current).toBe(false);
    });

    it('is not a phone where matchMedia is missing', () => {
        // @ts-expect-error - simulate an engine without matchMedia
        window.matchMedia = undefined;
        const { result } = renderHook(() => useIsPhone());
        expect(result.current).toBe(false);
    });
});
