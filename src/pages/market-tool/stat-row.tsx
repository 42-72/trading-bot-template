import classNames from 'classnames';

type TStatRowProps = {
    label: string;
    pct: number;
    hasData: boolean;
    tone: 'tone-green' | 'tone-red' | 'tone-blue' | 'tone-yellow';
};

/** Single row: label | track (gradient fill) | percentage. No band, no noise indicator - live digits only. */
const StatRow = ({ label, pct, hasData, tone }: TStatRowProps) => (
    <div className={classNames('stat-row', tone)}>
        <span className='stat-row__label'>{label}</span>
        <div className='stat-row__track'>
            <div className='stat-row__fill' style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
        <span className='stat-row__pct'>{hasData ? `${pct.toFixed(1)}%` : '—'}</span>
    </div>
);

export default StatRow;
