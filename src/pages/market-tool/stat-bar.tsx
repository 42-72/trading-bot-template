import classNames from 'classnames';
import { TStat } from '@/utils/digit-stats';

type TStatBarProps = {
    stat: TStat;
};

const clampPct = (value: number) => Math.max(0, Math.min(100, value * 100));

/**
 * One measure's observed percentage plotted against its 95% band. The band
 * is drawn as a shaded region; the observed value is a marker on top of it -
 * inside the shaded region reads as ordinary noise, outside it is flagged
 * (never with red/green - this is "statistically notable", not "good/bad"
 * or a buy/sell cue).
 */
const StatBar = ({ stat }: TStatBarProps) => {
    const bandLow = clampPct(stat.bandLow);
    const bandHigh = clampPct(stat.bandHigh);
    const markerPos = clampPct(stat.pHat);

    return (
        <div className={classNames('stat-bar', { 'stat-bar--outside': !stat.isInsideBand })}>
            <div className='stat-bar__meta'>
                <span className='stat-bar__label'>{stat.label}</span>
                <span className='stat-bar__value'>{stat.n > 0 ? `${(stat.pHat * 100).toFixed(1)}%` : '—'}</span>
            </div>
            <div className='stat-bar__track'>
                <div
                    className='stat-bar__band'
                    style={{ left: `${bandLow}%`, width: `${Math.max(0, bandHigh - bandLow)}%` }}
                    title={`95% band: ${bandLow.toFixed(1)}%–${bandHigh.toFixed(1)}%`}
                />
                <div className='stat-bar__marker' style={{ left: `${markerPos}%` }} />
            </div>
            {!stat.isInsideBand && stat.n > 0 && (
                <span className='stat-bar__flag'>Outside the expected range for this window</span>
            )}
        </div>
    );
};

export default StatBar;
