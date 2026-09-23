import classNames from 'classnames';
import { TDigitRank } from '@/utils/digit-stats';

type TDigitCircleProps = {
    digit: number;
    pct: number;
    hasData: boolean;
    rank?: TDigitRank;
    isLatest: boolean;
    /** Changes on every accepted tick landing on this digit - remounts the circle so its bounce animation replays even on a repeat digit. */
    bounceKey: number | null;
};

const RANK_TONE: Record<TDigitRank, string> = {
    1: 'tone-green',
    2: 'tone-blue',
    3: 'tone-yellow',
    4: 'tone-red',
};

const DigitCircle = ({ digit, pct, hasData, rank, isLatest, bounceKey }: TDigitCircleProps) => (
    <div className='digit-circle-wrap'>
        <div
            key={isLatest ? bounceKey : undefined}
            className={classNames('digit-circle', rank ? RANK_TONE[rank] : undefined, {
                'digit-circle--ranked': rank,
                'digit-circle--bounce': isLatest,
            })}
        >
            <span className='digit-circle__digit'>{digit}</span>
            <span className='digit-circle__pct'>{hasData ? `${pct.toFixed(1)}%` : '—'}</span>
        </div>
        {isLatest && <span className='digit-circle__caret' aria-hidden='true' />}
    </div>
);

export default DigitCircle;
