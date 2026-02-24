import React from 'react';

interface LogoContainerProps {
    src?: string | null;
    alt: string;
    className?: string;
}

/**
 * LogoContainer Component
 * Displays company logos with consistent sizing and constraints.
 * Max-width: 200px, Max-height: 80px, Object-fit: contain.
 */
const LogoContainer: React.FC<LogoContainerProps> = ({ src, alt, className = '' }) => {
    if (!src) return null;

    return (
        <div className={`flex items-center justify-center overflow-hidden ${className}`} style={{ maxWidth: '200px', maxHeight: '80px' }}>
            <img
                src={src}
                alt={alt}
                className="w-full h-full object-contain"
            />
        </div>
    );
};

export default LogoContainer;
