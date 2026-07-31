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
        // Same shape as accent: DEFAULT is the text-safe hue for tinted chips;
        // `fg` is the label on a SOLID fill. The fg values are measured to clear
        // AA against each fill in both themes — white does not (see globals.css).
        success: { DEFAULT: hsl('--success-text'), fg: hsl('--success-fg') },
        warning: { DEFAULT: hsl('--warning-text'), fg: hsl('--warning-fg') },
        danger: { DEFAULT: hsl('--danger-text'), fg: hsl('--danger-fg') },
      },
      borderColor: { DEFAULT: hsl('--border-subtle') },
      ringOffsetColor: { canvas: hsl('--canvas') },
      borderRadius: {
        md: 'calc(var(--radius) - 2px)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) + 4px)',
      },
      boxShadow: {
        // Resting elevation for cards — soft and low, so white cards float on
        // the grey canvas (light) and read as raised (dark). This is the shift
        // from the old dead-flat look toward the shadcn block gallery.
        card: '0 1px 2px -1px hsl(240 10% 10% / 0.08), 0 4px 12px -3px hsl(240 10% 10% / 0.10)',
        // Hover / emphasis lift.
        elevated: '0 2px 4px -2px hsl(240 10% 10% / 0.10), 0 10px 24px -6px hsl(240 10% 10% / 0.16)',
        // Floating layers (menus, dialogs, popovers).
        popover: '0 8px 24px -6px hsl(240 10% 10% / 0.12), 0 2px 6px -2px hsl(240 10% 10% / 0.08)',
      },
      fontSize: {
        // THE product type scale. Compact, but one step up from where it was:
        // at 13px body on a 1440px-and-wider desktop the whole app read as if
        // it had been zoomed to 80%.
        //
        // Every size in app/ and components/ must come from this scale. The UI
        // used to be ~1000 arbitrary `text-[13px]` values, which meant the scale
        // could not be changed at all without a thousand-line diff — that is the
        // actual reason it stayed too small. Adjust density HERE now.
        //
        // Leading is deliberately loose (~1.5). Line-height is what makes a dense
        // app feel calm rather than stacked, and it costs no layout work because
        // the sizes themselves do not move.
        '3xs': ['12px', '18px'],   // legal/footnote only — not for UI labels
        '2xs': ['13px', '20px'],   // meta lines, table sub-values, counts
        xs: ['14px', '22px'],      // secondary labels, filter chips
        sm: ['15px', '24px'],      // DEFAULT UI text: rows, inputs, buttons, nav
        base: ['16px', '26px'],    // section titles, emphasised body
        md: ['18px', '28px'],      // page titles
        // The one display size the product UI owns: a KPI figure. Named rather
        // than written as text-[26px] so it moves with the rest of the scale.
        stat: ['30px', '38px'],
        // lg and up keep Tailwind's defaults — those are marketing display sizes.
      },
    },
  },
  // tailwindcss-animate gives the enter/exit utilities (animate-in, fade-in-0,
  // zoom-in-95, slide-in-from-*) that the Radix-based shadcn primitives use for
  // their open/close transitions. Additive — no existing utility changes.
  plugins: [require('tailwindcss-animate')],
};
