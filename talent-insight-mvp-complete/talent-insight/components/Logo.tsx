import React from 'react';

interface LogoProps {
    className?: string;
    iconOnly?: boolean;
    dark?: boolean;
}

/**
 * hirebtr.com Logo Component
 * Renders the custom pixelated arrow icon and brand text.
 */
const Logo: React.FC<LogoProps> = ({ className = '', iconOnly = false, dark = false }) => {
    return (
        <div className={`flex items-center gap-3 ${className}`}>
            {/* Precision-recreated Pixelated Arrow SVG from user attachment */}
            <svg
                width="40"
                height="40"
                viewBox="0 0 100 100"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="flex-shrink-0"
            >
                {/* The specific color from the user's PNG is a vibrant indigo/blue */}
                <g fill="#4F46E5">
                    {/* Top tail */}
                    <rect x="10" y="10" width="20" height="20" />
                    <rect x="30" y="20" width="20" height="20" />
                    <rect x="50" y="30" width="20" height="20" />

                    {/* Middle tip */}
                    <rect x="70" y="40" width="20" height="20" />

                    {/* Bottom tail */}
                    <rect x="50" y="50" width="20" height="20" />
                    <rect x="30" y="60" width="20" height="20" />
                    <rect x="10" y="70" width="20" height="20" />
                </g>
            </svg>

            {!iconOnly && (
                <span className={`text-2xl font-black tracking-tighter ${dark ? 'text-white' : 'text-gray-900'}`}>
                    hirebtr<span className="text-primary-600">.com</span>
                </span>
            )}
        </div>
    );
};

export default Logo;
