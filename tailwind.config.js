/** @type {import('tailwindcss').Config} */

// Semantic tokens -> Tailwind utilities. Components should use THESE
// (bg-surface, text-secondary, border-subtle, bg-accent) rather than literal
// palette colors, so a theme change is a token change, not a per-file rewrite.
const hsl = (v) => `hsl(var(${v}) / <alpha-value>)`;

module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        canvas: hsl('--canvas'),
        surface: {
          DEFAULT: hsl('--surface'),
          hover: hsl('--surface-hover'),
          sunken: hsl('--surface-sunken'),
        },
        accent: {
          DEFAULT: hsl('--accent'),
          fg: hsl('--accent-fg'),
          soft: hsl('--accent-soft'),
        },
        inverse: {
          DEFAULT: hsl('--inverse'),
          fg: hsl('--inverse-fg'),
        },
        success: hsl('--success'),
        warning: hsl('--warning'),
        danger: hsl('--danger'),

        // Line colors. Declared as full colors (not just borderColor) so
        // dividers can use bg-subtle and rules can use border-subtle.
        subtle: hsl('--border-subtle'),
        strong: hsl('--border-strong'),

        // Kept so existing `primary-600` call sites keep compiling while pages
        // migrate onto the accent token. Do not use in new code.
        primary: {
          50: '#f5f7ff', 100: '#ebf0ff', 200: '#d6e0ff', 300: '#b3c5ff',
          400: '#8ca3ff', 500: '#6b82ff', 600: '#4f46e5', 700: '#4338ca',
          800: '#3730a3', 900: '#312e81',
        },
      },
      // text-* deliberately resolves to the text-safe variants: the same hue
      // that reads well as a fill is too light as small text. bg-*/border-*
      // still use the fill vars from `colors` above.
      textColor: {
        primary: hsl('--text-primary'),
        secondary: hsl('--text-secondary'),
        tertiary: hsl('--text-tertiary'),
        // keep the sub-keys (text-accent-fg is the label on an accent fill);
        // only the DEFAULT swaps to the text-safe variant.
        accent: { DEFAULT: hsl('--accent-text'), fg: hsl('--accent-fg'), soft: hsl('--accent-soft') },
        success: hsl('--success-text'),
        warning: hsl('--warning-text'),
        danger: hsl('--danger-text'),
      },
      borderColor: { DEFAULT: hsl('--border-subtle') },
      ringOffsetColor: { canvas: hsl('--canvas') },
      borderRadius: {
        md: 'calc(var(--radius) - 2px)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) + 4px)',
      },
      boxShadow: {
        // Only floating surfaces get elevation; panels stay flat.
        popover: '0 8px 24px -6px hsl(240 10% 10% / 0.12), 0 2px 6px -2px hsl(240 10% 10% / 0.08)',
      },
      fontSize: {
        // Compact product scale.
        '2xs': ['11px', '14px'],
        xs: ['12px', '16px'],
        sm: ['13px', '18px'],
        base: ['14px', '20px'],
      },
    },
  },
  plugins: [],
};
