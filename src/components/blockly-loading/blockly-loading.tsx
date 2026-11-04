import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { session_status } from '@/utils/session-status';
import { Loader } from '@deriv-com/ui';

const BlocklyLoading = observer(() => {
    const { blockly_store } = useStore();
    const { is_loading } = blockly_store;

    return (
        <>
            {is_loading && !session_status.is_landing_shown && (
                <div className='bot__loading' data-testid='blockly-loader'>
                    <Loader />
                    <div>Loading Blockly...</div>
                </div>
            )}
        </>
    );
});

export default BlocklyLoading;
