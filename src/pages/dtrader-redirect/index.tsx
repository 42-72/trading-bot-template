import { Localize } from '@deriv-com/translations';

const DTraderRedirect = () => (
    <div
        style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: '8px',
            padding: '48px 16px',
        }}
    >
        <h2 style={{ margin: 0, color: 'var(--text-general)', fontSize: '1.6rem' }}>DTrader</h2>
        <p style={{ margin: 0, color: 'var(--text-less-prominent)', fontSize: '1.2rem' }}>
            <Localize i18n_default_text='Please wait for DTrader to open in a new tab.' />
        </p>
    </div>
);

export default DTraderRedirect;
