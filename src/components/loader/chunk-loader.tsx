import { useEffect } from 'react';
import { ct_perf } from '@/utils/ct-perf';
import { Loader } from '@deriv-com/ui';

export default function ChunkLoader({ message }: { message: string }) {
    // [CT perf]: which loaders show, for how long (start-up, account switch).
    useEffect(() => ct_perf.loaderShown(message || 'loader'), [message]);

    return (
        <div className='app-root'>
            <Loader />
            <div className='load-message'>{message}</div>
        </div>
    );
}
