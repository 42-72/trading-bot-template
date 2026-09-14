import classNames from 'classnames';
import { TStat } from '@/utils/digit-stats';

type TDigitRingProps = {
    digit: number;
    stat: TStat;
    isLatest: boolean;
    isHighest: boolean;
    isLowest: boolean;
    /** Changes on every accepted tick for this digit - remounts the pulse span so its CSS animation restarts even on repeat digits. */
    pulseKey: number | null;
};

const RADIUS = 28;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const DigitRing = ({ digit, stat, isLatest, isHighest, isLowest, pulseKey }: TDigitRingProps) => {
    const pct = stat.pHat * 100;
    // Ring fill is the literal percentage of the window, not rescaled - a
    // stretched scale would visually exaggerate how far a digit is from
    // "ordinary", which is exactly the impression this tool must not give.
    const fillFraction = Math.max(0, Math.min(1, pct / 100));
    const dashOffset = CIRCUMFERENCE * (1 - fillFraction);

    return (
        <div
            className={classNames('digit-ring', {
                'digit-ring--highest': isHighest,
                'digit-ring--lowest': isLowest,
            })}
        >
            {isLatest && <span key={pulseKey} className='digit-ring__pulse' aria-hidden='true' />}
            <svg className='digit-ring__svg' viewBox='0 0 64 64' aria-hidden='true'>
                <circle className='digit-ring__track' cx={32} cy={32} r={RADIUS} />
                <circle
                    className='digit-ring__fill'
                    cx={32}
                    cy={32}
                    r={RADIUS}
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={dashOffset}
                />
            </svg>
            <div className='digit-ring__label'>
                <span className='digit-ring__digit'>{digit}</span>
                <span className='digit-ring__pct'>{stat.n > 0 ? `${pct.toFixed(1)}%` : '—'}</span>
            </div>
            {isHighest && (
                <span className='digit-ring__badge digit-ring__badge--highest' title='Highest share in this window'>
                    Highest
                </span>
            )}
            {isLowest && (
                <span className='digit-ring__badge digit-ring__badge--lowest' title='Lowest share in this window'>
                    Lowest
                </span>
            )}
        </div>
    );
};

export default DigitRing;
