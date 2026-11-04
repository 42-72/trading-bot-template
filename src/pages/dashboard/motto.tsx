import React from 'react';

// The owner's own words: never translated.
const QUOTE = "I've gotta be one of the greats";
const SIGNATURE = '— Cench';

// One weight of each font, cut down by Google to the letters shown here (a few
// KB). Added from here, not index.html: a stylesheet there would hold up the
// loading screen. Until it arrives the fallback fonts show (display=swap).
const FONTS_ID = 'ct-motto-fonts';
const FONTS_URL = `https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@1,500&family=Mr+Dafoe&display=swap&text=${encodeURIComponent(
    QUOTE + SIGNATURE
)}`;

const Motto = () => {
    React.useEffect(() => {
        if (document.getElementById(FONTS_ID)) return;
        const link = document.createElement('link');
        link.id = FONTS_ID;
        link.rel = 'stylesheet';
        link.href = FONTS_URL;
        document.head.appendChild(link);
    }, []);

    return (
        <figure className='dashboard-motto' translate='no'>
            <blockquote className='dashboard-motto__quote'>{QUOTE}</blockquote>
            <figcaption className='dashboard-motto__signature'>{SIGNATURE}</figcaption>
        </figure>
    );
};

export default Motto;
