type TBrandLogoProps = {
    width?: number;
    height?: number;
    fill?: string;
    className?: string;
};

export const BrandLogo = ({ className = '' }: TBrandLogoProps) => {
    return (
        <span className={`brand-wordmark ${className}`.trim()}>
            <span className='brand-wordmark__charles'>Charles</span><span className='brand-wordmark__traders'>Traders</span>
        </span>
    );
};
