type TBrandLogoProps = {
    width?: number;
    height?: number;
    fill?: string;
    className?: string;
};

export const BrandLogo = ({
    width = 180,
    height = 32,
    fill = 'currentColor',
    className = ''
}: TBrandLogoProps) => {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 180 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
            aria-label="CharlesTraders"
        >
            <text
                x="0"
                y="23"
                fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
                fontSize="18"
                fontWeight="700"
                fill={fill}
                letterSpacing="-0.3"
            >
                CharlesTraders
            </text>
        </svg>
    );
};
