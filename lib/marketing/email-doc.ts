/**
 * The visual email builder's document — EmailBuilder.js (MIT) as the renderer.
 *
 * ── WHY A DEPENDENCY HERE, WHEN THE RULE IS USUALLY NOT TO ──────────────────
 * `newsletter-templates.ts` argues that a drag-and-drop builder is where mailing
 * tools go to die, because the fragile part is the HTML and a canvas means
 * maintaining nested-table markup against Outlook forever. That is still true —
 * and it is exactly the part `@usewaypoint/email-builder` has already done and
 * tests. Taking it means the composable half (blocks, styles, order) is ours to
 * design and the brittle half is not ours to maintain.
 *
 * It is **MIT** (verified against the LICENSE file, not the README badge), the
 * renderer ships separately from their MUI editor, and it pulls no UI library:
 * peer deps are react, react-dom and zod. That last one is why `package.json`
 * carries an override — the declared peer range is `^1 || ^2 || ^3` and this
 * repo already has zod 4 through Privy → walletconnect → abitype. The renderer
 * produces byte-identical output under both, which was checked before the
 * override was written rather than assumed.
 *
 * **Unlayer was the alternative and was rejected**: `react-email-editor` is MIT
 * for a ~200-line wrapper around a HOSTED editor that loads from unlayer.com and
 * wants an API key. That is a runtime dependency on somebody else's servers, it
 * breaks self-hosting outright, and it would put a workspace's unsent drafts
 * through a third party — the opposite of the rule that governs `/pdf`, `/qr`
 * and the plugin builder.
 *
 * ── WHAT WE STILL OWN ───────────────────────────────────────────────────────
 * Waypoint renders a whole `<html>` document and knows nothing about sending, so
 * the four things a send actually needs are grafted on here: the preheader, the
 * unsubscribe footer, the open pixel, and click tracking. Everything below is
 * that graft, and the reason it lives in one function is that the composer's
 * preview calls the same one — a preview that skips the footer is a preview of a
 * different email.
 */

import { renderToStaticMarkup as wpRender } from '@usewaypoint/email-builder';
import { esc, renderNewsletter, renderText, type RenderCtx } from './newsletter-templates';

/**
 * Waypoint's reader document: a flat map of id → block, plus a `root`
 * EmailLayout whose `childrenIds` give the order.
 *
 * FLAT AND ID-KEYED, not a tree, which is what makes reordering and moving a
 * block between columns a change to one array rather than a splice through
 * nested structures. Typed loosely on purpose — the shape is Waypoint's, it is
 * validated by their schema at render time, and mirroring their zod types by
 * hand here would be a second source of truth that drifts on their next release.
 */
export type EmailDoc = Record<string, { type: string; data?: any }>;

export const ROOT = 'root';

export type DocBlockType =
  | 'Heading' | 'Text' | 'Image' | 'Button' | 'Divider' | 'Spacer'
  | 'Avatar' | 'Html' | 'ColumnsContainer';

export const FONT_FAMILIES = [
  { v: 'MODERN_SANS', label: 'Modern sans' },
  { v: 'BOOK_SANS', label: 'Book sans' },
  { v: 'ORGANIC_SANS', label: 'Organic sans' },
  { v: 'GEOMETRIC_SANS', label: 'Geometric sans' },
  { v: 'HEAVY_SANS', label: 'Heavy sans' },
  { v: 'ROUNDED_SANS', label: 'Rounded sans' },
  { v: 'MODERN_SERIF', label: 'Modern serif' },
  { v: 'BOOK_SERIF', label: 'Book serif' },
  { v: 'MONOSPACE', label: 'Monospace' },
] as const;

const pad = (top: number, right: number, bottom: number, left: number) => ({ top, right, bottom, left });

/** A blank email: a canvas and nothing on it. */
export function emptyDoc(): EmailDoc {
  return {
    [ROOT]: {
      type: 'EmailLayout',
      data: {
        backdropColor: '#F5F5F5',
        canvasColor: '#FFFFFF',
        textColor: '#242424',
        fontFamily: 'MODERN_SANS',
        childrenIds: [],
      },
    },
  };
}

let seq = 0;
export const newBlockId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** A new block of each type, with defaults that look right without being touched. */
export function newDocBlock(type: DocBlockType): { type: string; data: any } {
  const style = { padding: pad(16, 24, 16, 24) };
  switch (type) {
    case 'Heading':
      return { type, data: { props: { text: 'A heading', level: 'h2' }, style: { ...style, textAlign: 'left' } } };
    case 'Text':
      // `markdown: true` is what makes a blank line a paragraph.
      //
      // Without it Waypoint renders the string into one div and every newline
      // collapses to a space — so the editor's own hint ("a blank line starts a
      // new paragraph") was false, and every multi-paragraph template arrived as
      // a wall. It also buys **bold**, _italic_ and [links](…) for free, and
      // links written this way are still click-tracked because the rewrite
      // happens on the rendered HTML rather than on the document.
      return { type, data: { props: { text: 'Write something here.', markdown: true }, style: { ...style, fontSize: 16, textAlign: 'left' } } };
    case 'Image':
      return { type, data: { props: { url: '', alt: '', contentAlignment: 'middle' }, style: { padding: pad(16, 24, 16, 24) } } };
    case 'Button':
      return { type, data: { props: { text: 'Click here', url: '', buttonStyle: 'rounded', buttonTextColor: '#FFFFFF', buttonBackgroundColor: '#4653CE', size: 'medium', fullWidth: false }, style: { ...style, textAlign: 'left' } } };
    case 'Divider':
      return { type, data: { props: { lineColor: '#E4E4E7', lineHeight: 1 }, style: { padding: pad(16, 24, 16, 24) } } };
    case 'Spacer':
      return { type, data: { props: { height: 24 } } };
    case 'Avatar':
      return { type, data: { props: { imageUrl: '', shape: 'circle', size: 64 }, style: { padding: pad(16, 24, 16, 24), textAlign: 'center' } } };
    case 'Html':
      return { type, data: { props: { contents: '' }, style: { ...style, fontSize: 16 } } };
    case 'ColumnsContainer':
      return {
        type,
        data: {
          props: { columnsCount: 2, columnsGap: 16, contentAlignment: 'top', columns: [{ childrenIds: [] }, { childrenIds: [] }] },
          style: { padding: pad(16, 24, 16, 24) },
        },
      };
    default:
      return { type, data: {} };
  }
}

export const DOC_BLOCK_META: { type: DocBlockType; name: string; hint: string }[] = [
  { type: 'Heading', name: 'Heading', hint: 'Starts a section' },
  { type: 'Text', name: 'Text', hint: 'Paragraphs' },
  { type: 'Image', name: 'Image', hint: 'A hosted image' },
  { type: 'Button', name: 'Button', hint: 'One clear action' },
  { type: 'ColumnsContainer', name: 'Columns', hint: 'Side by side, stacked on a phone' },
  { type: 'Avatar', name: 'Avatar', hint: 'A round or square photo' },
  { type: 'Divider', name: 'Divider', hint: 'A rule' },
  { type: 'Spacer', name: 'Spacer', hint: 'Breathing room' },
  { type: 'Html', name: 'Custom HTML', hint: 'Paste from another tool' },
];

// ── Reading and writing the document ────────────────────────────────────────

/** The root's ordered child ids, defensively. */
export const rootChildren = (doc: EmailDoc): string[] => {
  const ids = doc?.[ROOT]?.data?.childrenIds;
  return Array.isArray(ids) ? ids.filter((x) => typeof x === 'string' && doc[x]) : [];
};

export function setRootChildren(doc: EmailDoc, ids: string[]): EmailDoc {
  return { ...doc, [ROOT]: { ...doc[ROOT], data: { ...doc[ROOT]?.data, childrenIds: ids } } };
}

export function addBlock(doc: EmailDoc, type: DocBlockType, at?: number): { doc: EmailDoc; id: string } {
  const id = newBlockId();
  const ids = rootChildren(doc);
  const i = at === undefined ? ids.length : Math.max(0, Math.min(ids.length, at));
  const next = setRootChildren({ ...doc, [id]: newDocBlock(type) }, [...ids.slice(0, i), id, ...ids.slice(i)]);
  return { doc: next, id };
}

/**
 * Remove a block and everything it contained.
 *
 * A ColumnsContainer owns its children by id, so deleting only the container
 * would leave those blocks in the map forever — invisible, still counted
 * against the 512 KB content cap, and resurrected by anything that iterates the
 * document rather than the tree.
 */
export function removeBlock(doc: EmailDoc, id: string): EmailDoc {
  const doomed = new Set<string>([id]);
  const sweep = (bid: string) => {
    for (const col of doc[bid]?.data?.props?.columns ?? []) {
      for (const child of col?.childrenIds ?? []) { doomed.add(child); sweep(child); }
    }
  };
  sweep(id);
  const next: EmailDoc = {};
  for (const [k, v] of Object.entries(doc)) if (!doomed.has(k)) next[k] = v;
  return setRootChildren(next, rootChildren(next).filter((x) => !doomed.has(x)));
}

export function moveBlock(doc: EmailDoc, id: string, by: number): EmailDoc {
  const ids = rootChildren(doc);
  const i = ids.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= ids.length) return doc;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return setRootChildren(doc, next);
}

export function duplicateBlock(doc: EmailDoc, id: string): EmailDoc {
  const src = doc[id];
  if (!src) return doc;
  const copy = structuredClone(src);
  // A duplicated container must not share its children's ids with the original,
  // or editing one would edit both and deleting one would blank the other.
  const clone = (block: any, into: EmailDoc): string => {
    const nid = newBlockId();
    const b = structuredClone(block);
    for (const col of b?.data?.props?.columns ?? []) {
      col.childrenIds = (col.childrenIds ?? []).map((c: string) => (doc[c] ? clone(doc[c], into) : c));
    }
    into[nid] = b;
    return nid;
  };
  const additions: EmailDoc = {};
  const nid = clone(copy, additions);
  const ids = rootChildren(doc);
  const i = ids.indexOf(id);
  return setRootChildren({ ...doc, ...additions }, [...ids.slice(0, i + 1), nid, ...ids.slice(i + 1)]);
}

/** Patch one block's `props` or `style` without disturbing the other. */
export function patchBlock(doc: EmailDoc, id: string, part: 'props' | 'style', patch: any): EmailDoc {
  const b = doc[id];
  if (!b) return doc;
  return { ...doc, [id]: { ...b, data: { ...(b.data ?? {}), [part]: { ...(b.data?.[part] ?? {}), ...patch } } } };
}

/** Patch the canvas itself — colours and the base font. */
export const patchRoot = (doc: EmailDoc, patch: any): EmailDoc =>
  ({ ...doc, [ROOT]: { ...doc[ROOT], data: { ...(doc[ROOT]?.data ?? {}), ...patch } } });

/**
 * Coerce anything document-shaped into something renderable.
 *
 * `content` is free-form jsonb, so this runs on every read: an agent, an import
 * or a newer client may have written the row. Anything without a usable root
 * becomes an empty document rather than an exception — a composer that throws on
 * open is unrecoverable without a database edit.
 */
export function normalizeDoc(raw: any): EmailDoc {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyDoc();
  const root = raw[ROOT];
  if (!root || root.type !== 'EmailLayout') return emptyDoc();
  const out: EmailDoc = {};
  let n = 0;
  for (const [k, v] of Object.entries<any>(raw)) {
    if (!v || typeof v !== 'object' || typeof v.type !== 'string') continue;
    if (++n > 200) break;   // the cap that stops one row becoming an unbounded render
    // Text written before markdown was switched on would otherwise keep
    // rendering as one collapsed paragraph forever. Defaulting it on read fixes
    // existing drafts without a migration, and an explicit `false` is honoured.
    if (v.type === 'Text' && v.data?.props && v.data.props.markdown === undefined) {
      out[k] = { type: v.type, data: { ...v.data, props: { ...v.data.props, markdown: true } } };
      continue;
    }
    out[k] = { type: v.type, data: v.data ?? {} };
  }
  if (!out[ROOT]) return emptyDoc();
  return setRootChildren(out, rootChildren(out));
}

// ── Rendering ───────────────────────────────────────────────────────────────

/**
 * Rewrite every outbound link through the click tracker.
 *
 * Done on the rendered HTML rather than by walking the document, and that is
 * deliberate: a link can be in a Button's `url`, inside a Text block's markdown,
 * or inside a Custom HTML block, and only one of those three is reachable
 * structurally. Rewriting `href` after render catches all of them by
 * construction.
 *
 * Safe as a regex because this HTML is generated by the renderer above and every
 * value in it is already attribute-escaped — there is no quoting ambiguity to
 * get wrong. Only http(s) is touched, so `mailto:` and `tel:` are left alone.
 */
function trackLinks(html: string, track: (u: string) => string): string {
  return html.replace(/href="(https?:\/\/[^"]*)"/g, (_m, url) => `href="${esc(track(url))}"`);
}

/**
 * Strip what must not run, from a Custom HTML block.
 *
 * Waypoint's Html block inserts its contents verbatim. Every serious mail client
 * sanitises far harder than this, so the reason is US: that markup is rendered
 * in the composer's preview and can be read back by an agent, which makes
 * unfiltered markup stored XSS in our own product. The preview iframe is
 * `sandbox=""` as the other half of the pair.
 */
export function stripUnsafeHtml(raw: string): string {
  return String(raw || '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:href|src|xlink:href|action|formaction)\s*=\s*(?:"|')?\s*(?:javascript|data|vbscript)\s*:[^"'>\s]*(?:"|')?/gi, ' ')
    .slice(0, 100_000);
}

/** Every Html block sanitised, before it reaches the renderer or the preview. */
function sanitiseDoc(doc: EmailDoc): EmailDoc {
  let out = doc;
  for (const [id, b] of Object.entries(doc)) {
    if (b?.type !== 'Html') continue;
    const contents = b.data?.props?.contents;
    if (typeof contents !== 'string' || !contents) continue;
    const clean = stripUnsafeHtml(contents);
    if (clean !== contents) out = patchBlock(out, id, 'props', { contents: clean });
  }
  return out;
}

const MUTED = '#71717a';

/**
 * Is this backdrop dark enough that ink has to flip?
 *
 * The masthead and the footer are OUTSIDE the document — they are appended by
 * this renderer, so nothing in the block model tells them what they are sitting
 * on. They were hard-coded to the accent and to `MUTED`, which is right on the
 * eight light presets and wrong on the dark one: `#4653CE` on `#08080B` is
 * 2.5:1, and the wordmark — the first thing anyone looks at — was the least
 * readable text in the email. Relative luminance rather than a flag, because
 * the backdrop is a colour a person can pick and any list of "the dark ones"
 * goes stale the moment they do.
 */
function isDarkHex(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2] < 0.18;
}

/**
 * The `<head>` Waypoint does not emit, and the three things that go in it.
 *
 * Its output starts `<!DOCTYPE html><html><body>` — no head, no charset, no
 * viewport. Each omission is a real defect on a phone:
 *
 *   • NO VIEWPORT META means a mobile client is free to render the message at
 *     desktop width and zoom out, which is why a 600px email arrives looking
 *     like a shrunken page rather than a phone email.
 *   • NO CHARSET risks mojibake on any client that guesses latin-1, which is
 *     the same class of bug the QR encoder had.
 *   • NO STYLE BLOCK means no media query, and Waypoint's columns are plain
 *     `<td>` cells with no stacking rule — so a two-column layout stays two
 *     cramped columns on a 390px screen instead of becoming one.
 *
 * Gmail's Android app does strip `<style>` for some non-Gmail accounts, so the
 * media query is treated as an ENHANCEMENT: the un-styled result is the
 * side-by-side layout that already worked, not a broken one.
 */
const headInner = (backdrop: string) => `
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<style>
/* The BODY takes the backdrop too. Waypoint colours only its own wrapper div,
   so on a client that adds its own margin — or on any viewport taller than the
   message — the email sat on a white strip above and below itself, reading as
   three bands rather than one email. */
body{margin:0!important;padding:0!important;background:${backdrop}!important;}
@media only screen and (max-width:600px){
  /* Waypoint's columns are td cells. Forcing them to blocks is what stacks
     them; the width reset is what stops the last one keeping a 50% measure. */
  /* The ROW needs it too. A td set to display:block inside a tr that is still
     display:table-row gets wrapped in an anonymous table cell by the layout
     algorithm and lays out in a row anyway — which is exactly what happened,
     and why the class alone was not enough. Measured, not assumed. */
  .rb-row{display:block!important;width:100%!important}
  .rb-col{display:block!important;width:100%!important;max-width:100%!important;padding-left:0!important;padding-right:0!important;box-sizing:border-box!important}
  .rb-pad{padding-left:20px!important;padding-right:20px!important}
  /* 40px display type is right on a 600px canvas and too big on a 390px
     phone, where it costs four words a line. These are the same ratio, one
     step down. */
  .rb-h1{font-size:31px!important;line-height:1.1!important}
  .rb-h2{font-size:24px!important;line-height:1.2!important}
  .rb-hero{padding:40px 22px!important}
  .rb-num{font-size:22px!important}
}
</style>`;

/**
 * Tag the pieces the media query needs to reach.
 *
 * Done on the rendered HTML, for the same reason link tracking is: the classes
 * belong to markup Waypoint generates and there is no document field that says
 * "put a class here". Narrow, anchored replacements rather than a parser —
 * this is our own renderer's output, not arbitrary input.
 */
function makeResponsive(html: string): string {
  return html
    // Every column cell in a ColumnsContainer.
    .replace(/<td([^>]*?)style="([^"]*?width:50%[^"]*?)"/g, '<td$1class="rb-col" style="$2"')
    .replace(/<td([^>]*?)style="([^"]*?width:33\.33[^"]*?)"/g, '<td$1class="rb-col" style="$2"')
    // …and the row that holds them.
    .replace(/<tr([^>]*)>(\s*<td[^>]*class="rb-col")/g, '<tr$1 class="rb-row">$2');
}

/**
 * The typography Waypoint has no field for.
 *
 * ITS HEADING BLOCK EXPOSES NO FONT SIZE — `level` maps to a fixed 32/24/20px
 * with no line-height and no letter-spacing — and its TEXT BLOCK EXPOSES NO
 * LINE-HEIGHT, so body copy renders at the browser default of roughly 1.2.
 * Those two omissions are the ceiling on how good anything built here can look,
 * and no amount of work inside the document can lift it: 32px set at default
 * tracking is a heading, not display type, and 16px prose at 1.2 is a wall.
 *
 * So it is done here, on the rendered HTML, for the same reason link tracking
 * and the stacking classes are: there is no document field to carry it. Later
 * declarations in one style attribute win at equal specificity, so appending is
 * enough — and because these are INLINE, they survive the clients that strip
 * `<style>`, which is exactly where a media-query-only version would fail.
 *
 * The body rule fires only where there is a font size and NO line-height. Every
 * hand-written piece below sets its own, so this reaches Waypoint's own output
 * and leaves the designed blocks alone — checked by measuring computed styles in
 * a browser, not by reading the regex.
 */
function polishType(html: string): string {
  return html
    .replace(/<h1 style="([^"]*)"/g, (_m, s) =>
      `<h1 class="rb-h1" style="${s};font-size:40px;line-height:1.07;letter-spacing:-0.022em"`)
    .replace(/<h2 style="([^"]*)"/g, (_m, s) =>
      `<h2 class="rb-h2" style="${s};font-size:28px;line-height:1.16;letter-spacing:-0.016em"`)
    .replace(/<h3 style="([^"]*)"/g, (_m, s) =>
      `<h3 style="${s};font-size:19px;line-height:1.35;letter-spacing:-0.008em"`)
    .replace(/<div style="([^"]*font-size:[^"]*)"/g, (m, s) =>
      /line-height/.test(s) ? m : `<div style="${s};line-height:1.6"`);
}

/**
 * The masthead: the workspace's logo, or its name.
 *
 * It was MISSING from the builder entirely — the three fixed templates put it
 * in their shell and this path never had one, so every email built here went
 * out unbranded and the composer's preview showed an email nobody would
 * recognise as theirs. That is the first thing anybody notices and the last
 * thing anybody thinks to check.
 */
function masthead(ctx: RenderCtx, backdrop: string): string {
  const { brand } = ctx;
  const logo = brand.logoUrl && /^https?:\/\//i.test(brand.logoUrl) ? brand.logoUrl : null;
  // On a dark backdrop the accent is not a colour the wordmark can be. A logo
  // is left alone — it is the workspace's own file and we do not get to recolour it.
  const ink = isDarkHex(backdrop) ? '#FFFFFF' : (brand.accent || '#1F2024');
  const inner = logo
    ? `<img src="${esc(logo)}" alt="${esc(brand.name)}" height="28" style="height:28px;width:auto;max-width:180px;display:inline-block;border:0;">`
    : `<span style="font-size:17px;font-weight:700;letter-spacing:-0.01em;color:${esc(ink)};">${esc(brand.name)}</span>`;
  // Full-bleed and backdrop-coloured, so the masthead reads as part of the same
  // sheet of paper as the message rather than as a separate white strip.
  return `<table width="100%" role="presentation" cellspacing="0" cellpadding="0" border="0" style="background:${esc(backdrop)};">
  <tr><td align="center" style="padding:28px 24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${inner}</td></tr>
</table>`;
}

/**
 * The footer, matched to the canvas so it reads as part of the email.
 *
 * Not a Waypoint block: it must exist on every send whatever the document says,
 * and a block a person can delete is not that. The unsubscribe link is the one
 * legally load-bearing element in a bulk email.
 */
function footer(ctx: RenderCtx, backdrop: string): string {
  const { brand, unsubscribeUrl } = ctx;
  // Quiet, but never below 4.5:1 — the unsubscribe link is the one element here
  // that is legally load-bearing, and an unreadable one is not a working one.
  const quiet = isDarkHex(backdrop) ? '#9A9BA6' : MUTED;
  return `<table width="100%" role="presentation" cellspacing="0" cellpadding="0" border="0" style="background:${esc(backdrop)};">
  <tr><td align="center" style="padding:20px 24px 36px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <p style="margin:0;font-size:12px;line-height:18px;color:${quiet};text-align:center;max-width:600px;">
      ${brand.footer ? `${esc(brand.footer)}<br>` : ''}
      ${brand.address ? `${esc(brand.address)}<br>` : ''}
      <a href="${esc(unsubscribeUrl)}" style="color:${quiet};text-decoration:underline;">Unsubscribe</a>
    </p>
  </td></tr>
</table>`;
}

/**
 * One document → the email that actually gets sent.
 *
 * The composer's preview calls this too. A preview that skipped the footer or
 * the preheader would be a preview of a different email, which is the one thing
 * a preview must never be.
 */
export function renderEmailDoc(doc: EmailDoc, ctx: RenderCtx): string {
  const clean = sanitiseDoc(normalizeDoc(doc));
  let html: string;
  try {
    html = wpRender(clean as any, { rootBlockId: ROOT });
  } catch {
    // A document the schema refuses must not take the composer down with it.
    html = '<!DOCTYPE html><html><body></body></html>';
  }

  if (ctx.trackLink) html = trackLinks(html, ctx.trackLink);

  // The canvas colour the document chose, so the masthead, the footer and the
  // body all match the message instead of framing it in white.
  const backdrop = typeof clean[ROOT]?.data?.backdropColor === 'string'
    ? clean[ROOT].data.backdropColor : '#F4F4F6';

  const pre = ctx.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${esc(ctx.preheader)}</div>`
    : '';
  const pixel = ctx.openPixelUrl
    ? `<img src="${esc(ctx.openPixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;">`
    : '';

  // Inserted by string position rather than by parsing: the input is this
  // renderer's own output and its <body> is the first one in the document.
  html = polishType(makeResponsive(html));

  /**
   * The meta and the stylesheet, into whatever head exists — or a new one.
   *
   * BOTH BRANCHES ARE REACHED, which is the whole point. Waypoint's server build
   * emits no `<head>` and its BROWSER build emits an empty one; that difference
   * is the same one that caused a hydration mismatch on this page. The first
   * version only handled the missing case, so the sent email got the responsive
   * stylesheet and the composer's preview silently did not — a preview that
   * lied about the one thing it was being asked about. Found by measuring
   * `document.querySelectorAll('style').length` inside the preview iframe, which
   * came back 0.
   */
  const inner = headInner(backdrop);
  const headOpen = /<head[^>]*>/i.exec(html);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    html = html.slice(0, at) + inner + html.slice(at);
  } else {
    const htmlOpen = html.indexOf('>', html.indexOf('<html')) + 1;
    if (htmlOpen > 0) html = html.slice(0, htmlOpen) + `<head>${inner}</head>` + html.slice(htmlOpen);
  }

  const bodyOpen = html.indexOf('>', html.indexOf('<body')) + 1;
  const bodyClose = html.lastIndexOf('</body>');
  if (bodyOpen <= 0 || bodyClose < bodyOpen) return html;

  return (
    html.slice(0, bodyOpen) + pre + masthead(ctx, backdrop)
    + html.slice(bodyOpen, bodyClose) + footer(ctx, backdrop) + pixel + html.slice(bodyClose)
  );
}

/**
 * The plain-text alternative.
 *
 * Sent alongside the HTML, not as an afterthought: a multipart message with no
 * text part is one of the strongest spam signals there is, so this materially
 * affects whether the HTML arrives at all. Walks the document rather than
 * stripping tags from the output, because the document still knows which string
 * was a heading and which was a button's destination.
 */
/**
 * Entities → characters, for the plain-text alternative.
 *
 * The designed blocks are HTML and use entities a hand-written block never
 * would — `&ldquo;` around a testimonial, `&check;` in a price list, `&rsaquo;`
 * on a link row. The old decode knew six names, so those arrived in the text
 * part as the literal string `&ldquo;`, which is the half of the message the
 * spam filters read and the half nobody looks at.
 */
function unentity(s: string): string {
  const named: Record<string, string> = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
    hellip: '…', mdash: '—', ndash: '–', middot: '·', times: '×',
    check: '✓', rsaquo: '›', lsaquo: '‹', bull: '•', deg: '°', euro: '€', pound: '£',
  };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    // `&amp;` last would double-decode `&amp;lt;`; doing every name in one pass
    // means each entity is read exactly once.
    .replace(/&([a-z]+);/gi, (m, n) => named[String(n).toLowerCase()] ?? m);
}

export function docToText(doc: EmailDoc, ctx: RenderCtx): string {
  const d = normalizeDoc(doc);
  const lines: string[] = [];

  const walk = (ids: string[]) => {
    for (const id of ids) {
      const b = d[id];
      if (!b) continue;
      const p = b.data?.props ?? {};
      switch (b.type) {
        case 'Heading': if (p.text) lines.push(String(p.text), ''); break;
        case 'Text': if (p.text) lines.push(String(p.text), ''); break;
        case 'Button': if (p.text && p.url) lines.push(`${p.text}: ${p.url}`, ''); break;
        case 'Divider': lines.push('—', ''); break;
        case 'Html':
          lines.push(
            unentity(stripUnsafeHtml(String(p.contents || '')).replace(/<[^>]+>/g, ' '))
              .replace(/[ \t]+/g, ' ').trim(),
            '',
          );
          break;
        case 'ColumnsContainer':
          for (const col of p.columns ?? []) walk(col?.childrenIds ?? []);
          break;
        default: break;   // Image, Spacer and Avatar carry no words
      }
    }
  };
  walk(rootChildren(d));

  lines.push('—', ctx.brand.name);
  if (ctx.brand.address) lines.push(ctx.brand.address);
  lines.push(`Unsubscribe: ${ctx.unsubscribeUrl}`);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ── Starting points ─────────────────────────────────────────────────────────

/**
 * Layouts to start from.
 *
 * They are ALSO the few-shot examples the AI drafter is shown — the same rule as
 * `lib/workspace/templates.ts`. Two separate sets drift, and then improving a
 * preset stops improving what the model produces.
 *
 * ── THEY CARRY REAL COPY, NOT LOREM ─────────────────────────────────────────
 * The first version shipped "A heading" and "Write something here", which is
 * the honest thing to put in a blank block and the wrong thing to put in a
 * template: a template's job is to show you the SHAPE of an email that works,
 * and a page of placeholder text shows you nothing you could not have guessed.
 * Every line below is one somebody could send after changing the nouns.
 *
 * ── AND REAL SPACING ────────────────────────────────────────────────────────
 * The single biggest difference between an email that looks designed and one
 * that looks generated is white space. These use 40px top padding, 28px side
 * padding, and generous gaps between sections — roughly double what a naive
 * default gives you, and the reason the first set looked cramped.
 *
 * `accent` is passed in so a preset opens in the workspace's own brand colour
 * rather than ours, which is the difference between "a template" and "our
 * newsletter" on first sight.
 */

/** Shorthands, so a preset reads as a layout rather than as JSON. */
const P = (top: number, bottom: number, side = 32) => ({ top, right: side, bottom, left: side });
const heading = (text: string, level: 'h1' | 'h2' | 'h3', padding: any, align: 'left' | 'center' = 'left', color?: string) =>
  ({ type: 'Heading', data: { props: { text, level }, style: { padding, textAlign: align, ...(color ? { color } : {}) } } });
const text = (t: string, padding: any, opts: { size?: number; align?: 'left' | 'center'; color?: string } = {}) =>
  ({ type: 'Text', data: { props: { text: t, markdown: true }, style: { padding, fontSize: opts.size ?? 16, textAlign: opts.align ?? 'left', ...(opts.color ? { color: opts.color } : {}) } } });
const button = (label: string, accent: string, padding: any, align: 'left' | 'center' = 'left', shape: 'pill' | 'rounded' = 'pill', textColor = '#FFFFFF') =>
  ({ type: 'Button', data: { props: { text: label, url: '', buttonStyle: shape, buttonTextColor: textColor, buttonBackgroundColor: accent, size: 'large' }, style: { padding, textAlign: align } } });
const image = (padding: any) =>
  ({ type: 'Image', data: { props: { url: '', alt: '', contentAlignment: 'middle' }, style: { padding } } });
const eyebrow = (t: string, accent: string, padding = P(40, 6)) =>
  ({ type: 'Text', data: { props: { text: t.toUpperCase(), markdown: false }, style: { ...padding && { padding }, fontSize: 12, color: accent, fontWeight: 'bold' } } });
const spacer = (h: number) => ({ type: 'Spacer', data: { props: { height: h } } });

/**
 * ── HAND-WRITTEN PIECES ─────────────────────────────────────────────────────
 *
 * Four things the reference designs do that Waypoint has no block for: a
 * gradient hero panel, a two-column feature grid with rules above each cell, a
 * quiet footer card, and a row of numbers. They are `Html` blocks — table
 * markup with inline styles, which is what email is anyway.
 *
 * WHY THAT IS SAFE HERE AND NOT IN GENERAL. `stripUnsafeHtml` runs over every
 * Html block on the way out, including these, so they obey the same rules as
 * anything a user pastes. They contain no script, no <style> and no external
 * reference by construction; if that ever changed the sanitiser would remove it
 * and the design would degrade rather than the email becoming unsafe.
 *
 * Every one is EDITABLE — the user opens the block and edits the markup — which
 * is the honest trade for a layout the block vocabulary cannot express.
 */
const SANS = `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;

const html = (contents: string, padding: any) =>
  ({ type: 'Html', data: { props: { contents }, style: { padding } } });

const INK = '#1F2024';
const LINE = '#E6E6EA';

/**
 * Mix a colour towards white.
 *
 * Section bands are the cheapest way to give an email rhythm, and a band has
 * to be the workspace's own colour or it reads as a stray grey box. A tint
 * computed from the accent is the same colour at 6% rather than a second
 * colour somebody has to choose — and email has no `color-mix()`, so it is
 * computed here and emitted as a flat hex.
 */
function tint(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '#F5F5F7';
  const n = parseInt(m[1], 16);
  const mix = (v: number) => Math.round(v * amount + 255 * (1 - amount));
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => mix(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * A gradient panel.
 *
 * `background` is declared TWICE — a flat colour, then the gradient. Outlook
 * renders with Word's engine and ignores `linear-gradient` entirely, so the
 * first declaration is what it shows; every other client takes the second.
 * Written the other way round, Outlook gets no background at all and white text
 * lands on white.
 */
const gradientPanel = (
  title: string, sub: string, from: string, to: string, flat: string,
  cta?: string,
) => html(
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td align="center" class="rb-hero" style="background:${flat};background:linear-gradient(135deg,${from} 0%,${to} 100%);border-radius:20px;padding:58px 32px;">
    <div style="font-family:${SANS};font-size:27px;line-height:1.2;font-weight:700;letter-spacing:-0.02em;color:#FFFFFF;margin:0 0 10px;">${title}</div>
    <div style="font-family:${SANS};font-size:15px;line-height:1.55;color:rgba(255,255,255,0.80);margin:0;">${sub}</div>
    ${cta ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto 0;"><tr>
      <td align="center" bgcolor="#FFFFFF" style="border-radius:999px;">
        <a href="" style="display:inline-block;padding:12px 26px;font-family:${SANS};font-size:14px;font-weight:600;color:${flat};text-decoration:none;border-radius:999px;">${cta}</a>
      </td></tr></table>` : ''}
  </td></tr></table>`,
  P(0, 30),
);

/**
 * The two-column feature grid from the reference: a hairline above each cell,
 * a bold title, a muted line.
 *
 * `width:50%` on the cells is deliberate — `makeResponsive` keys the mobile
 * stacking rule off exactly that, so this grid becomes one column on a phone
 * for free rather than needing its own media query.
 */
const featureGrid = (items: { title: string; body: string }[], line = LINE, muted = MUTED) => {
  const cell = (it: { title: string; body: string }) =>
    `<td width="50%" valign="top" style="width:50%;padding:0 10px 24px;">
      <div style="border-top:2px solid ${line};padding-top:14px;">
        <div style="font-family:${SANS};font-size:15px;font-weight:600;letter-spacing:-0.01em;color:${INK};margin:0 0 5px;">${it.title}</div>
        <div style="font-family:${SANS};font-size:14px;line-height:1.6;color:${muted};">${it.body}</div>
      </div>
    </td>`;
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(`<tr>${cell(items[i])}${items[i + 1] ? cell(items[i + 1]) : '<td width="50%" style="width:50%;"></td>'}</tr>`);
  }
  return html(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 -10px;">${rows.join('')}</table>`,
    P(4, 20),
  );
};

/** The quiet card the reference closes on. */
const signoff = (line: string, sub: string, bg = '#F5F5F7') => html(
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td align="center" style="background:${bg};border-radius:16px;padding:30px 26px;">
    <div style="font-family:${SANS};font-size:15px;font-weight:600;letter-spacing:-0.01em;color:${INK};margin:0 0 5px;">${line}</div>
    <div style="font-family:${SANS};font-size:13px;line-height:1.6;color:${MUTED};">${sub}</div>
  </td></tr></table>`,
  P(8, 38),
);

/** Three numbers in a row — the shape a monthly report wants. */
const stats = (items: { value: string; label: string }[], accent: string) => html(
  // NO `width:33.33%` in the style, deliberately: that is exactly the string
  // `makeResponsive` keys the stacking rule off, and three numbers that stack
  // are a list, not a stat row — the whole point of the block is reading them
  // side by side. The `width` ATTRIBUTE still divides the row evenly (and is
  // what Outlook honours anyway), so this loses nothing on the desktop.
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>${items.map((it) => `<td width="33%" align="center" valign="top" style="padding:0 6px;">
      <div style="font-family:${SANS};font-size:28px;line-height:1.1;font-weight:700;color:${accent};margin:0 0 4px;">${it.value}</div>
      <div style="font-family:${SANS};font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:${MUTED};">${it.label}</div>
    </td>`).join('')}</tr></table>`,
  P(8, 28),
);

/**
 * A quote, with the person's initials in a disc.
 *
 * The initials matter more than they look like they should: a testimonial with
 * a face beside it is read as a person and one without is read as copywriting,
 * and a disc of initials is the only version of a face available to a template
 * that ships with no images.
 */
const quoteCard = (quote: string, who: string, role: string, accent: string) => {
  const initials = who.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return html(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td style="background:${tint(accent, 0.05)};border-radius:16px;padding:28px 26px;">
    <div style="font-family:${SANS};font-size:19px;line-height:1.5;letter-spacing:-0.01em;color:${INK};margin:0 0 20px;">&ldquo;${quote}&rdquo;</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="38" valign="middle" style="padding-right:12px;">
        <div style="width:38px;height:38px;line-height:38px;border-radius:19px;background:${accent};color:#FFFFFF;font-family:${SANS};font-size:13px;font-weight:700;text-align:center;">${initials}</div>
      </td>
      <td valign="middle">
        <div style="font-family:${SANS};font-size:14px;font-weight:600;line-height:1.3;color:${INK};">${who}</div>
        <div style="font-family:${SANS};font-size:13px;line-height:1.3;color:${MUTED};">${role}</div>
      </td>
    </tr></table>
  </td></tr></table>`,
    P(4, 30),
  );
};

/**
 * A numbered run of points, with the numeral as the design.
 *
 * The one pattern every good product email shares and the block vocabulary has
 * no way to express: a large tinted numeral holding the left column while the
 * text sits against it. Reads as a sequence rather than a list, which is what
 * "what happens next" actually is.
 */
const numberList = (items: { title: string; body: string }[], accent: string) => html(
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  ${items.map((it, i) => `<tr>
    <td width="54" valign="top" style="padding:0 14px ${i === items.length - 1 ? 0 : 26}px 0;">
      <div class="rb-num" style="font-family:${SANS};font-size:26px;line-height:1.05;font-weight:700;color:${accent};letter-spacing:-0.02em;">${String(i + 1).padStart(2, '0')}</div>
    </td>
    <td valign="top" style="padding:0 0 ${i === items.length - 1 ? 0 : 26}px;">
      <div style="font-family:${SANS};font-size:16px;font-weight:600;line-height:1.35;letter-spacing:-0.01em;color:${INK};margin:0 0 5px;">${it.title}</div>
      <div style="font-family:${SANS};font-size:15px;line-height:1.6;color:${MUTED};">${it.body}</div>
    </td>
  </tr>`).join('')}
  </table>`,
  P(6, 30),
);

/**
 * The closing band: a tinted strip, a line, a button.
 *
 * Full-bleed — side padding 0, so it runs to the canvas edge instead of
 * floating as another rounded card. An email that ends on a card ends on the
 * same note it has been playing; one that ends on a band ends on a different
 * one, which is the whole job of a last section.
 */
const ctaBand = (title: string, sub: string, label: string, accent: string) => html(
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td align="center" class="rb-pad" style="background:${tint(accent, 0.08)};padding:44px 34px;">
    <div style="font-family:${SANS};font-size:22px;line-height:1.25;font-weight:700;letter-spacing:-0.016em;color:${INK};margin:0 0 8px;">${title}</div>
    <div style="font-family:${SANS};font-size:15px;line-height:1.55;color:${MUTED};margin:0 0 22px;">${sub}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
      <td align="center" bgcolor="${accent}" style="border-radius:999px;">
        <a href="" style="display:inline-block;padding:13px 30px;font-family:${SANS};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:999px;">${label}</a>
      </td></tr></table>
  </td></tr></table>`,
  { top: 8, right: 0, bottom: 0, left: 0 },
);

/** A hairline with a small label sitting in it. A section break that says which section. */
const ruleLabel = (label: string) => html(
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td valign="middle" style="font-size:0;line-height:0;"><div style="border-top:1px solid ${LINE};font-size:0;line-height:0;">&nbsp;</div></td>
    <td width="1" valign="middle" style="white-space:nowrap;padding:0 14px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:${MUTED};">${label}</td>
    <td valign="middle" style="font-size:0;line-height:0;"><div style="border-top:1px solid ${LINE};font-size:0;line-height:0;">&nbsp;</div></td>
  </tr></table>`,
  P(18, 22),
);

/**
 * A run of links, each with a chevron.
 *
 * What a digest actually is. The old digest used the two-column feature grid,
 * which is a grid of features — it made five unrelated links look like a
 * comparison table.
 */
const linkRows = (items: { title: string; body: string }[], accent: string) => html(
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  ${items.map((it, i) => `<tr><td style="padding:${i === 0 ? 0 : 16}px 0 16px;${i === items.length - 1 ? '' : `border-bottom:1px solid ${LINE};`}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="top">
        <div style="font-family:${SANS};font-size:16px;font-weight:600;line-height:1.35;letter-spacing:-0.01em;color:${INK};margin:0 0 4px;"><a href="" style="color:${INK};text-decoration:none;">${it.title}</a></div>
        <div style="font-family:${SANS};font-size:14px;line-height:1.55;color:${MUTED};">${it.body}</div>
      </td>
      <td width="20" valign="top" align="right" style="font-family:${SANS};font-size:16px;color:${accent};line-height:1.35;">&rsaquo;</td>
    </tr></table>
  </td></tr>`).join('')}
  </table>`,
  P(4, 26),
);

/** One plan, priced. For the email that is selling something. */
const priceCard = (plan: string, price: string, per: string, points: string[], label: string, accent: string) => html(
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td style="border:1px solid ${LINE};border-radius:18px;padding:30px 28px;background:#FFFFFF;">
    <div style="font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:${accent};margin:0 0 10px;">${plan}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="bottom" style="font-family:${SANS};font-size:44px;line-height:1;font-weight:700;letter-spacing:-0.03em;color:${INK};">${price}</td>
      <td valign="bottom" style="padding:0 0 5px 8px;font-family:${SANS};font-size:14px;color:${MUTED};">${per}</td>
    </tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0;">
      ${points.map((p) => `<tr><td width="18" valign="top" style="padding:0 0 9px;font-family:${SANS};font-size:14px;color:${accent};line-height:1.5;">&check;</td>
        <td valign="top" style="padding:0 0 9px;font-family:${SANS};font-size:15px;line-height:1.5;color:${INK};">${p}</td></tr>`).join('')}
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;"><tr>
      <td align="center" bgcolor="${accent}" style="border-radius:999px;">
        <a href="" style="display:inline-block;padding:13px 28px;font-family:${SANS};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:999px;">${label}</a>
      </td></tr></table>
  </td></tr></table>`,
  P(4, 28),
);

/** Assemble a document from an ordered list of blocks. */
function doc(canvas: { backdrop: string; canvasColor: string; textColor: string; font: string }, blocks: any[]): EmailDoc {
  const out: EmailDoc = {};
  const ids: string[] = [];
  for (const b of blocks) { const id = newBlockId(); out[id] = b; ids.push(id); }
  return {
    [ROOT]: { type: 'EmailLayout', data: {
      backdropColor: canvas.backdrop, canvasColor: canvas.canvasColor,
      textColor: canvas.textColor, fontFamily: canvas.font, childrenIds: ids } },
    ...out,
  };
}

const LIGHT = { backdrop: '#F1F1F4', canvasColor: '#FFFFFF', textColor: '#1F2024', font: 'MODERN_SANS' };
const MUTED_INK = '#6B6C75';

export const DOC_PRESETS: {
  key: string; name: string; description: string; build: (accent: string) => EmailDoc;
}[] = [
  {
    key: 'ask', name: 'Ask',
    description: 'Centred hero, one action, a grid of reasons, a warm sign-off.',
    build: (a) => doc(LIGHT, [
      heading('We would love your feedback', 'h1', P(48, 14), 'center'),
      text('You are using our product and we want to make sure it is working brilliantly for you. Mind answering a few quick questions?', P(0, 26, 48), { align: 'center', color: MUTED_INK, size: 16 }),
      button('Take 30 seconds', a, P(0, 34), 'center'),
      gradientPanel('★ ★ ★ ★ ★', 'Two minutes, five questions, no sign-up.', '#2B2B7A', a, '#2B2B7A'),
      ruleLabel('Why we ask'),
      featureGrid([
        { title: 'Focus on what matters.', body: 'Prioritise the features you actually care about.' },
        { title: 'Work smarter together.', body: 'Improve your daily workflow.' },
        { title: 'Design with intention.', body: 'Build a better experience for everyone.' },
        { title: 'Move faster.', body: 'Shape what we build next, sooner.' },
      ]),
      signoff('Thanks from our team', 'We read every answer, and we reply to the ones that ask something.'),
    ]),
  },
  {
    key: 'launch', name: 'Launch',
    description: 'Eyebrow, big headline, a gradient hero and a numbered run of what changed.',
    build: (a) => doc(LIGHT, [
      eyebrow('New', a, P(48, 10, 32)),
      heading('The thing you have been waiting for', 'h1', P(0, 16)),
      text('What it is, in one sentence a stranger would understand. What changes for the reader, in a second.', P(0, 28), { size: 17, color: MUTED_INK }),
      gradientPanel('Now available', 'Everything you asked for, and one thing you did not.', '#111133', a, '#111133', 'See it in action'),
      ruleLabel('What changed'),
      numberList([
        { title: 'It is faster.', body: 'The part that used to take an afternoon now takes a minute, on the same hardware.' },
        { title: 'It is simpler.', body: 'Two screens instead of six, and the one you needed is the one that opens.' },
        { title: 'It remembers.', body: 'The thing you set last time is still set. That was the most common complaint.' },
      ], a),
      ctaBand('Have a look', 'Everything above is live now — nothing to install.', 'Open it', a),
    ]),
  },
  {
    key: 'letter', name: 'Letter',
    description: 'Just words. The format that lands in the inbox most reliably.',
    build: (a) => doc(LIGHT, [
      heading('A quick note about what changed', 'h2', P(48, 18)),
      text('Hi there,\n\nOpen with the point rather than the preamble — the first line is what decides whether the rest gets read.\n\nThen the detail, in short paragraphs. If somebody skims this and takes away one thing, make sure it is the thing in the first line.\n\nThanks for reading.', P(0, 28), { size: 16 }),
      button('Read the full story', a, P(0, 44), 'left', 'rounded'),
    ]),
  },
  {
    key: 'report', name: 'Monthly report',
    description: 'Three numbers, then what they mean. For updates to a list that pays you.',
    build: (a) => doc(LIGHT, [
      eyebrow('October', a, P(48, 8, 32)),
      heading('The month in three numbers', 'h2', P(0, 24)),
      stats([
        { value: '1,284', label: 'New sign-ups' },
        { value: '98.4%', label: 'Uptime' },
        { value: '11', label: 'Ships' },
      ], a),
      text('One paragraph on what those numbers actually mean, including the one that went the wrong way. A report that only reports good months is not read for long.', P(0, 22), { color: MUTED_INK, size: 16 }),
      ruleLabel('The detail'),
      featureGrid([
        { title: 'What went well.', body: 'The thing you are proud of, in a line.' },
        { title: 'What did not.', body: 'The thing you are fixing, in a line.' },
        { title: 'What is next.', body: 'The one thing shipping before the next of these.' },
        { title: 'What we learned.', body: 'The thing you would tell someone starting today.' },
      ]),
      button('Read the full write-up', a, P(6, 44)),
    ]),
  },
  {
    key: 'story', name: 'Customer story',
    description: 'A quote with a face, the numbers behind it, and a link.',
    build: (a) => doc(LIGHT, [
      eyebrow('Customer story', a, P(48, 10, 32)),
      heading('How one team stopped spending Fridays on this', 'h2', P(0, 22)),
      quoteCard('It replaced four tools and a spreadsheet nobody trusted.', 'Ola Nowak', 'Operations at Nordwind', a),
      text('Two or three sentences of context: what the problem was, what they tried first, and what changed. Concrete beats superlative every time.', P(0, 20), { color: MUTED_INK, size: 16 }),
      stats([
        { value: '6h', label: 'Saved weekly' },
        { value: '4', label: 'Tools replaced' },
        { value: '1', label: 'Source of truth' },
      ], a),
      button('Read the story', a, P(6, 44)),
    ]),
  },
  {
    key: 'digest', name: 'Digest',
    description: 'An intro and a run of links. For roundups.',
    build: (a) => doc(LIGHT, [
      eyebrow('This month', a, P(48, 8, 32)),
      heading('Five things worth your time', 'h2', P(0, 14)),
      text('A sentence on why this issue earns the two minutes.', P(0, 6), { color: MUTED_INK, size: 16 }),
      ruleLabel('Reading'),
      linkRows([
        { title: 'The first piece.', body: 'One line on why it matters, written so the link is optional.' },
        { title: 'The second piece.', body: 'And its line, in the same shape.' },
        { title: 'The third piece.', body: 'Short enough that five of these still skim.' },
        { title: 'The fourth piece.', body: 'The one you nearly cut. Cut it next time.' },
        { title: 'The fifth piece.', body: 'End on the one you would send to a friend.' },
      ], a),
      signoff('That is everything', 'Reply if you want more of one kind and less of another.'),
    ]),
  },
  {
    key: 'event', name: 'Event',
    description: 'When, where, and one button that says yes.',
    build: (a) => doc(LIGHT, [
      eyebrow('You are invited', a, P(48, 12, 32)),
      heading('An evening about the thing', 'h1', P(0, 16), 'center'),
      gradientPanel('Thursday 14 May · 18:30', 'Somewhere good, in your city', '#1B2A4A', a, '#1B2A4A', 'Save me a seat'),
      ruleLabel('The evening'),
      numberList([
        { title: '18:30 · Doors.', body: 'Something to drink, and nobody talking at you yet.' },
        { title: '19:00 · Three short talks.', body: 'Fifteen minutes each. Nobody is selling anything.' },
        { title: '20:00 · The actual point.', body: 'Food, and the people you came to meet.' },
      ], a),
      text('Free, and there will be food. Reply if you want to bring someone.', P(4, 48), { align: 'center', size: 14, color: '#8A8B93' }),
    ]),
  },
  {
    key: 'welcome', name: 'Welcome',
    description: 'The first email somebody gets. Sets expectations.',
    build: (a) => doc(LIGHT, [
      heading('Welcome aboard', 'h1', P(48, 14)),
      text('Thanks for signing up. Here is what happens next, so nothing is a surprise.', P(0, 10), { size: 17, color: MUTED_INK }),
      ruleLabel('What happens next'),
      numberList([
        { title: 'One email a month.', body: 'On the first Tuesday. Never more than that, whatever else we launch.' },
        { title: 'Nothing else, ever.', body: 'No sharing, no partners, no second list you did not join.' },
        { title: 'Leaving takes one click.', body: 'The link at the bottom works immediately, with no page asking why.' },
      ], a),
      ctaBand('Start here', 'The five minutes that make the rest of it make sense.', 'Open the guide', a),
    ]),
  },
  {
    key: 'offer', name: 'Offer',
    description: 'One plan, priced, with the reasons underneath. For selling.',
    build: (a) => doc(LIGHT, [
      eyebrow('Until Friday', a, P(48, 10, 32)),
      heading('Everything, for less than a lunch', 'h2', P(0, 22)),
      priceCard('Team', '$8', '/seat, monthly', [
        'Unlimited seats and records',
        'Automations and e-signatures',
        'Forms, short links and reports',
        'Cancel in one click, keep your data',
      ], 'Start the trial', a),
      featureGrid([
        { title: 'No card to start.', body: 'Fourteen days, everything on.' },
        { title: 'No lock-in.', body: 'Export the whole workspace as CSV, always.' },
      ]),
      text('Prices in USD, billed monthly. The offer ends Friday and the price goes back up, which is the only reason this email exists.', P(6, 46), { size: 13, color: '#8A8B93' }),
    ]),
  },
  {
    key: 'bold', name: 'Bold',
    description: 'Dark, large type, one action. For something that matters.',
    build: (a) => doc(
      { backdrop: '#08080B', canvasColor: '#111115', textColor: '#F2F2F4', font: 'HEAVY_SANS' },
      [
        heading('One thing, said loudly', 'h1', P(72, 18), 'center', '#FFFFFF'),
        text('A single sentence underneath, with nothing else competing with it.', P(0, 38, 48), { align: 'center', size: 17, color: '#A9AAB4' }),
        // Not "Go". A pill's radius is half its height, so a two-character
        // label renders as an egg rather than a button — the shape only reads
        // as a pill once the label is wider than the button is tall.
        button('See what it is', a, P(0, 72), 'center'),
      ],
    ),
  },
  {
    key: 'blank', name: 'Blank', description: 'A canvas and nothing on it.',
    build: () => emptyDoc(),
  },
];

// ── The one entry point ─────────────────────────────────────────────────────

/**
 * Render any newsletter, whichever template it uses.
 *
 * EVERY caller goes through this pair — the send cron, the sequence runner and
 * the composer's preview. Two renderers exist (three fixed layouts in
 * `newsletter-templates.ts`, the visual builder here) and the way that goes
 * wrong is a caller that knows about one of them: the newsletter saves fine,
 * the preview looks right, and the send produces an empty body. Dispatching in
 * one place makes that impossible rather than unlikely.
 */
export function renderEmail(template: string, ctx: RenderCtx): string {
  if (template === 'blocks') return renderEmailDoc(ctx.content?.doc, ctx);
  return renderNewsletter(template as any, ctx);
}

export function renderEmailText(template: string, ctx: RenderCtx): string {
  if (template === 'blocks') return docToText(ctx.content?.doc, ctx);
  return renderText(template as any, ctx);
}
