import { useEffect, useState } from 'react';

/**
 * Phones: window narrower than 768px. Matches the `phone-screen` rules in
 * dtrader.scss / tbots.scss / run-panel.scss (max-width: 767px), so what JS
 * decides and what CSS lays out never disagree. Laptops and tablets (>= 768px)
 * are not phones here.
 */
export const PHONE_MEDIA_QUERY = '(max-width: 767px)';

export const isPhoneWidth = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(PHONE_MEDIA_QUERY).matches
        : false;

export const useIsPhone = () => {
    const [is_phone, setIsPhone] = useState(isPhoneWidth);

    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return undefined;
        const query = window.matchMedia(PHONE_MEDIA_QUERY);
        const onChange = () => setIsPhone(query.matches);
        onChange();
        query.addEventListener?.('change', onChange);
        return () => query.removeEventListener?.('change', onChange);
    }, []);

    return is_phone;
};
