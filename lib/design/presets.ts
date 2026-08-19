/**
 * Ready-made styles: the fastest honest way to a good DESIGN.md.
 *
 * ── A BLANK SPEC IS THE HARDEST VERSION OF THIS TASK ────────────────────────
 * Nobody sits down and types nine colour roles, six type levels with tracking,
 * and a shadow scale. They start from something that already works and change
 * what is wrong with it — which is what a designer does with a moodboard and
 * what the skills editor learned when it stopped opening an empty box.
 *
 * ── THEY ARE ALSO THE GALLERY, AND THAT IS DELIBERATE ───────────────────────
 * The same array renders the "start from" picker inside the tool and the public
 * style gallery. Two lists drift, and the public one is always the one nobody
 * remembers to update. So improving a preset improves the gallery, the picker
 * and the exported file at once — the rule `lib/workspace/templates.ts` follows
 * for the AI builder's few-shot examples.
 *
 * ── EVERY ONE IS A REAL, COMPLETE SPEC ──────────────────────────────────────
 * Full type levels with weights and tracking, a shadow scale or an explicit
 * statement that there isn't one, components, voice and a don't-list. A preset
 * that only fills in colours would teach people that a DESIGN.md is a palette,
 * which is exactly the misunderstanding that makes hand-written ones useless.
 *
 * Imports only lib/design/tokens.ts, which imports nothing.
 */

import type { ComponentSpec, DesignTokens, Shadow, Swatch, TypeLevel } from '@/lib/design/tokens';

export type PresetGroup = 'Product' | 'Marketing' | 'Editorial' | 'Studio';

export interface Preset {
  id: string;
  /** The style's own name, as a designer would say it. */
  label: string;
  group: PresetGroup;
  /** One line: what it is for and who it suits. */
  blurb: string;
  tokens: DesignTokens;
}

// ── A compact way to write one ──────────────────────────────────────────────

type C = [name: string, hex: string, use: string];
type L = [name: string, size: number, weight: number, lineHeight: number, tracking: string, use: string];
type E = [name: string, value: string, use: string];

function make(o: {
  name: string; tagline: string; description: string;
  heading: string; body: string; mono?: string;
  colors: C[]; levels: L[];
  base: number; space: number[]; radius: [string, number][];
  elevation: E[]; components: [string, Record<string, string>][];
  notes: DesignTokens['notes'];
  tone: string[]; weSay: string[]; weNeverSay: string[];
  do: string[]; dont: string[];
}): DesignTokens {
  return {
    brand: { name: o.name, tagline: o.tagline, description: o.description },
    colors: o.colors.map(([name, hex, use]): Swatch => ({ name, hex, use })),
    type: {
      heading: o.heading, body: o.body, mono: o.mono,
      levels: o.levels.map(([name, fontSize, fontWeight, lineHeight, letterSpacing, use]): TypeLevel =>
        ({ name, fontSize, fontWeight, lineHeight, letterSpacing: letterSpacing || undefined, use })),
    },
    space: { base: o.base, scale: o.space },
    radius: o.radius.map(([name, px]) => ({ name, px })),
    elevation: o.elevation.map(([name, value, use]): Shadow => ({ name, value, use })),
    components: o.components.map(([name, props]): ComponentSpec =>
      ({ name, props: Object.entries(props).map(([key, value]) => ({ key, value })) })),
    notes: o.notes,
    voice: { tone: o.tone, weSay: o.weSay, weNeverSay: o.weNeverSay },
    rules: { do: o.do, dont: o.dont },
  };
}

const NONE: E[] = [];

// ── The styles ──────────────────────────────────────────────────────────────

export const PRESETS: Preset[] = [
  {
    id: 'quiet-product', label: 'Quiet Product', group: 'Product',
    blurb: 'Restrained SaaS UI. Hierarchy from size and colour, almost never from weight.',
    tokens: make({
      name: 'Quiet Product', tagline: 'Software that gets out of the way.',
      description: 'A restrained interface style: near-black text on white, one accent, and space doing most of the work.',
      heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono',
      colors: [
        ['primary', '#4F46E5', 'The one thing on a screen you want clicked. Never two per view.'],
        ['on-primary', '#FFFFFF', 'Text and icons sitting on primary.'],
        ['foreground', '#0F1115', 'Body text and headings.'],
        ['muted', '#6B7280', 'Secondary text, captions, timestamps, placeholder.'],
        ['background', '#FFFFFF', 'The page.'],
        ['surface', '#F7F8FA', 'Cards, panels, anything lifted off the page.'],
        ['border', '#E5E7EB', 'Hairlines and dividers. Never for text.'],
        ['success', '#15803D', 'Paid, confirmed, done.'],
        ['warning', '#B45309', 'Needs attention, not yet wrong.'],
        ['danger', '#B91C1C', 'Destructive actions and real errors only.'],
      ],
      levels: [
        ['display', 56, 600, 1.02, '-0.03em', 'Hero headline. One per page, at most.'],
        ['h1', 32, 500, 1.15, '-0.02em', 'Page title.'],
        ['h2', 24, 500, 1.25, '-0.01em', 'Section heading.'],
        ['h3', 18, 500, 1.35, '', 'Card and panel titles.'],
        ['body-lg', 17, 400, 1.6, '', 'Intro paragraphs and marketing body.'],
        ['body-md', 15, 400, 1.55, '', 'Default UI text. Everything unless there is a reason.'],
        ['body-sm', 13, 400, 1.5, '', 'Dense tables, secondary rows.'],
        ['label', 12, 600, 1.2, '0.04em', 'Uppercase eyebrows, table headers, status chips.'],
        ['mono-md', 14, 400, 1.5, '', 'Numbers, ids, code. Tabular figures on.'],
      ],
      base: 4, space: [4, 8, 12, 16, 24, 32, 48, 64, 96],
      radius: [['sm', 6], ['md', 10], ['lg', 16], ['full', 9999]],
      elevation: [
        ['sm', '0 1px 2px rgb(15 17 21 / 0.06)', 'Raised inputs and buttons.'],
        ['md', '0 4px 12px rgb(15 17 21 / 0.08)', 'Cards and popovers.'],
        ['lg', '0 12px 32px rgb(15 17 21 / 0.12)', 'Modals and command palettes only.'],
      ],
      components: [
        ['button-primary', { backgroundColor: '{colors.primary}', textColor: '{colors.on-primary}', rounded: '{rounded.md}', padding: '10px 16px', typography: '{typography.body-md}' }],
        ['button-secondary', { backgroundColor: 'transparent', textColor: '{colors.foreground}', borderColor: '{colors.border}', rounded: '{rounded.md}', padding: '10px 16px' }],
        ['card', { backgroundColor: '{colors.surface}', borderColor: '{colors.border}', rounded: '{rounded.lg}', padding: '{spacing.lg}', shadow: 'sm' }],
        ['input', { backgroundColor: '{colors.background}', borderColor: '{colors.border}', rounded: '{rounded.md}', padding: '8px 12px', height: '36px' }],
      ],
      notes: {
        overview: 'Calm, dense and readable. Nothing decorative competes with the data on the screen.',
        colors: 'Nine roles, one accent. Status colours are for state, never for decoration — a green heading means nothing and spends a signal.',
        typography: 'Hierarchy comes from SIZE and COLOUR before weight. When every rank is bold, none of them is.',
        layout: 'A 4px grid. Reading columns cap around 72 characters; a paragraph at full window width is harder to read, not more generous.',
        elevation: 'Three levels and no more. Shadow means "this floats above the page", so a shadow on something that does not float is a lie.',
        shapes: 'One radius per element size: 6px on small controls, 10px on buttons and inputs, 16px on cards.',
        components: 'A secondary button is an outline, never a second filled colour — two filled buttons side by side make neither of them primary.',
      },
      tone: ['plain', 'direct', 'warm', 'never breathless'],
      weSay: ['Get started', 'Something went wrong', 'Save', 'Nothing here yet'],
      weNeverSay: ['Simply', 'Just', 'Effortlessly', 'Seamless', 'Revolutionary', 'Unlock'],
      do: [
        'Use one accent colour per screen. If two things are both primary, neither is.',
        'Leave more space than feels necessary, then leave a little more.',
        'Write the empty state before the full one.',
      ],
      dont: [
        'Never invent a colour that is not in the palette.',
        'Never use pure black (#000) for text.',
        'Never centre a paragraph longer than two lines.',
        'Never put a shadow on something that cannot move.',
      ],
    }),
  },

  {
    id: 'ink-and-paper', label: 'Ink & Paper', group: 'Editorial',
    blurb: 'Editorial and print-minded. Big serif display, generous measure, no shadows at all.',
    tokens: make({
      name: 'Ink & Paper', tagline: 'Words first.',
      description: 'An editorial style built on contrast and rhythm rather than colour: warm paper, true ink, one red.',
      heading: 'Playfair Display', body: 'Source Serif', mono: 'IBM Plex Mono',
      colors: [
        ['primary', '#B3242B', 'Rules, drop caps, the single accent on a spread.'],
        ['on-primary', '#FDFBF7', 'Text sitting on primary.'],
        ['foreground', '#16130F', 'Ink. Body text and headlines.'],
        ['muted', '#6E6459', 'Standfirsts, bylines, captions, folios.'],
        ['background', '#FDFBF7', 'Paper.'],
        ['surface', '#F4EFE6', 'Pull quotes and sidebars.'],
        ['border', '#DCD3C4', 'Hairline rules between sections.'],
      ],
      levels: [
        ['display', 72, 500, 0.98, '-0.02em', 'Cover line. One per issue.'],
        ['h1', 44, 500, 1.08, '-0.015em', 'Article headline.'],
        ['h2', 28, 500, 1.2, '', 'Section break within a piece.'],
        ['standfirst', 22, 400, 1.45, '', 'The paragraph under a headline. Always larger than body.'],
        ['body-md', 18, 400, 1.7, '', 'Running text. Long-form wants 17–19px and 1.6–1.75 leading.'],
        ['caption', 13, 400, 1.4, '', 'Picture captions and credits.'],
        ['byline', 12, 600, 1.2, '0.12em', 'Uppercase author lines and section labels.'],
      ],
      base: 8, space: [8, 16, 24, 32, 48, 72, 112, 160],
      radius: [['none', 0], ['sm', 2]],
      elevation: NONE,
      components: [
        ['rule', { borderColor: '{colors.border}', height: '1px' }],
        ['pull-quote', { backgroundColor: '{colors.surface}', textColor: '{colors.foreground}', typography: '{typography.standfirst}', padding: '{spacing.lg}' }],
        ['button-primary', { backgroundColor: '{colors.primary}', textColor: '{colors.on-primary}', rounded: '{rounded.none}', padding: '12px 20px' }],
      ],
      notes: {
        overview: 'Print habits on a screen: strong vertical rhythm, real hierarchy, and colour used once so that it counts.',
        colors: 'Two colours and a red. The red appears at most once per spread — a rule, a drop cap, or a link, never all three.',
        typography: 'The contrast between display and body IS the design. If they are close in size the page reads as a document rather than as an article.',
        layout: 'An 8px rhythm and a measure of 62–72 characters. Wider is not more generous; it is harder to read.',
        elevation: 'None, deliberately. Paper has no shadows; depth comes from rules, tone and white space.',
        shapes: 'Square. A rounded corner on an editorial page reads as an interface element and breaks the illusion.',
        components: 'A pull quote is set in the standfirst level, never in the display — a quote competing with the headline flattens the page.',
      },
      tone: ['considered', 'literate', 'unhurried', 'never salesy'],
      weSay: ['Read the piece', 'In this issue', 'Continue reading'],
      weNeverSay: ['Click here', 'Sign up now', 'Don’t miss out', 'Trending'],
      do: [
        'Set body text at 17–19px with 1.6–1.75 line height.',
        'Use one accent per spread and let it be the only colour.',
        'Break long text with subheads every 300–400 words.',
      ],
      dont: [
        'Never justify text on the web — the ragged right edge is the lesser evil.',
        'Never set display type below 32px; it stops being display.',
        'Never add a shadow. This style has none.',
      ],
    }),
  },

  {
    id: 'hard-edge', label: 'Hard Edge', group: 'Marketing',
    blurb: 'Neo-brutalist landing pages. Thick borders, offset shadows, one loud colour.',
    tokens: make({
      name: 'Hard Edge', tagline: 'Say it loudly, say it once.',
      description: 'Flat colour, 2px borders and hard offset shadows. Built for landing pages that have to be remembered.',
      heading: 'Space Grotesk', body: 'Inter', mono: 'Space Mono',
      colors: [
        ['primary', '#FFE14D', 'Big flat fills, hero panels, the thing you want remembered.'],
        ['on-primary', '#111111', 'Text on primary. Always the ink, never white.'],
        ['secondary', '#2F5BFF', 'The second accent. One per section, never beside primary.'],
        ['foreground', '#111111', 'Text and every border.'],
        ['muted', '#5A5A5A', 'Sub-copy and captions.'],
        ['background', '#FFFDF5', 'The page. Warm, never pure white.'],
        ['surface', '#FFFFFF', 'Cards sitting on the page.'],
        ['border', '#111111', 'Every border. Full-strength ink, 2px.'],
      ],
      levels: [
        ['display', 88, 700, 0.92, '-0.04em', 'The one line above the fold.'],
        ['h1', 48, 700, 1.0, '-0.03em', 'Section openers.'],
        ['h2', 30, 700, 1.1, '-0.02em', 'Card and feature titles.'],
        ['body-lg', 19, 400, 1.55, '', 'The paragraph under a headline.'],
        ['body-md', 16, 400, 1.55, '', 'Everything else.'],
        ['label', 13, 700, 1, '0.08em', 'Uppercase eyebrows and buttons.'],
      ],
      base: 8, space: [8, 16, 24, 40, 64, 96, 144],
      radius: [['none', 0], ['sm', 4]],
      elevation: [
        ['hard', '4px 4px 0 {colors.foreground}', 'Default card and button. The shadow is a solid offset, never a blur.'],
        ['hard-lg', '8px 8px 0 {colors.foreground}', 'Hero panels and the primary call to action.'],
      ],
      components: [
        ['button-primary', { backgroundColor: '{colors.primary}', textColor: '{colors.on-primary}', borderColor: '{colors.border}', borderWidth: '2px', rounded: '{rounded.none}', shadow: 'hard', padding: '14px 24px', typography: '{typography.label}' }],
        ['card', { backgroundColor: '{colors.surface}', borderColor: '{colors.border}', borderWidth: '2px', rounded: '{rounded.none}', shadow: 'hard', padding: '{spacing.lg}' }],
        ['badge', { backgroundColor: '{colors.secondary}', textColor: '{colors.surface}', borderColor: '{colors.border}', borderWidth: '2px', padding: '4px 10px' }],
      ],
      notes: {
        overview: 'Loud, flat and confident. Everything is outlined in full-strength ink and nothing is subtle — which only works if the page says one thing.',
        colors: 'Two accents that never touch. Primary owns the hero, secondary owns one section further down, and the ink does all the structure.',
        typography: 'Display type is the artwork. Set it as large as the viewport allows and tighten the tracking as it grows.',
        layout: 'Big, uneven blocks on an 8px grid. Symmetry makes this style look like a template.',
        elevation: 'Offset solid shadows, never blurred. A blur here reads as a mistake rather than a style.',
        shapes: 'Square, with 4px as the absolute maximum anywhere.',
        components: 'Every interactive element carries the same 2px border and 4px offset. Consistency is what stops this reading as chaos.',
      },
      tone: ['blunt', 'confident', 'funny when it earns it', 'never corporate'],
      weSay: ['Try it', 'No account needed', 'Here is the catch'],
      weNeverSay: ['Enterprise-grade', 'Best-in-class', 'Leverage', 'Solutions'],
      do: [
        'Put one idea above the fold and cut the second one.',
        'Keep every border at exactly 2px, everywhere.',
        'Let the display type run to the edge of the container.',
      ],
      dont: [
        'Never blur a shadow — the offset is solid ink.',
        'Never put primary and secondary in the same section.',
        'Never round a corner past 4px.',
      ],
    }),
  },

  {
    id: 'warm-studio', label: 'Warm Studio', group: 'Studio',
    blurb: 'Portfolios and creative studios. Cream, clay and a lot of air.',
    tokens: make({
      name: 'Warm Studio', tagline: 'Made by hand, mostly.',
      description: 'A soft, warm identity for studios and portfolios: cream ground, clay accent, oversized quiet type.',
      heading: 'Fraunces', body: 'Work Sans', mono: 'IBM Plex Mono',
      colors: [
        ['primary', '#C4633F', 'Links, small marks, the one warm accent.'],
        ['on-primary', '#FFF9F2', 'Text on primary.'],
        ['foreground', '#241F1B', 'Text.'],
        ['muted', '#7C7168', 'Captions, dates, project metadata.'],
        ['background', '#FBF6EF', 'The page. Cream, never white.'],
        ['surface', '#F3EAE0', 'Image mats and quiet panels.'],
        ['border', '#E2D6C8', 'Hairlines only.'],
      ],
      levels: [
        ['display', 64, 400, 1.05, '-0.02em', 'Studio name or project title.'],
        ['h1', 36, 400, 1.15, '-0.01em', 'Page titles. Light weight on purpose.'],
        ['h2', 22, 500, 1.3, '', 'Project headings.'],
        ['body-lg', 18, 400, 1.7, '', 'About text and project descriptions.'],
        ['body-md', 16, 400, 1.65, '', 'Everything else.'],
        ['meta', 13, 400, 1.4, '0.06em', 'Uppercase dates, roles, client names.'],
      ],
      base: 8, space: [8, 16, 24, 40, 64, 96, 160, 240],
      radius: [['none', 0], ['sm', 3], ['lg', 20]],
      elevation: NONE,
      components: [
        ['button-primary', { backgroundColor: 'transparent', textColor: '{colors.primary}', borderColor: '{colors.primary}', rounded: '{rounded.lg}', padding: '10px 20px' }],
        ['image-mat', { backgroundColor: '{colors.surface}', rounded: '{rounded.sm}', padding: '{spacing.lg}' }],
      ],
      notes: {
        overview: 'Quiet and warm. The work is the loudest thing on the page and the interface is barely there.',
        colors: 'Cream, ink and clay. Warmth comes from the ground colour, not from a bright accent — a saturated hero here would fight the photography.',
        typography: 'Display type is LIGHT and large, which is the opposite of most product design and the whole character of this style.',
        layout: 'Enormous vertical gaps — 96 to 240px between sections. The space is the design.',
        elevation: 'None. Images sit on mats; nothing floats.',
        shapes: 'Square images, softly rounded controls. The contrast between the two is deliberate.',
        components: 'Buttons are outlines. A filled button on a portfolio pulls attention away from the work.',
      },
      tone: ['understated', 'personal', 'specific', 'never grandiose'],
      weSay: ['Selected work', 'Say hello', 'Currently taking projects'],
      weNeverSay: ['Award-winning', 'Passionate', 'Creative solutions', 'Synergy'],
      do: [
        'Give every section at least 96px of air above and below.',
        'Set display type at 300–400 weight, never bold.',
        'Name the client, the year and your actual role.',
      ],
      dont: [
        'Never put a shadow under an image.',
        'Never use pure white or pure black anywhere.',
        'Never let the interface be more interesting than the work.',
      ],
    }),
  },

  {
    id: 'midnight-console', label: 'Midnight Console', group: 'Product',
    blurb: 'Dark-first developer tools. Mono numerals, low chroma, one signal green.',
    tokens: make({
      name: 'Midnight Console', tagline: 'Built for people who read logs.',
      description: 'A dark-first interface for technical products: near-black ground, low-chroma text, and colour reserved for state.',
      heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono',
      colors: [
        ['primary', '#3DD68C', 'Primary action, and success. The only bright thing on screen.'],
        ['on-primary', '#05140D', 'Text on primary.'],
        ['foreground', '#E6E8EB', 'Body text. Never pure white — it vibrates on black.'],
        ['muted', '#8B939E', 'Secondary text, timestamps, inactive tabs.'],
        ['background', '#0B0D10', 'The application ground.'],
        ['surface', '#14171C', 'Panels, cards, the editor gutter.'],
        ['border', '#242A32', 'Every divider.'],
        ['warning', '#E2A33C', 'Degraded, retrying, deprecated.'],
        ['danger', '#F2555A', 'Failures and destructive actions.'],
      ],
      levels: [
        ['h1', 26, 500, 1.2, '-0.01em', 'Page title.'],
        ['h2', 18, 500, 1.3, '', 'Panel headings.'],
        ['body-md', 14, 400, 1.55, '', 'Default UI text.'],
        ['body-sm', 12.5, 400, 1.5, '', 'Dense tables and side panels.'],
        ['mono-md', 13, 400, 1.6, '', 'Logs, ids, code, every number.'],
        ['mono-sm', 11.5, 400, 1.55, '', 'Stack traces and inline metadata.'],
        ['label', 11, 600, 1.2, '0.06em', 'Uppercase column headers and chips.'],
      ],
      base: 4, space: [4, 8, 12, 16, 24, 32, 48],
      radius: [['sm', 4], ['md', 6], ['lg', 10]],
      elevation: [
        ['md', '0 8px 24px rgb(0 0 0 / 0.45)', 'Popovers and menus.'],
        ['lg', '0 24px 64px rgb(0 0 0 / 0.6)', 'Modals only.'],
      ],
      components: [
        ['button-primary', { backgroundColor: '{colors.primary}', textColor: '{colors.on-primary}', rounded: '{rounded.md}', padding: '7px 14px', typography: '{typography.body-md}' }],
        ['button-ghost', { backgroundColor: 'transparent', textColor: '{colors.foreground}', borderColor: '{colors.border}', rounded: '{rounded.md}', padding: '7px 14px' }],
        ['card', { backgroundColor: '{colors.surface}', borderColor: '{colors.border}', rounded: '{rounded.lg}', padding: '{spacing.lg}' }],
        ['code-block', { backgroundColor: '{colors.background}', borderColor: '{colors.border}', rounded: '{rounded.sm}', typography: '{typography.mono-sm}', padding: '{spacing.md}' }],
      ],
      notes: {
        overview: 'Dark-first, dense and unemotional. Every colour on the screen means a state, which is what makes a red one impossible to miss.',
        colors: 'Foreground is #E6E8EB rather than white: pure white on near-black vibrates and is measurably harder to read for long sessions.',
        typography: 'Numbers are always mono with tabular figures, so columns of them line up and a changing value does not reflow its row.',
        layout: 'A 4px grid and tight density. This is a tool people keep open all day; every wasted row is a row of logs they cannot see.',
        elevation: 'Shadows are deep and dark rather than soft — on a dark ground a light shadow is invisible and a soft one looks like a smudge.',
        shapes: 'Small radii throughout. Large ones make a technical interface look like a consumer app.',
        components: 'Exactly one primary button per view. Everything else is a ghost with a border.',
      },
      tone: ['precise', 'terse', 'never chatty', 'no exclamation marks'],
      weSay: ['Failed after 3 retries', 'Connected', 'No results for that query'],
      weNeverSay: ['Oops!', 'Something went wrong', 'Great news!', 'Magic'],
      do: [
        'Use mono with tabular figures for every number.',
        'Say what failed and what to do next, in that order.',
        'Keep row height at 32px or below in tables.',
      ],
      dont: [
        'Never use pure white text on the dark ground.',
        'Never use colour decoratively — every colour means a state.',
        'Never write an error message that does not name the thing that failed.',
      ],
    }),
  },

  {
    id: 'soft-pop', label: 'Soft Pop', group: 'Marketing',
    blurb: 'Friendly consumer apps. Rounded, pastel, generous — without going childish.',
    tokens: make({
      name: 'Soft Pop', tagline: 'Nice to use, on purpose.',
      description: 'A friendly consumer style: rounded shapes, pastel surfaces, and one saturated accent doing all the pointing.',
      heading: 'Poppins', body: 'DM Sans', mono: 'DM Mono',
      colors: [
        ['primary', '#6D5AE6', 'Primary actions and active states.'],
        ['on-primary', '#FFFFFF', 'Text on primary.'],
        ['accent', '#FF8A65', 'Highlights, illustrations, one detail per screen.'],
        ['foreground', '#1E1B2E', 'Text.'],
        ['muted', '#6F6A85', 'Secondary text and helper copy.'],
        ['background', '#FCFBFF', 'The page.'],
        ['surface', '#F2EFFC', 'Cards and grouped sections.'],
        ['border', '#E4DFF5', 'Soft dividers.'],
        ['success', '#2E9E6B', 'Done and confirmed.'],
        ['danger', '#E04F5F', 'Errors and destructive actions.'],
      ],
      levels: [
        ['display', 52, 600, 1.08, '-0.02em', 'Hero headline.'],
        ['h1', 30, 600, 1.2, '-0.01em', 'Screen titles.'],
        ['h2', 20, 600, 1.3, '', 'Card titles.'],
        ['body-lg', 17, 400, 1.6, '', 'Onboarding and marketing copy.'],
        ['body-md', 15, 400, 1.6, '', 'Default text.'],
        ['label', 13, 600, 1.2, '0.01em', 'Buttons and tabs.'],
      ],
      base: 4, space: [4, 8, 12, 20, 32, 48, 72],
      radius: [['sm', 10], ['md', 16], ['lg', 24], ['full', 9999]],
      elevation: [
        ['sm', '0 2px 8px rgb(109 90 230 / 0.08)', 'Buttons and inputs at rest.'],
        ['md', '0 8px 24px rgb(109 90 230 / 0.12)', 'Cards and sheets. The shadow is tinted with the accent, never grey.'],
      ],
      components: [
        ['button-primary', { backgroundColor: '{colors.primary}', textColor: '{colors.on-primary}', rounded: '{rounded.full}', padding: '12px 22px', shadow: 'sm', typography: '{typography.label}' }],
        ['card', { backgroundColor: '{colors.surface}', rounded: '{rounded.lg}', padding: '{spacing.lg}', shadow: 'md' }],
        ['input', { backgroundColor: '{colors.background}', borderColor: '{colors.border}', rounded: '{rounded.md}', padding: '12px 16px', height: '44px' }],
      ],
      notes: {
        overview: 'Warm and approachable without tipping into childish. The rounding and the tinted shadows carry the friendliness so the copy does not have to.',
        colors: 'Purple points, coral decorates. If both appear in one component the eye stops knowing what to press.',
        typography: 'Everything is a little larger than a desktop app would use — this style assumes a phone in one hand.',
        layout: 'Tap targets are 44px minimum and never share an edge. Comfort is the whole point of the style.',
        elevation: 'Shadows are TINTED with the primary hue rather than grey, which is most of why this style reads as soft.',
        shapes: 'Generous radii: pills for buttons, 24px for cards. Nothing square anywhere.',
        components: 'Buttons are fully rounded pills. A square button in this system looks broken.',
      },
      tone: ['friendly', 'encouraging', 'clear', 'never patronising'],
      weSay: ['You are all set', 'Let us fix that', 'Nothing here yet — add your first one'],
      weNeverSay: ['Error', 'Invalid', 'Utilize', 'Please be advised'],
      do: [
        'Keep every tap target at 44px or larger.',
        'Tint shadows with the primary hue instead of using grey.',
        'Say what to do next in every empty state.',
      ],
      dont: [
        'Never use a square corner.',
        'Never put the accent and the primary in the same component.',
        'Never write an error that blames the person reading it.',
      ],
    }),
  },
];

export const PRESET_GROUPS: PresetGroup[] = ['Product', 'Marketing', 'Editorial', 'Studio'];

export const presetsByGroup = () =>
  PRESET_GROUPS.map((g) => ({ group: g, items: PRESETS.filter((p) => p.group === g) }))
    .filter((s) => s.items.length);

export const findPreset = (id: string) => PRESETS.find((p) => p.id === id);

/** A deep copy, because the editor mutates whatever it is handed. */
export const presetTokens = (p: Preset): DesignTokens => JSON.parse(JSON.stringify(p.tokens));

/**
 * The starting point for a workspace that has never had a spec.
 *
 * `Quiet Product` recoloured with whatever the workspace already branded itself
 * with, so the studio opens on something correct rather than something empty —
 * and on the accent somebody already chose rather than one we picked for them.
 */
export function starterTokens(name: string, accent: string): DesignTokens {
  const t = presetTokens(PRESETS[0]);
  t.brand.name = name || '';
  t.brand.tagline = undefined;
  t.brand.description = undefined;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent || '')) {
    const i = t.colors.findIndex((c) => c.name === 'primary');
    if (i >= 0) t.colors[i] = { ...t.colors[i], hex: accent.toUpperCase() };
  }
  return t;
}
