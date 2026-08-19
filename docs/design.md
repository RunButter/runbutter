# The design spec

**Marketing → Design.** Describe your brand once, in a shape a machine can apply
exactly, and every AI agent in the workspace stops guessing at it.

The advice "write a `DESIGN.md` and your AI will stay on brand" is good and
almost nobody follows it, because writing one means retyping values out of a PDF
into a format you are guessing at, with no way to tell whether it worked. Both
halves of that are fixable.

> **There is a free version at [runbutter.app/brand](https://runbutter.app/brand)** —
> no account, nothing uploaded, the same studio. What the signed-in screen adds is
> storing the spec in your workspace and publishing it as a skill your agents carry.

## Why a brand needs two layers

Nearly every hand-written `DESIGN.md` is only the second one, which is why they
"need tinkering":

1. **Deterministic** — hex codes, font names, a numeric scale, file names.
   A model must never guess these and a human must never retype them.
2. **Judgement** — what each colour is *for*, how the voice sounds, and the
   explicit list of things you never do. Prose is exactly right for this and
   exactly wrong for a hex code.

Hand a model a brand PDF on its own and it re-derives the brand on every run.
The accent is `#6366F1` today and "indigo-ish" tomorrow. The exported file
therefore puts the values in a fenced JSON block near the top, to be lifted
verbatim, with the judgement underneath in prose.

## Reading a brand out of what you already have

Everything happens in your browser. Nothing is uploaded — a brand book is
usually confidential before a launch and often under NDA, the same rule the PDF
tools and the QR generator follow.

**Upload your logo.** The colours come out of the pixels exactly. Not a
quantised approximation: buckets are used only to *group*, and each group
reports its most common exact colour, so a flat `#0A2540` comes back as
`#0A2540` rather than as something eight points away from it. An SVG is read as
text first — `fill="#0A2540"` is the value your designer typed, while a rendered
pixel has been through anti-aliasing and a colour profile.

**Upload your guidelines.** A PDF, Markdown or plain text gives up:

| What | How |
|---|---|
| Colours | Every hex and `rgb()`, with the label that sits before it on the line |
| Fonts | Matched against a list of real families, never captured from prose |
| Sizes and radii | `16px`, `44pt`, "corner radius of 10px" |
| Rules | Sentences containing *never*, *do not*, *avoid* — and *always*, *must* |

Two deliberate refusals:

- **Pantone and CMYK are named, never converted.** Pantone is a licensed system
  with no free lookup table and CMYK depends on the paper and the press. A hex
  derived from either would be an invented number.
- **Font names come from a whitelist.** "Typeface: our house sans, set in…"
  reads as a font name to any regex that trusts capitalisation, and an invented
  font name in a file whose whole purpose is to be believed literally is worse
  than no font name at all.

Nothing is applied without a click. A logo's biggest colour is usually the brand
colour and sometimes it is the drop shadow; a `#` in a PDF is usually a swatch
and sometimes it is a page reference. Everything found is shown with the context
it was found in, and you tick what is right.

## The preview

Nine hex swatches in a row always look fine. The same nine become a button whose
label cannot be read, a "surface" indistinguishable from the page, and a warning
colour that reads as decoration — and none of that is visible until something
real is drawn with them.

So the preview draws the two things anybody actually makes — a marketing page
and a product screen — plus a type specimen at real sizes and a **WCAG contrast
table**. The contrast figures are the same arithmetic an auditor runs: 4.5 for
body text (AA), 7 for AAA, 3 for large text.

A font you have named but do not have installed is reported as missing rather
than silently rendered as Helvetica. Loading it from Google Fonts is a tick box,
off by default, because it is a request to somebody else's server.

## What you get

Four files, four readers, one source — so they cannot disagree with each other.

| File | Who reads it | What to do with it |
|---|---|---|
| `DESIGN.md` | a person, and an AI agent | Put it at the root of the repo or project folder. Claude Code, Cursor and Copilot pick it up. |
| `design.json` | scripts and build steps | The exact values, nothing else. |
| `tokens.css` | the browser | Paste into your stylesheet. Everything is a `--brand-*` custom property. |
| `tailwind.tokens.js` | Tailwind | Merge into `theme.extend`. A fragment, not a whole config. |

The logo travels as bytes at `assets/`, never as a URL — a signed URL from the
files bucket expires within the hour, so a bundle carrying one is broken by the
time somebody opens it.

## Giving it to your agents

**Save as a skill** writes a skill called `design`, which every agent in the
workspace carries into its system prompt. "Write the launch email" and "draft
the invoice note" then come out in your colours and your words without being
told each time.

This is deliberately a separate button from **Save**. Save writes the document;
publishing changes what a scheduled agent is doing at three in the morning, and
editing a draft palette should not do that silently.

**Export as a plugin** produces the [Agent Plugins 1.0](https://agent-plugins.org)
layout — `skills/design/SKILL.md` with `design.json` beside it as a resource,
plus `DESIGN.md` at the root where a coding agent looks. It is a *skill* rather
than a new file type because the spec defines exactly one place instructions
live, and a design spec is a reusable instruction pack, which is the definition
of a skill.

## Where it is stored

One `jsonb` column on the workspace (migration `0125`). Settings → Branding is a
different thing and stays separate: that is the ten values an invoice renderer
reads, and this is the whole spec. The studio seeds itself from your branding
accent and logo the first time you open it; after that they are independent,
because renaming a colour role must not repaint every invoice you have issued.

The whole document is written at once rather than merged field by field — the
only place in this schema that works that way. The arrays *are* the document, so
deleting the last "never" rule has to be possible.

## What it deliberately does not do

- **No score.** The studio lists what is missing, in the order worth fixing. A
  brand is not 78% done.
- **No generated brand.** It will not invent a palette from a description. The
  values come out of your files or out of your head.
- **No hosted conversion.** Same rule as `/pdf` and `/qr`: your logo and your
  unreleased brand book stay in your browser.
