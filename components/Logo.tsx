import React from 'react';

interface LogoProps {
    className?: string;
    iconOnly?: boolean;
    /** On a dark background: wordmark goes white. */
    dark?: boolean;
    /** Reserved for callers that want a grayscale mark (e.g. print). Default
     *  shows the brand's yellow butter — the one hit of colour on an otherwise
     *  monochrome surface. */
    mono?: boolean;
}

/**
 * RunButter logo: the butter-stick mark (public/logo.svg) + wordmark.
 * The mark stays brand-yellow everywhere; the wordmark follows the theme
 * so the whole thing reads in both light and dark.
 */
const Logo: React.FC<LogoProps> = ({ className = '', iconOnly = false, dark = false, mono = false }) => {
    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <img
                src="/logo.svg"
                alt="RunButter"
                width={26}
                height={26}
                className={`w-[26px] h-[26px] shrink-0 ${mono ? 'grayscale' : ''}`}
            />
            {!iconOnly && (
                <span className={`text-lg font-semibold tracking-tight ${dark ? 'text-white' : 'text-primary'}`}>
                    runbutter<span className="text-tertiary">.app</span>
                </span>
            )}
        </div>
    );
};

export default Logo;
