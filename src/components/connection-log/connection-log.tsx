import { useEffect, useState } from 'react';
import { clearConnLog, formatConnLog, readConnLog, subscribeConnLog } from '@/utils/connection-log';
import { isConnDebugEnabled } from '@/utils/session-flags';
import './connection-log.scss';

const copyText = async (text: string) => {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Older phone browsers: select-and-copy fallback.
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        textarea.remove();
        return ok;
    }
};

/**
 * Hidden "Connection log" button (only with ?ctdebug=1) and its panel: the
 * last 50 connection / auth events from utils/connection-log.ts, with Copy.
 * Developer tooling - English only, not translated.
 */
const ConnectionLog = () => {
    const [is_open, setIsOpen] = useState(false);
    const [entries, setEntries] = useState(readConnLog);
    const [copy_state, setCopyState] = useState('');

    useEffect(() => subscribeConnLog(setEntries), []);

    if (!isConnDebugEnabled()) return null;

    const text = formatConnLog(entries);

    return (
        <>
            <button
                type='button'
                className='connection-log__button'
                onClick={() => {
                    setEntries(readConnLog());
                    setIsOpen(open => !open);
                }}
            >
                Connection log
            </button>
            {is_open && (
                <div className='connection-log__panel' role='dialog' aria-label='Connection log'>
                    <div className='connection-log__header'>
                        <strong>Connection log ({entries.length})</strong>
                        <button
                            type='button'
                            onClick={async () => setCopyState((await copyText(text)) ? 'Copied' : 'Copy failed')}
                        >
                            {copy_state || 'Copy'}
                        </button>
                        <button
                            type='button'
                            onClick={() => {
                                clearConnLog();
                                setCopyState('');
                            }}
                        >
                            Clear
                        </button>
                        <button type='button' onClick={() => setIsOpen(false)}>
                            Close
                        </button>
                    </div>
                    <pre className='connection-log__entries' data-testid='dt_connection_log_entries'>
                        {text || 'No events yet.'}
                    </pre>
                </div>
            )}
        </>
    );
};

export default ConnectionLog;
