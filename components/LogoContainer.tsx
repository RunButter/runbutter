import React from 'react';

interface LogoContainerProps {
    src?: string | null;
    alt: string;
    className?: string;
    width?: string;
    height?: string;
    showBorder?: boolean;
}

/**
 * LogoContainer Component
 * Displays company logos with consistent sizing and constraints.
 */
const LogoContainer: React.FC<LogoContainerProps> = ({
    src,
    alt,
    className = '',
    width = '200px',
    height = '80px',
    showBorder = false
}) => {
    if (!src) return null;

    return (
        <div
            className={`flex items-center justify-center overflow-hidden ${showBorder ? 'border border-gray-100 p-2 bg-white rounded-xl' : ''} ${className}`}
            style={{ maxWidth: width, maxHeight: height }}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={src}
                alt={alt}
                className="w-full h-full object-contain"
            />
        </div>
    );
};

export default LogoContainer;
