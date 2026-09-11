import { useEffect, useState } from 'react';

/**
 * Diagnostic-only overlay for the mobile "Run button unreachable" investigation.
 * Renders ONLY when the URL contains `?debug=layout` - never otherwise. Reports
 * layout geometry only: no account number, balance, token, or other account data
 * is read, displayed, or logged anywhere in this file.
 *
 * Deliberately does NOT touch the MobX store tree (no useStore/observer) - this
 * must stay mountable and safe regardless of auth/store state, so quick_strategy's
 * is_open is reported as "unknown" rather than risking a store dependency here.
 *
 * Remove this component once the investigation is closed out.
 */

const CB_PROPS: Array<[jsProp: string, cssName: string]> = [
    ['transform', 'transform'],
    ['filter', 'filter'],
    ['perspective', 'perspective'],
    ['backdropFilter', 'backdrop-filter'],
    ['willChange', 'will-change'],
    ['contain', 'contain'],
];

const truncate = (value: string, length: number) => (value.length > length ? `${value.slice(0, length)}…` : value);

const rectLine = (label: string, el: Element | null): string => {
    if (!el) return `${label}: MISSING`;
    const r = el.getBoundingClientRect();
    return `${label}: top=${r.top.toFixed(1)} bottom=${r.bottom.toFixed(1)} height=${r.height.toFixed(1)}`;
};

const buildReport = (): string => {
    const lines: string[] = [];

    lines.push('--- viewport ---');
    lines.push(`innerHeight=${window.innerHeight}`);
    lines.push(`clientHeight=${document.documentElement.clientHeight}`);
    if (window.visualViewport) {
        lines.push(`vv.height=${window.visualViewport.height.toFixed(1)}`);
        lines.push(`vv.offsetTop=${window.visualViewport.offsetTop.toFixed(1)}`);
    } else {
        lines.push('visualViewport: unsupported');
    }

    lines.push('--- rects ---');
    lines.push(rectLine('.deriv-header', document.querySelector('.deriv-header')));
    lines.push(rectLine('.layout', document.querySelector('.layout')));
    lines.push(rectLine('.bot-dashboard', document.querySelector('.bot-dashboard')));
    lines.push(rectLine('.controls__section', document.querySelector('.controls__section')));
    lines.push(rectLine('#db-animation__run-button', document.getElementById('db-animation__run-button')));

    lines.push('--- .controls__section computed ---');
    const controlsSection = document.querySelector('.controls__section');
    if (controlsSection) {
        const cs = getComputedStyle(controlsSection);
        lines.push(`position=${cs.position} bottom=${cs.bottom} zIndex=${cs.zIndex} transform=${cs.transform}`);
    } else {
        lines.push('.controls__section: MISSING');
    }

    lines.push('--- ancestor chain (run button -> html) ---');
    const runBtn = document.getElementById('db-animation__run-button');
    if (!runBtn) {
        lines.push('RUN BTN MISSING');
    } else {
        let el: Element | null = runBtn;
        let foundCb = false;
        while (el && el !== document.documentElement) {
            const cs = getComputedStyle(el);
            const clsName = truncate(String(el.className || '(no class)'), 30);
            CB_PROPS.forEach(([jsProp, cssName]) => {
                const val = (cs as unknown as Record<string, string>)[jsProp];
                if (val && val !== 'none' && val !== 'auto') {
                    lines.push(`${clsName} -> ${cssName}: ${val}`);
                    foundCb = true;
                }
            });
            el = el.parentElement;
        }
        if (!foundCb) lines.push('NO CB ANCESTOR');
    }

    lines.push('--- elementFromPoint ---');
    const bottomCenter = document.elementFromPoint(Math.round(window.innerWidth / 2), window.innerHeight - 10);
    lines.push(`bottom-centre: ${bottomCenter ? truncate(String(bottomCenter.className || ''), 40) : 'null'}`);
    if (runBtn) {
        const r = runBtn.getBoundingClientRect();
        const cx = Math.round(r.left + r.width / 2);
        const cy = Math.round(r.top + r.height / 2);
        const atButton = document.elementFromPoint(cx, cy);
        lines.push(`run-btn-centre: ${atButton ? truncate(String(atButton.className || ''), 40) : 'null'}`);
    }

    lines.push('--- misc ---');
    lines.push('qs.is_open: unknown (not read - see component comment)');

    return lines.join('\n');
};

const DebugLayoutOverlay = () => {
    const [enabled] = useState<boolean>(() => {
        try {
            return new URLSearchParams(window.location.search).get('debug') === 'layout';
        } catch {
            return false;
        }
    });
    const [report, setReport] = useState('');

    useEffect(() => {
        if (!enabled) return undefined;

        const refresh = () => {
            try {
                setReport(buildReport());
            } catch (error) {
                setReport(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
            }
        };

        refresh();
        window.addEventListener('resize', refresh);
        window.addEventListener('orientationchange', refresh);
        document.addEventListener('scroll', refresh, true);

        return () => {
            window.removeEventListener('resize', refresh);
            window.removeEventListener('orientationchange', refresh);
            document.removeEventListener('scroll', refresh, true);
        };
    }, [enabled]);

    if (!enabled) return null;

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                zIndex: 2147483647,
                background: '#000',
                color: '#0f0',
                font: '11px/1.35 monospace',
                padding: 6,
                pointerEvents: 'none',
                whiteSpace: 'pre',
            }}
        >
            {report}
        </div>
    );
};

export default DebugLayoutOverlay;
