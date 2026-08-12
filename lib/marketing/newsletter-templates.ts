// The three newsletter templates, rendered to email HTML.
//
// Three, not thirty, and none of them is a drag-and-drop page builder. A builder
// is where mailing tools go to die: it produces nested-table HTML that has to be
// maintained against every client's rendering quirks forever, and the output is
// almost always worse than a good fixed layout.
//
// EMAIL HTML IS NOT WEB HTML. Everything below obeys the constraints that
// actually matter in Outlook and Gmail:
//   • tables for layout, not flexbox or grid (Outlook uses Word's engine)
//   • inline styles only — Gmail strips <style> blocks in several contexts
//   • no custom fonts, no CSS variables (our design tokens cannot reach here)
//   • hex colours, because hsl(var(--x)) means nothing in an inbox
//   • max 600px, the width every client has agreed on for two decades
//
// Brand values come from the workspace (0024 + 0061), so a newsletter matches
// that workspace's invoices and careers page without being configured twice.

export type TemplateKey = 'plain' | 'announcement' | 'digest' | 'blocks';

export interface Brand {
  name: string;
  logoUrl?: string | null;
  accent?: string | null;     // hex, e.g. #10b981
  address?: string | null;    // physical address — legally required in most bulk email
  footer?: string | null;
}

export interface DigestItem { title: string; blurb?: string; url?: string }

/**
 * ── The builder (0098) ──────────────────────────────────────────────────────
 *
 * A LINEAR LIST OF TYPED BLOCKS, and that qualifier is the whole design.
 *
 * The comment at the top of this file argues against drag-and-drop builders and
 * it still stands: a canvas produces nested-table HTML nobody can maintain
 * against Outlook, and the output is worse than a good fixed layout. What is
 * composable here is the ORDER and the CHOICE of blocks. What the HTML actually
 * is stays ours — every block renders through the functions below, into the
 * same 600px shell, with the same inline styles, preheader, unsubscribe footer
 * and tracking pixel as the three fixed templates.
 *
 * So there is no absolute positioning, no arbitrary nesting, and no way to
 * express a layout we have not already made work in an inbox. `columns` is two
 * fixed halves that stack on mobile, not a grid.
 *
 * Adding a block type means adding a renderer AND a text renderer AND an editor
 * — a type with only the first is an email that arrives blank in the plain-text
 * part, which is a spam signal rather than a cosmetic gap.
 */
export type BlockType =
  | 'heading' | 'text' | 'image' | 'button' | 'divider' | 'spacer'
  | 'quote' | 'columns' | 'items' | 'html';

export interface EmailBlock {
  /** Stable across reorders — React keys, and nothing else depends on it. */
  id: string;
  type: BlockType;
  text?: string;              // heading, text, quote, button label
  url?: string;               // image src, button href
  alt?: string;               // image
  align?: 'left' | 'center' | 'right';
  size?: 'sm' | 'md' | 'lg';  // heading level, spacer height, image width
  attribution?: string;       // quote
  columns?: { text?: string; imageUrl?: string; url?: string; label?: string }[];
  items?: DigestItem[];
  html?: string;              // raw block — see renderHtmlBlock
}

export interface NewsletterContent {
  /** blocks */
  blocks?: EmailBlock[];
  /** plain + announcement */
  heading?: string;
  body?: string;              // plain text with blank-line paragraphs
  ctaLabel?: string;
  ctaUrl?: string;
  /** announcement */
  imageUrl?: string;
  /** digest */
  intro?: string;
  items?: DigestItem[];
}

export interface RenderCtx {
  subject: string;
  preheader?: string;
  brand: Brand;
  content: NewsletterContent;
  /** Absolute. Rewritten per recipient by the sender. */
  unsubscribeUrl: string;
  /** Absolute 1x1 pixel, per delivery. Omitted for previews. */
  openPixelUrl?: string;
  /** Wraps an outbound link for click tracking. Identity in previews. */
  trackLink?: (url: string) => string;
}

const ACCENT_FALLBACK = '#10b981';

/** Minimal HTML escaping. Everything user-authored goes through this. */
export function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Only http(s) links survive. A newsletter body is user-authored, and an
 * unfiltered href lets `javascript:` or `data:` through into a document that
 * some webmail clients render with more privilege than they should.
 */
function safeUrl(u?: string): string | null {
  if (!u) return null;
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.toString() : null;
  } catch { return null; }
}

/** Blank-line separated text → paragraphs. Single newlines become <br>. */
function paragraphs(text: string, color: string): string {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:26px;color:${color};">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

const INK = '#18181b';
const MUTED = '#71717a';
const LINE = '#e4e4e7';
const CANVAS = '#f4f4f5';

function button(label: string, url: string, accent: string): string {
  // A table, not an <a> with padding: Outlook collapses padded inline anchors.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
    <tr><td align="center" bgcolor="${accent}" style="border-radius:8px;">
      <a href="${esc(url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(label)}</a>
    </td></tr></table>`;
}

function shell(inner: string, ctx: RenderCtx): string {
  const { brand, subject, preheader, unsubscribeUrl, openPixelUrl } = ctx;
  const accent = brand.accent || ACCENT_FALLBACK;
  const logo = safeUrl(brand.logoUrl || undefined);

  // The preheader is the grey line clients show after the subject. Hidden in the
  // body but present in the source; without it the client scrapes the first
  // visible text, which is usually "View in browser".
  const pre = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${esc(preheader)}</div>`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${CANVAS};-webkit-font-smoothing:antialiased;">
${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS};">
  <tr><td align="center" style="padding:32px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:12px;">
      <tr><td style="padding:28px 32px 0;">
        ${logo
          ? `<img src="${esc(logo)}" alt="${esc(brand.name)}" width="120" style="display:block;max-width:120px;height:auto;border:0;">`
          : `<div style="font-size:17px;font-weight:600;color:${INK};">${esc(brand.name)}</div>`}
      </td></tr>
      <tr><td style="padding:24px 32px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
        ${inner}
      </td></tr>
      <tr><td style="padding:8px 32px 28px;">
        <hr style="border:0;border-top:1px solid ${LINE};margin:8px 0 16px;">
        <p style="margin:0 0 6px;font-size:12px;line-height:18px;color:${MUTED};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
          ${brand.footer ? esc(brand.footer) + '<br>' : ''}
          ${brand.address ? esc(brand.address) + '<br>' : ''}
          <a href="${esc(unsubscribeUrl)}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
${openPixelUrl ? `<img src="${esc(openPixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;">` : ''}
</body></html>`;
}

function renderPlain(ctx: RenderCtx): string {
  const { content, brand } = ctx;
  const accent = brand.accent || ACCENT_FALLBACK;
  const track = ctx.trackLink ?? ((u: string) => u);
  const cta = safeUrl(content.ctaUrl);
  return shell(
    `${content.heading ? `<h1 style="margin:0 0 16px;font-size:22px;line-height:30px;font-weight:600;color:${INK};">${esc(content.heading)}</h1>` : ''}
     ${paragraphs(content.body || '', INK)}
     ${cta && content.ctaLabel ? button(content.ctaLabel, track(cta), accent) : ''}`,
    ctx,
  );
}

function renderAnnouncement(ctx: RenderCtx): string {
  const { content, brand } = ctx;
  const accent = brand.accent || ACCENT_FALLBACK;
  const track = ctx.trackLink ?? ((u: string) => u);
  const img = safeUrl(content.imageUrl);
  const cta = safeUrl(content.ctaUrl);
  return shell(
    `${img ? `<img src="${esc(img)}" alt="" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:8px;margin:0 0 20px;">` : ''}
     ${content.heading ? `<h1 style="margin:0 0 14px;font-size:26px;line-height:34px;font-weight:600;color:${INK};">${esc(content.heading)}</h1>` : ''}
     ${paragraphs(content.body || '', INK)}
     ${cta && content.ctaLabel ? button(content.ctaLabel, track(cta), accent) : ''}`,
    ctx,
  );
}

function renderDigest(ctx: RenderCtx): string {
  const { content, brand } = ctx;
  const accent = brand.accent || ACCENT_FALLBACK;
  const track = ctx.trackLink ?? ((u: string) => u);
  const items = (content.items || []).slice(0, 25);
  return shell(
    `${content.heading ? `<h1 style="margin:0 0 12px;font-size:22px;line-height:30px;font-weight:600;color:${INK};">${esc(content.heading)}</h1>` : ''}
     ${content.intro ? paragraphs(content.intro, MUTED) : ''}
     ${items.map((it, i) => {
       const u = safeUrl(it.url);
       const title = u
         ? `<a href="${esc(track(u))}" style="color:${accent};text-decoration:none;">${esc(it.title)}</a>`
         : esc(it.title);
       // The last item drops its rule: the footer draws one immediately below,
       // and the two together read as a mistake.
       const last = i === items.length - 1;
       return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${last ? '4' : '18'}px;">
         <tr><td style="padding:0 0 14px;${last ? '' : `border-bottom:1px solid ${LINE};`}">
           <div style="font-size:17px;line-height:24px;font-weight:600;color:${INK};margin:0 0 4px;">${title}</div>
           ${it.blurb ? `<div style="font-size:15px;line-height:23px;color:${MUTED};">${esc(it.blurb)}</div>` : ''}
         </td></tr></table>`;
     }).join('')}`,
    ctx,
  );
}

// ── Blocks (0098) ───────────────────────────────────────────────────────────

const HEADING_SIZE = { sm: [17, 25], md: [22, 30], lg: [28, 36] } as const;
const SPACER_SIZE = { sm: 8, md: 20, lg: 40 } as const;

/**
 * A raw-HTML block, stripped of everything that can act.
 *
 * Offered because people arrive with an existing template from another tool and
 * refusing to accept it means refusing the customer. But it is NOT passed
 * through: scripts, styles, iframes, objects, embeds, event handlers and any
 * `javascript:`/`data:` URL are removed first.
 *
 * The reason is not the recipient — every serious mail client sanitises far
 * harder than this. It is US. This HTML is rendered in the composer's preview
 * and can be read back by an agent, so unfiltered markup is stored XSS in our
 * own product. The preview iframe is sandboxed as well; two layers, because the
 * one that fails silently is the one you find out about last.
 *
 * `<style>` goes too, and that is worth knowing rather than a side effect:
 * Gmail strips style blocks in several contexts anyway, so anything relying on
 * one was already going to arrive unstyled.
 */
function renderHtmlBlock(raw: string): string {
  return String(raw || '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form)\b[^>]*>/gi, '')
    // Event handlers, quoted or bare.
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Anything that navigates or executes from an attribute value.
    .replace(/\s(?:href|src|xlink:href|action|formaction)\s*=\s*(?:"|')?\s*(?:javascript|data|vbscript)\s*:[^"'>\s]*(?:"|')?/gi, ' ')
    .slice(0, 100_000);
}

function renderBlock(b: EmailBlock, ctx: RenderCtx): string {
  const accent = ctx.brand.accent || ACCENT_FALLBACK;
  const track = ctx.trackLink ?? ((u: string) => u);
  const align = b.align === 'center' || b.align === 'right' ? b.align : 'left';

  switch (b.type) {
    case 'heading': {
      const [size, line] = HEADING_SIZE[b.size ?? 'md'] ?? HEADING_SIZE.md;
      if (!b.text) return '';
      return `<h2 style="margin:0 0 14px;font-size:${size}px;line-height:${line}px;font-weight:600;color:${INK};text-align:${align};">${esc(b.text)}</h2>`;
    }
    case 'text':
      // `paragraphs` already aligns left; wrapping rather than parameterising it
      // keeps the three fixed templates byte-identical to what they sent before.
      return align === 'left'
        ? paragraphs(b.text || '', INK)
        : `<div style="text-align:${align};">${paragraphs(b.text || '', INK)}</div>`;

    case 'image': {
      const u = safeUrl(b.url);
      if (!u) return '';
      const width = b.size === 'sm' ? 240 : b.size === 'md' ? 380 : 536;
      const img = `<img src="${esc(u)}" alt="${esc(b.alt || '')}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;border-radius:8px;margin:0 0 20px;${
        align === 'center' ? 'margin-left:auto;margin-right:auto;' : align === 'right' ? 'margin-left:auto;' : ''}">`;
      return img;
    }

    case 'button': {
      const u = safeUrl(b.url);
      if (!u || !b.text) return '';
      // The shared `button` helper is left-aligned by a zero-margin table; the
      // wrapper is how it centres without a second copy of the Outlook-safe
      // markup.
      return align === 'left' ? button(b.text, track(u), accent)
        : `<div style="text-align:${align};"><div style="display:inline-block;">${button(b.text, track(u), accent)}</div></div>`;
    }

    case 'divider':
      return `<hr style="border:0;border-top:1px solid ${LINE};margin:20px 0;">`;

    case 'spacer':
      // A table cell with a fixed height, not a margin: Outlook collapses
      // margins on empty elements and the gap silently disappears.
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="height:${
        SPACER_SIZE[b.size ?? 'md'] ?? SPACER_SIZE.md}px;line-height:1px;font-size:1px;">&nbsp;</td></tr></table>`;

    case 'quote':
      if (!b.text) return '';
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
        <tr><td style="padding:2px 0 2px 16px;border-left:3px solid ${accent};">
          <div style="font-size:17px;line-height:27px;color:${INK};">${esc(b.text)}</div>
          ${b.attribution ? `<div style="margin-top:6px;font-size:14px;line-height:20px;color:${MUTED};">— ${esc(b.attribution)}</div>` : ''}
        </td></tr></table>`;

    case 'columns': {
      // TWO fixed halves, and `width="50%"` on the cells rather than a grid.
      // Outlook has no flexbox; the mobile stack comes from max-width on the
      // inner table, which is the one trick that works everywhere.
      const cols = (b.columns || []).slice(0, 2);
      if (cols.length === 0) return '';
      const cell = (c: { text?: string; imageUrl?: string; url?: string; label?: string }) => {
        const img = safeUrl(c.imageUrl);
        const u = safeUrl(c.url);
        return `${img ? `<img src="${esc(img)}" alt="" width="252" style="display:block;width:100%;max-width:252px;height:auto;border:0;border-radius:8px;margin:0 0 12px;">` : ''}
          ${c.text ? `<div style="font-size:15px;line-height:23px;color:${INK};">${esc(c.text)}</div>` : ''}
          ${u && c.label ? `<div style="margin-top:8px;"><a href="${esc(track(u))}" style="font-size:15px;font-weight:600;color:${accent};text-decoration:none;">${esc(c.label)}</a></div>` : ''}`;
      };
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
        <tr>${cols.map((c, i) => `<td width="50%" valign="top" style="width:50%;padding:0 ${i === 0 && cols.length > 1 ? '10px' : '0'} 0 ${i === 1 ? '10px' : '0'};">${cell(c)}</td>`).join('')}</tr>
      </table>`;
    }

    case 'items': {
      // The digest layout, available as a block. Shared shape (DigestItem) so a
      // digest newsletter can be converted to blocks without touching content.
      const items = (b.items || []).slice(0, 25);
      return items.map((it, i) => {
        const u = safeUrl(it.url);
        const title = u
          ? `<a href="${esc(track(u))}" style="color:${accent};text-decoration:none;">${esc(it.title)}</a>`
          : esc(it.title);
        const last = i === items.length - 1;
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${last ? '4' : '18'}px;">
          <tr><td style="padding:0 0 14px;${last ? '' : `border-bottom:1px solid ${LINE};`}">
            <div style="font-size:17px;line-height:24px;font-weight:600;color:${INK};margin:0 0 4px;">${title}</div>
            ${it.blurb ? `<div style="font-size:15px;line-height:23px;color:${MUTED};">${esc(it.blurb)}</div>` : ''}
          </td></tr></table>`;
      }).join('');
    }

    case 'html':
      return renderHtmlBlock(b.html || '');

    default:
      // An unknown type renders as nothing rather than raising. Content is
      // free-form jsonb, so a row written by a newer client must degrade in an
      // older one instead of taking the composer down.
      return '';
  }
}

function renderBlocks(ctx: RenderCtx): string {
  // Capped. The list is user-authored and the whole thing becomes one email
  // body; a runaway import should produce a long email, not a timeout.
  const blocks = (ctx.content.blocks || []).slice(0, 100);
  return shell(blocks.map((b) => renderBlock(b, ctx)).join(''), ctx);
}

/** Plain-text alternative for one block. See `renderText`. */
function blockToText(b: EmailBlock): string[] {
  switch (b.type) {
    case 'heading': return b.text ? [b.text, ''] : [];
    case 'text': return b.text ? [b.text, ''] : [];
    case 'quote': return b.text ? [`"${b.text}"`, ...(b.attribution ? [`— ${b.attribution}`] : []), ''] : [];
    case 'button': return b.text && b.url ? [`${b.text}: ${b.url}`, ''] : [];
    case 'image': return [];
    case 'divider': return ['—', ''];
    case 'spacer': return [''];
    case 'columns':
      return (b.columns || []).flatMap((c) => [
        ...(c.text ? [c.text] : []),
        ...(c.label && c.url ? [`${c.label}: ${c.url}`] : []),
      ]).concat('');
    case 'items':
      return (b.items || []).flatMap((it) => [
        `* ${it.title}`,
        ...(it.blurb ? [`  ${it.blurb}`] : []),
        ...(it.url ? [`  ${it.url}`] : []),
      ]).concat('');
    case 'html':
      // Tags out, entities back, whitespace collapsed. A crude conversion is
      // the right call: the alternative is shipping an empty text part, and a
      // multipart message with no text is a strong spam signal.
      return [String(b.html || '')
        .replace(/<\s*(script|style)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(), ''];
    default: return [];
  }
}

export function renderNewsletter(template: TemplateKey, ctx: RenderCtx): string {
  if (template === 'blocks') return renderBlocks(ctx);
  if (template === 'announcement') return renderAnnouncement(ctx);
  if (template === 'digest') return renderDigest(ctx);
  return renderPlain(ctx);
}

/**
 * Plain-text alternative. Sent alongside the HTML, not as an afterthought:
 * a multipart message with no text part is one of the strongest spam signals
 * there is, so this materially affects whether the HTML arrives at all.
 */
export function renderText(template: TemplateKey, ctx: RenderCtx): string {
  const c = ctx.content;
  const lines: string[] = [];
  if (template === 'blocks') {
    for (const b of (c.blocks || []).slice(0, 100)) lines.push(...blockToText(b));
    lines.push('—', ctx.brand.name);
    if (ctx.brand.address) lines.push(ctx.brand.address);
    lines.push(`Unsubscribe: ${ctx.unsubscribeUrl}`);
    return lines.join('\n');
  }
  if (c.heading) lines.push(c.heading, '');
  if (c.intro) lines.push(c.intro, '');
  if (c.body) lines.push(c.body, '');
  for (const it of c.items || []) {
    lines.push(`* ${it.title}`);
    if (it.blurb) lines.push(`  ${it.blurb}`);
    if (it.url) lines.push(`  ${it.url}`);
  }
  if (c.ctaLabel && c.ctaUrl) lines.push('', `${c.ctaLabel}: ${c.ctaUrl}`);
  lines.push('', '—', ctx.brand.name);
  if (ctx.brand.address) lines.push(ctx.brand.address);
  lines.push(`Unsubscribe: ${ctx.unsubscribeUrl}`);
  return lines.join('\n');
}

export const TEMPLATE_META: { key: TemplateKey; name: string; description: string }[] = [
  { key: 'plain', name: 'Plain', description: 'A letter. One column, text, one call to action — the highest-deliverability format.' },
  { key: 'announcement', name: 'Announcement', description: 'Hero image, headline, body and a button. For launches.' },
  { key: 'digest', name: 'Digest', description: 'Repeating title, blurb and link blocks. For roundups.' },
  { key: 'blocks', name: 'Build your own', description: 'Stack headings, text, images, buttons and columns in any order.' },
];

export const BLOCK_META: { type: BlockType; name: string; hint: string }[] = [
  { type: 'heading', name: 'Heading', hint: 'A line that starts a section' },
  { type: 'text', name: 'Text', hint: 'Paragraphs — a blank line starts a new one' },
  { type: 'image', name: 'Image', hint: 'A hosted image, by URL' },
  { type: 'button', name: 'Button', hint: 'One clear action' },
  { type: 'columns', name: 'Two columns', hint: 'Side by side on desktop, stacked on a phone' },
  { type: 'items', name: 'Link list', hint: 'Title, blurb and link, repeated' },
  { type: 'quote', name: 'Quote', hint: 'A testimonial or a pull quote' },
  { type: 'divider', name: 'Divider', hint: 'A horizontal rule' },
  { type: 'spacer', name: 'Spacer', hint: 'Breathing room' },
  { type: 'html', name: 'Custom HTML', hint: 'Paste from another tool — scripts and styles are stripped' },
];

/** A new block of each type, with enough in it to be visible in the preview. */
export function newBlock(type: BlockType): EmailBlock {
  const id = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  switch (type) {
    case 'heading': return { id, type, text: 'A heading', size: 'md', align: 'left' };
    case 'text': return { id, type, text: '', align: 'left' };
    case 'image': return { id, type, url: '', alt: '', size: 'lg', align: 'center' };
    case 'button': return { id, type, text: 'Read more', url: '', align: 'left' };
    case 'quote': return { id, type, text: '', attribution: '' };
    case 'spacer': return { id, type, size: 'md' };
    case 'columns': return { id, type, columns: [{ text: '' }, { text: '' }] };
    case 'items': return { id, type, items: [{ title: '', blurb: '', url: '' }] };
    case 'html': return { id, type, html: '' };
    default: return { id, type };
  }
}

/**
 * Starting points, as block lists.
 *
 * They are ALSO the few-shot examples the AI drafter is shown — the same rule
 * as `lib/workspace/templates.ts`. Two separate sets would drift, and then
 * improving a preset would stop improving what the model produces.
 */
export const BLOCK_PRESETS: { key: string; name: string; description: string; blocks: () => EmailBlock[] }[] = [
  {
    key: 'blank', name: 'Blank', description: 'Start with nothing.',
    blocks: () => [],
  },
  {
    key: 'letter', name: 'Letter', description: 'Heading, a few paragraphs, one button.',
    blocks: () => [
      { ...newBlock('heading'), text: 'Something worth telling you' },
      { ...newBlock('text'), text: 'Hello,\n\nOpen with the point rather than the preamble — the first line is what decides whether the rest gets read.\n\nThen the detail.' },
      { ...newBlock('button'), text: 'Read the full story', url: '' },
    ],
  },
  {
    key: 'launch', name: 'Launch', description: 'Image, headline, body, button.',
    blocks: () => [
      { ...newBlock('image'), url: '' },
      { ...newBlock('heading'), text: 'Introducing the thing', size: 'lg' },
      { ...newBlock('text'), text: 'What it is, in one paragraph. What changes for the reader, in a second.' },
      { ...newBlock('button'), text: 'Try it', url: '', align: 'left' },
    ],
  },
  {
    key: 'roundup', name: 'Roundup', description: 'An intro and a list of links.',
    blocks: () => [
      { ...newBlock('heading'), text: 'This month' },
      { ...newBlock('text'), text: 'A sentence on why this issue is worth the two minutes.' },
      { ...newBlock('items'), items: [
        { title: 'First thing', blurb: 'One line on why it matters.', url: '' },
        { title: 'Second thing', blurb: '', url: '' },
      ] },
    ],
  },
  {
    key: 'twoup', name: 'Two up', description: 'Headline, then two columns side by side.',
    blocks: () => [
      { ...newBlock('heading'), text: 'Two things at once' },
      { ...newBlock('columns'), columns: [
        { text: 'The left one.', label: 'Read more', url: '' },
        { text: 'The right one.', label: 'Read more', url: '' },
      ] },
      { ...newBlock('divider') },
      { ...newBlock('text'), text: 'And a closing line underneath.' },
    ],
  },
];

/**
 * Coerce anything block-shaped into blocks that will render.
 *
 * Used on every read — a row's `content` is free-form jsonb that an agent, an
 * import or an older client may have written — and on the AI drafter's reply,
 * which is untrusted in exactly the same way. Forgiving about shape, strict
 * about type: an unknown block type is dropped rather than rendered as nothing,
 * so the editor never shows a row that the email will not contain.
 */
export function normalizeBlocks(raw: any): EmailBlock[] {
  const known = new Set<string>(BLOCK_META.map((b) => b.type));
  const list = Array.isArray(raw) ? raw : [];
  const out: EmailBlock[] = [];
  for (const b of list.slice(0, 100)) {
    if (!b || !known.has(b.type)) continue;
    const base = newBlock(b.type as BlockType);
    out.push({
      ...base,
      id: typeof b.id === 'string' && b.id ? b.id.slice(0, 40) : base.id,
      text: typeof b.text === 'string' ? b.text.slice(0, 20_000) : base.text,
      url: typeof b.url === 'string' ? b.url.slice(0, 2000) : base.url,
      alt: typeof b.alt === 'string' ? b.alt.slice(0, 300) : base.alt,
      align: b.align === 'center' || b.align === 'right' ? b.align : base.align,
      size: b.size === 'sm' || b.size === 'md' || b.size === 'lg' ? b.size : base.size,
      attribution: typeof b.attribution === 'string' ? b.attribution.slice(0, 300) : base.attribution,
      columns: Array.isArray(b.columns)
        ? b.columns.slice(0, 2).map((c: any) => ({
            text: typeof c?.text === 'string' ? c.text.slice(0, 4000) : '',
            imageUrl: typeof c?.imageUrl === 'string' ? c.imageUrl.slice(0, 2000) : '',
            url: typeof c?.url === 'string' ? c.url.slice(0, 2000) : '',
            label: typeof c?.label === 'string' ? c.label.slice(0, 120) : '',
          }))
        : base.columns,
      items: Array.isArray(b.items)
        ? b.items.slice(0, 25).map((it: any) => ({
            title: typeof it?.title === 'string' ? it.title.slice(0, 300) : '',
            blurb: typeof it?.blurb === 'string' ? it.blurb.slice(0, 1000) : '',
            url: typeof it?.url === 'string' ? it.url.slice(0, 2000) : '',
          }))
        : base.items,
      html: typeof b.html === 'string' ? b.html.slice(0, 100_000) : base.html,
    });
  }
  return out;
}
