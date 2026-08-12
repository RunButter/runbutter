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
      return { type, data: { props: { text: 'Write something here.' }, style: { ...style, fontSize: 16, textAlign: 'left' } } };
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
 * The footer, matched to the canvas so it reads as part of the email.
 *
 * Not a Waypoint block: it must exist on every send whatever the document says,
 * and a block a person can delete is not that. The unsubscribe link is the one
 * legally load-bearing element in a bulk email.
 */
function footer(ctx: RenderCtx): string {
  const { brand, unsubscribeUrl } = ctx;
  return `<table align="center" width="100%" role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;max-width:600px;">
  <tr><td style="padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <p style="margin:0;font-size:12px;line-height:18px;color:${MUTED};">
      ${brand.footer ? `${esc(brand.footer)}<br>` : ''}
      ${brand.address ? `${esc(brand.address)}<br>` : ''}
      <a href="${esc(unsubscribeUrl)}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a>
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

  const pre = ctx.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${esc(ctx.preheader)}</div>`
    : '';
  const pixel = ctx.openPixelUrl
    ? `<img src="${esc(ctx.openPixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;">`
    : '';

  // Inserted by string position rather than by parsing: the input is this
  // renderer's own output and its <body> is the first one in the document.
  const bodyOpen = html.indexOf('>', html.indexOf('<body')) + 1;
  const bodyClose = html.lastIndexOf('</body>');
  if (bodyOpen <= 0 || bodyClose < bodyOpen) return html;

  return (
    html.slice(0, bodyOpen) + pre + html.slice(bodyOpen, bodyClose) + footer(ctx) + pixel + html.slice(bodyClose)
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
            stripUnsafeHtml(String(p.contents || ''))
              .replace(/<[^>]+>/g, ' ')
              .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
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
 * Layouts to start from, as documents.
 *
 * They are ALSO the few-shot examples the AI drafter is shown — the same rule as
 * `lib/workspace/templates.ts`. Two separate sets drift, and then improving a
 * preset stops improving what the model produces.
 *
 * Accent is passed in so a preset opens in the workspace's own brand colour
 * rather than in ours, which is the difference between "a template" and "our
 * newsletter" on first sight.
 */
export const DOC_PRESETS: {
  key: string; name: string; description: string; build: (accent: string) => EmailDoc;
}[] = [
  {
    key: 'blank', name: 'Blank', description: 'A canvas and nothing on it.',
    build: () => emptyDoc(),
  },
  {
    key: 'letter', name: 'Letter', description: 'Heading, a few paragraphs, one button.',
    build: (accent) => {
      const [h, t, b] = [newBlockId(), newBlockId(), newBlockId()];
      return {
        [ROOT]: { type: 'EmailLayout', data: { backdropColor: '#F5F5F5', canvasColor: '#FFFFFF', textColor: '#242424', fontFamily: 'MODERN_SANS', childrenIds: [h, t, b] } },
        [h]: { type: 'Heading', data: { props: { text: 'Something worth telling you', level: 'h2' }, style: { padding: pad(28, 24, 8, 24), textAlign: 'left' } } },
        [t]: { type: 'Text', data: { props: { text: 'Hello,\n\nOpen with the point rather than the preamble — the first line decides whether the rest gets read.\n\nThen the detail.' }, style: { padding: pad(0, 24, 16, 24), fontSize: 16 } } },
        [b]: { type: 'Button', data: { props: { text: 'Read the full story', url: '', buttonStyle: 'rounded', buttonTextColor: '#FFFFFF', buttonBackgroundColor: accent, size: 'medium' }, style: { padding: pad(0, 24, 28, 24), textAlign: 'left' } } },
      };
    },
  },
  {
    key: 'launch', name: 'Launch', description: 'Hero image, headline, body, button.',
    build: (accent) => {
      const [i, h, t, b] = [newBlockId(), newBlockId(), newBlockId(), newBlockId()];
      return {
        [ROOT]: { type: 'EmailLayout', data: { backdropColor: '#F5F5F5', canvasColor: '#FFFFFF', textColor: '#242424', fontFamily: 'GEOMETRIC_SANS', childrenIds: [i, h, t, b] } },
        [i]: { type: 'Image', data: { props: { url: '', alt: '', contentAlignment: 'middle' }, style: { padding: pad(0, 0, 0, 0) } } },
        [h]: { type: 'Heading', data: { props: { text: 'Introducing the thing', level: 'h1' }, style: { padding: pad(28, 24, 8, 24), textAlign: 'left' } } },
        [t]: { type: 'Text', data: { props: { text: 'What it is, in one paragraph. What changes for the reader, in a second.' }, style: { padding: pad(0, 24, 20, 24), fontSize: 16 } } },
        [b]: { type: 'Button', data: { props: { text: 'Try it', url: '', buttonStyle: 'rounded', buttonTextColor: '#FFFFFF', buttonBackgroundColor: accent, size: 'large' }, style: { padding: pad(0, 24, 32, 24), textAlign: 'left' } } },
      };
    },
  },
  {
    key: 'twoup', name: 'Two up', description: 'Headline, then two columns side by side.',
    build: (accent) => {
      const [h, c, l, r, d] = [newBlockId(), newBlockId(), newBlockId(), newBlockId(), newBlockId()];
      return {
        [ROOT]: { type: 'EmailLayout', data: { backdropColor: '#F5F5F5', canvasColor: '#FFFFFF', textColor: '#242424', fontFamily: 'MODERN_SANS', childrenIds: [h, c, d] } },
        [h]: { type: 'Heading', data: { props: { text: 'Two things at once', level: 'h2' }, style: { padding: pad(28, 24, 8, 24), textAlign: 'left' } } },
        [c]: { type: 'ColumnsContainer', data: { props: { columnsCount: 2, columnsGap: 16, contentAlignment: 'top', columns: [{ childrenIds: [l] }, { childrenIds: [r] }] }, style: { padding: pad(8, 24, 8, 24) } } },
        [l]: { type: 'Text', data: { props: { text: 'The left one.' }, style: { padding: pad(0, 0, 0, 0), fontSize: 15 } } },
        [r]: { type: 'Text', data: { props: { text: 'The right one.' }, style: { padding: pad(0, 0, 0, 0), fontSize: 15 } } },
        [d]: { type: 'Button', data: { props: { text: 'See both', url: '', buttonStyle: 'rounded', buttonTextColor: '#FFFFFF', buttonBackgroundColor: accent, size: 'medium' }, style: { padding: pad(16, 24, 28, 24), textAlign: 'left' } } },
      };
    },
  },
  {
    key: 'bold', name: 'Bold', description: 'Dark canvas, big type, one action.',
    build: (accent) => {
      const [h, t, b] = [newBlockId(), newBlockId(), newBlockId()];
      return {
        [ROOT]: { type: 'EmailLayout', data: { backdropColor: '#0B0B0F', canvasColor: '#141419', textColor: '#F4F4F5', fontFamily: 'HEAVY_SANS', childrenIds: [h, t, b] } },
        [h]: { type: 'Heading', data: { props: { text: 'One thing, said loudly', level: 'h1' }, style: { padding: pad(40, 24, 12, 24), textAlign: 'center' } } },
        [t]: { type: 'Text', data: { props: { text: 'A single sentence underneath, and nothing else competing with it.' }, style: { padding: pad(0, 32, 24, 32), fontSize: 16, textAlign: 'center' } } },
        [b]: { type: 'Button', data: { props: { text: 'Go', url: '', buttonStyle: 'pill', buttonTextColor: '#0B0B0F', buttonBackgroundColor: accent, size: 'large' }, style: { padding: pad(0, 24, 44, 24), textAlign: 'center' } } },
      };
    },
  },
];

// ── The one entry point ─────────────────────────────────────────────────────

/**
 * Render any newsletter, whichever template it uses.
 *
 * EVERY caller goes through this pair — the send cron, the sequence runner and
 * the composer's preview. Two renderers now exist (three fixed layouts here,
 * the visual builder there) and the way that goes wrong is a caller that knows
 * about one of them: the newsletter saves fine, the preview looks right, and
 * the send produces an empty body. Dispatching in one place makes that
 * impossible rather than unlikely.
 */
export function renderEmail(template: string, ctx: RenderCtx): string {
  if (template === 'blocks') return renderEmailDoc(ctx.content?.doc, ctx);
  return renderNewsletter(template as any, ctx);
}

export function renderEmailText(template: string, ctx: RenderCtx): string {
  if (template === 'blocks') return docToText(ctx.content?.doc, ctx);
  return renderText(template as any, ctx);
}
