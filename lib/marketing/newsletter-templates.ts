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

export type TemplateKey = 'plain' | 'announcement' | 'digest';

export interface Brand {
  name: string;
  logoUrl?: string | null;
  accent?: string | null;     // hex, e.g. #10b981
  address?: string | null;    // physical address — legally required in most bulk email
  footer?: string | null;
}

export interface DigestItem { title: string; blurb?: string; url?: string }

export interface NewsletterContent {
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
     ${items.map((it) => {
       const u = safeUrl(it.url);
       const title = u
         ? `<a href="${esc(track(u))}" style="color:${accent};text-decoration:none;">${esc(it.title)}</a>`
         : esc(it.title);
       return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
         <tr><td style="padding:0 0 14px;border-bottom:1px solid ${LINE};">
           <div style="font-size:17px;line-height:24px;font-weight:600;color:${INK};margin:0 0 4px;">${title}</div>
           ${it.blurb ? `<div style="font-size:15px;line-height:23px;color:${MUTED};">${esc(it.blurb)}</div>` : ''}
         </td></tr></table>`;
     }).join('')}`,
    ctx,
  );
}

export function renderNewsletter(template: TemplateKey, ctx: RenderCtx): string {
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
];
