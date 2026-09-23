import classNames from 'classnames';

type TTickRibbonProps = {
    /** Oldest first, newest last - already sliced to the last 40 by the caller. */
    digits: number[];
};

/**
 * Full-width strip of the most recent digits. 40 cells render always; a
 * mobile media query (market-tool.scss) hides all but the last 18 rather
 * than this component re-slicing per breakpoint, so the same array/keys
 * serve both layouts.
 */
const TickRibbon = ({ digits }: TTickRibbonProps) => (
    <div className='tick-ribbon' role='list' aria-label='Recent last digits, oldest to newest'>
        {digits.map((digit, index) => (
            <span
                // Index as key is intentional here: position (age slot), not
                // tick identity, is what this list renders - the newest slot
                // always sits at the end and gets the highlight treatment.
                key={index}
                className={classNames('tick-ribbon__cell', {
                    'tick-ribbon__cell--newest': index === digits.length - 1,
                })}
            >
                {digit}
            </span>
        ))}
    </div>
);

export default TickRibbon;
