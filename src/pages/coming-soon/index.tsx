import { Localize } from '@deriv-com/translations';

type TComingSoonProps = {
    tab_name: string;
};

const ComingSoon = ({ tab_name }: TComingSoonProps) => (
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
        <span style={{ fontSize: '2.5rem' }}>🚧</span>
        <h2 style={{ margin: 0, color: 'var(--text-general)', fontSize: '1.6rem' }}>{tab_name}</h2>
        <p style={{ margin: 0, color: 'var(--text-less-prominent)', fontSize: '1.2rem' }}>
            <Localize i18n_default_text='Coming soon' />
        </p>
    </div>
);

export default ComingSoon;
