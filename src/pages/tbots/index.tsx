import Button from '@/components/shared_ui/button';
import { BOT_LIBRARY } from '@/constants/bot-library';
import { useLoadBotFromLibrary } from '@/hooks/useLoadBotFromLibrary';
import { Localize } from '@deriv-com/translations';
import './tbots.scss';

const Tbots = () => {
    const { loadBot } = useLoadBotFromLibrary();

    return (
        <div className='tbots'>
            <div className='tbots__grid'>
                {BOT_LIBRARY.map(bot => (
                    <div className='tbots__card' key={bot.id}>
                        <div className='tbots__card__header'>
                            <span className='tbots__card__number'>{bot.number}</span>
                            <h3 className='tbots__card__name'>{bot.name}</h3>
                        </div>

                        <p className='tbots__card__description'>{bot.description}</p>

                        <Button primary className='tbots__card__action' onClick={() => loadBot(bot)}>
                            <Localize i18n_default_text='Load bot' />
                        </Button>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default Tbots;
