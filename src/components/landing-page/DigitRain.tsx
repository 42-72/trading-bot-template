import { useEffect, useRef } from 'react';

const FONT_SIZE = 14;
const COLUMN_WIDTH = 16;
const COLUMN_WIDTH_NARROW = 22;
const NARROW_BREAKPOINT = 480;
const MAX_COLUMNS = 120;
const TICK_MS = 50;
const RESIZE_DEBOUNCE_MS = 200;
const DIGITS = '0123456789';
const BG_COLOR = '#0e0e0e';
const TRAIL_FILL = 'rgba(14, 14, 14, 0.08)'; // must match the page background or a grey haze builds up
const HEAD_COLOR = '#e8fdf8';
const BODY_COLOR = 'rgba(34, 197, 94, 0.75)';

const randomDigit = () => DIGITS[(Math.random() * DIGITS.length) | 0];
const getColumnWidth = () => (window.innerWidth < NARROW_BREAKPOINT ? COLUMN_WIDTH_NARROW : COLUMN_WIDTH);

/**
 * Decorative digit-rain background for the landing hero. Pure canvas texture —
 * never conveys content, so it stays out of the accessibility tree entirely.
 */
const DigitRain = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return undefined;

        const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

        let columnWidth = getColumnWidth();
        let columns = 0;
        let rows = 0;
        let drops: number[] = [];
        let tickId: ReturnType<typeof setInterval> | null = null;
        let resizeTimer: ReturnType<typeof setTimeout> | null = null;

        const setupCanvas = () => {
            const width = window.innerWidth;
            const height = window.innerHeight;
            const dpr = window.devicePixelRatio || 1;

            columnWidth = getColumnWidth();
            columns = Math.min(MAX_COLUMNS, Math.ceil(width / columnWidth));
            rows = Math.ceil(height / FONT_SIZE);

            canvas.width = width * dpr;
            canvas.height = height * dpr;
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            drops = new Array(columns).fill(0).map(() => Math.floor(Math.random() * rows));

            ctx.fillStyle = BG_COLOR;
            ctx.fillRect(0, 0, width, height);
        };

        const draw = () => {
            const width = window.innerWidth;
            const height = window.innerHeight;

            ctx.fillStyle = TRAIL_FILL;
            ctx.fillRect(0, 0, width, height);

            ctx.font = `${FONT_SIZE}px 'Courier New', monospace`;
            ctx.textBaseline = 'top';

            for (let i = 0; i < columns; i++) {
                const x = i * columnWidth;
                const row = drops[i];

                // the row the head just left reads as body — dim green, fading further each tick
                ctx.fillStyle = BODY_COLOR;
                ctx.fillText(randomDigit(), x, (row - 1) * FONT_SIZE);

                // the head itself — bright, off-white
                ctx.fillStyle = HEAD_COLOR;
                ctx.fillText(randomDigit(), x, row * FONT_SIZE);

                drops[i] = row * FONT_SIZE > height && Math.random() > 0.975 ? 0 : row + 1;
            }
        };

        const startTicking = () => {
            if (tickId) return;
            tickId = setInterval(draw, TICK_MS);
        };

        const stopTicking = () => {
            if (tickId) {
                clearInterval(tickId);
                tickId = null;
            }
        };

        const handleVisibilityChange = () => {
            if (document.hidden) {
                stopTicking();
            } else {
                startTicking();
            }
        };

        const handleResize = () => {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                setupCanvas();
                draw();
            }, RESIZE_DEBOUNCE_MS);
        };

        setupCanvas();
        draw();

        if (!prefersReducedMotion) {
            startTicking();
            document.addEventListener('visibilitychange', handleVisibilityChange);
        }
        window.addEventListener('resize', handleResize);

        return () => {
            stopTicking();
            if (resizeTimer) clearTimeout(resizeTimer);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    return <canvas ref={canvasRef} className='landing-page__rain' aria-hidden='true' />;
};

export default DigitRain;
