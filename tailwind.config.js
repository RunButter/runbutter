/** @type {import('tailwindcss').Config} */

// Semantic tokens -> Tailwind utilities. Components should use THESE
// (bg-surface, text-secondary, border-subtle, bg-accent) rather than literal
// palette colors, so a theme change is a token change, not a per-file rewrite.
const hsl = (v) => `hsl(var(${v}) / <alpha-value>)`;
// Glass: the colour's own alpha is multiplied by a per-scope variable. Outside
// the app shell the variable is unset (= 1) and these are ordinary opaque
// tokens; inside `.app-glass` (globals.css) the canvas goes clear and surfaces
// go translucent, so one class turns every card, table and dialog to glass.
const glass = (v, a) => `hsl(var(${v}) / calc(<alpha-value> * var(${a}, 1)))`;

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
        canvas: glass('--canvas', '--canvas-a'),
        surface: {
          DEFAULT: glass('--surface', '--surface-a'),
          hover: glass('--surface-hover', '--tint-a'),
          sunken: glass('--surface-sunken', '--tint-a'),
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
      // bg-secondary / bg-tertiary: a neutral FILL for status dots ("off",
      // "paused"). Ten components used them before they existed, so every grey
      // dot in the product rendered as nothing.
      backgroundColor: {
        secondary: hsl('--text-secondary'),
        tertiary: hsl('--text-tertiary'),
      },
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
      // Corner radius by ROLE, from Astryx's shape system (meta/astryx,
      // docs/design/shape-relationships.md). Each step is a job, not a size:
      //   rounded      4px  inner   — kbd, tiny chips, swatches inside a control
      //   rounded-md   8px  element — buttons, inputs, menu items, tags
      //   rounded-lg  10px  tile    — icon tiles, small nested panels
      //   rounded-xl  12px  container — cards, menus, popovers, tables
      //   rounded-2xl 16px  panel   — dialogs, sheets, large hero panels
      //   rounded-3xl 24px  page    — full-page regions
      // Before this the scale was one --radius of 16px with offsets, so
      // rounded-xl (20px) was ROUNDER than rounded-2xl (Tailwind's 16px) and a
      // button (14px) inside a card (20px) inside a dialog (16px) followed no
      // rule at all. Nested shapes are now concentric: inner = outer − padding
      // (a 12px menu with 4px padding holds 8px items).
      // Variables so a theme tunes the whole character in one place.
      borderRadius: {
        DEFAULT: 'var(--radius-inner)',
        md: 'var(--radius-element)',
        lg: 'var(--radius-tile)',
        xl: 'var(--radius-container)',
        '2xl': 'var(--radius-panel)',
        '3xl': 'var(--radius-page)',
      },
      // Astryx motion: one short duration and one decelerating curve for every
      // state change, so hover, press and open all feel like the same material.
      // DEFAULT is what a bare `transition` / `transition-colors` uses.
      transitionDuration: {
        DEFAULT: '175ms',
        fast: '175ms',
        medium: '410ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.24, 1, 0.4, 1)',
        standard: 'cubic-bezier(0.24, 1, 0.4, 1)',
        exit: 'cubic-bezier(0.3, 0, 0.6, 0.6)',
      },
      boxShadow: {
        // Resting elevation for cards — soft and low, so white cards float on
        // the grey canvas (light) and read as raised (dark). This is the shift
        // from the old dead-flat look toward the shadcn block gallery.
        // Defined as variables so the glass shell can add its rim highlight
        // (an inset white hairline on the top edge) without every card
        // carrying a second class.
        card: 'var(--shadow-card)',
        // Hover / emphasis lift.
        elevated: 'var(--shadow-elevated)',
        // Floating layers (menus, dialogs, popovers).
        popover: 'var(--shadow-popover)',
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
        // In REM, not px, and that is the point: the app shell raises the root
        // size (globals.css, `html:has(.app-glass)`), and text, spacing, icons
        // and controls all grow together — what a person got by zooming the
        // browser to 110%, which is what people were doing. In px the type
        // could not follow the rest. Values in comments are at the default 16px
        // root; the marketing site keeps that root and is unchanged.
        //
        // Leading is loose (~1.4–1.6) AND every line-height is a whole number
        // of 4px steps (0.25rem), Astryx's vertical rhythm: text rows, control
        // heights and the spacing scale then share one grid, so a label beside
        // a button beside a field lines up instead of landing 2px apart. It was
        // 18/22/26/38px before — the odd steps are what made stacked rows of
        // mixed sizes look slightly ragged.
        '3xs': ['0.75rem', '1rem'],       // 12px / 16 — legal/footnote only, not UI labels
        '2xs': ['0.8125rem', '1.25rem'],  // 13px / 20 — meta lines, table sub-values, counts
        xs: ['0.875rem', '1.25rem'],      // 14px / 20 — secondary labels, filter chips
        sm: ['0.9375rem', '1.5rem'],      // 15px / 24 — DEFAULT UI text: rows, inputs, buttons, nav
        base: ['1rem', '1.5rem'],         // 16px / 24 — section titles, emphasised body
        md: ['1.125rem', '1.75rem'],      // 18px / 28 — page titles
        // The one display size the product UI owns: a KPI figure. Named rather
        // than written as text-[26px] so it moves with the rest of the scale.
        stat: ['1.875rem', '2.25rem'],    // 30px / 36
        // lg and up keep Tailwind's defaults — those are marketing display sizes.
      },
    },
  },
  // tailwindcss-animate gives the enter/exit utilities (animate-in, fade-in-0,
  // zoom-in-95, slide-in-from-*) that the Radix-based shadcn primitives use for
  // their open/close transitions. Additive — no existing utility changes.
  plugins: [require('tailwindcss-animate')],
};
