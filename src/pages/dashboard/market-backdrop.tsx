// A faint market chart behind the quote and cards: still, decoration only, and
// much quieter than the loading screen's, so the cards stay the focus.
const MarketBackdrop = () => (
    <svg
        className='dashboard-backdrop'
        viewBox='0 0 1200 800'
        preserveAspectRatio='none'
        aria-hidden='true'
        focusable='false'
    >
        <path className='dashboard-backdrop__grid' d='M0 200H1200M0 400H1200M0 600H1200' />
        <g className='dashboard-backdrop__up'>
            <path d='M30 644v20M90 616v42M150 563v69M210 526v76M270 527v29M510 532v62M570 504v55M630 480v50M690 466v40M930 433v91M990 346v105M1050 268v106M1110 197v93M1170 122v113' />
            <path
                className='dashboard-backdrop__body'
                d='M30 650v4M90 624v26M150 585v39M210 544v41M270 544v4M510 547v35M570 514v33M630 489v26M690 477v12M930 443v74M990 366v77M1050 282v84M1110 217v65M1170 142v75'
            />
        </g>
        <g className='dashboard-backdrop__down'>
            <path d='M330 522v56M390 539v49M450 559v41M750 464v32M810 466v59M870 509v14' />
            <path
                className='dashboard-backdrop__body'
                d='M330 544v13M390 557v20M450 577v6M750 477v9M810 486v31M870 516v4'
            />
        </g>
        <path
            className='dashboard-backdrop__line'
            d='M30 650L90 624L150 585L210 544L270 544L330 557L390 577L450 582L510 547L570 514L630 489L690 477L750 486L810 516L870 517L930 443L990 366L1050 282L1110 217L1170 142'
        />
    </svg>
);

export default MarketBackdrop;
