'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Info, MoreHorizontal, Search } from 'lucide-react';
import { contrast, contrastGrade, mix, readableOn } from '@/lib/design/color';
import { contrastRows, resolveRefs } from '@/lib/design/export';
import type { DesignTokens } from '@/lib/design/tokens';

/**
 * The brand, applied to something.
 *
 * ── A PALETTE IS NOT A DESIGN ───────────────────────────────────────────────
 * Nine hex swatches in a row always look fine. The same nine become a button
 * whose label cannot be read, a "surface" indistinguishable from the page, and
 * a warning colour that reads as decoration — and none of that is visible until
 * something real is drawn with them. So this renders the things anybody
 * actually makes: a marketing page, a product screen, the type at its real
 * sizes, and the components the spec declares.
 *
 * ── EVERYTHING IS INLINE STYLE, NOT A CLASS ─────────────────────────────────
 * Deliberately: the preview must show the USER'S brand, not ours, and one
 * inherited token from the app's own stylesheet would make it flattering
 * instead of accurate. The surrounding chrome uses app tokens; everything
 * inside the frame uses theirs and nothing else.
 *
 * ── A LEVEL, NOT A SIZE ─────────────────────────────────────────────────────
 * Every piece of text here takes a whole typography level — family, size,
 * weight, leading and tracking. Applying the pixel value alone was the previous
 * version's real defect: every heading rendered at weight 400 with default
 * leading, so a brand built on light 300-weight display type previewed
 * identically to one built on 700, and the preview quietly said they were the
 * same design.
 *
 * ── FONTS TELL THE TRUTH ────────────────────────────────────────────────────
 * A named font that is not installed silently renders as the fallback, so the
 * preview would show Helvetica and call it Söhne. `document.fonts.check` says
 * so out loud, and loading from Google is opt-in because it is a request to
 * somebody else's server that nothing else on this page makes.
 */

type Pane = 'site' | 'app' | 'type' | 'parts' | 'contrast';

const PANES: { id: Pane; label: string }[] = [
  { id: 'site', label: 'Page' },
  { id: 'app', label: 'Product' },
  { id: 'type', label: 'Type' },
  { id: 'parts', label: 'Parts' },
  { id: 'contrast', label: 'Contrast' },
];

/**
 * Fallbacks so an unfinished palette still draws.
 *
 * Each role accepts the spec's name first and the older one after it —
 * `primary` then `accent`, `on-primary` then a computed readable colour — so a
 * spec written before the DESIGN.md format landed still previews as itself
 * rather than as a grey wireframe of somebody's actual brand.
 */
function palette(t: DesignTokens) {
  const at = (n: string) => {
    const hit = t.colors.find((c) => c.name === n && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.hex));
    return hit ? hit.hex.toUpperCase() : undefined;
  };
  const pick = (names: string[], fb: string) => {
    for (const n of names) { const v = at(n); if (v) return v; }
    return fb;
  };
  const accent = pick(['primary', 'accent'], '#4F46E5');
  return {
    accent,
    onAccent: pick(['on-primary', 'on-accent'], readableOn(accent)),
    fg: pick(['foreground', 'text', 'ink'], '#0F1115'),
    muted: pick(['muted', 'secondary'], '#6B7280'),
    bg: pick(['background', 'page'], '#FFFFFF'),
    surface: pick(['surface', 'card'], '#F7F8FA'),
    border: pick(['border', 'divider'], '#E5E7EB'),
    success: pick(['success'], '#15803D'),
    warning: pick(['warning'], '#B45309'),
    danger: pick(['danger', 'error'], '#B91C1C'),
  };
}

const stack = (name: string | undefined, fb: string) => (name ? `"${name}", ${fb}` : fb);
const isHeading = (n: string) => /^h[1-6]$|^display|^title/i.test(n);

export default function DesignPreview({ tokens, logoUrl }: { tokens: DesignTokens; logoUrl?: string | null }) {
  const [pane, setPane] = useState<Pane>('site');
  const [webfonts, setWebfonts] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);

  const p = useMemo(() => palette(tokens), [tokens]);
  const head = stack(tokens.type.heading, 'system-ui, sans-serif');
  const body = stack(tokens.type.body, 'system-ui, sans-serif');
  const mono = stack(tokens.type.mono, 'ui-monospace, monospace');

  /** A whole typography level. Falls back only when the spec names none. */
  const lv = (names: string[], fb: { size: number; weight?: number; lh?: number; track?: string }): React.CSSProperties => {
    const levels = tokens.type.levels || [];
    const hit = names.map((n) => levels.find((l) => l.name === n)).find(Boolean);
    const heading = names.some(isHeading);
    return {
      fontFamily: hit?.fontFamily ? `"${hit.fontFamily}", sans-serif` : (heading ? head : body),
      fontSize: hit?.fontSize ?? fb.size,
      fontWeight: hit?.fontWeight ?? fb.weight ?? 400,
      lineHeight: hit?.lineHeight ?? fb.lh ?? 1.5,
      letterSpacing: hit?.letterSpacing ?? fb.track,
    };
  };
  const rad = (name: string, fb: number) => tokens.radius?.find((r) => r.name === name)?.px ?? fb;
  const step = (i: number, fb: number) => tokens.space.scale?.[i] ?? fb;
  const shade = (name: string) => {
    const e = tokens.elevation?.find((x) => x.name === name) ?? tokens.elevation?.[0];
    return e ? resolveRefs(e.value, tokens) : 'none';
  };

  const fonts = useMemo(
    () => [tokens.type.heading, tokens.type.body, tokens.type.mono].filter(Boolean) as string[],
    [tokens.type.heading, tokens.type.body, tokens.type.mono],
  );

  // Which named fonts this machine cannot actually render. Checked after a
  // frame so a just-loaded webfont is not reported missing.
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (typeof document === 'undefined' || !(document as any).fonts?.check) return;
      const gone = fonts.filter((f) => { try { return !(document as any).fonts.check(`16px "${f}"`); } catch { return false; } });
      if (!cancelled) setMissing(gone);
    };
    const id = window.setTimeout(run, 400);
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [fonts, webfonts]);

  // Opt-in, and only ever the families named in the tokens.
  useEffect(() => {
    if (!webfonts || !fonts.length) return;
    const href = `https://fonts.googleapis.com/css2?${fonts
      .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@300;400;500;600;700`)
      .join('&')}&display=swap`;
    const el = document.createElement('link');
    el.rel = 'stylesheet'; el.href = href;
    document.head.appendChild(el);
    return () => { el.remove(); };
  }, [webfonts, fonts]);

  const label = lv(['label', 'body-sm', 'body-md'], { size: 13, weight: 600 });

  const btn: React.CSSProperties = {
    ...label,
    background: p.accent, color: p.onAccent,
    borderRadius: rad('full', rad('md', 10)),
    padding: `${step(1, 8)}px ${step(3, 16)}px`,
    border: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
    boxShadow: shade('sm'), cursor: 'pointer',
  };
  const ghost: React.CSSProperties = {
    ...label, fontWeight: 500,
    background: 'transparent', color: p.fg,
    borderRadius: rad('full', rad('md', 10)),
    padding: `${step(1, 8)}px ${step(3, 16)}px`,
    border: `1px solid ${p.border}`,
  };

  const wordmark = logoUrl
    ? <img src={logoUrl} alt="" style={{ height: 28, width: 'auto', objectFit: 'contain' }} />
    : <span style={{ ...lv(['h3', 'h2'], { size: 20, weight: 600 }), color: p.fg }}>
        {tokens.brand.name || 'Your brand'}
      </span>;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 flex-wrap">
        {PANES.map((x) => (
          <button key={x.id} onClick={() => setPane(x.id)}
            className={`h-7 px-2.5 rounded-md text-2xs font-semibold ${pane === x.id
              ? 'bg-inverse text-inverse-fg' : 'text-secondary hover:bg-surface-hover'}`}>
            {x.label}
          </button>
        ))}
        <span className="flex-1" />
        {!!fonts.length && (
          <label className="inline-flex items-center gap-1.5 text-3xs text-tertiary cursor-pointer">
            <input type="checkbox" checked={webfonts} onChange={(e) => setWebfonts(e.target.checked)}
              className="h-3 w-3 accent-[hsl(var(--accent))]" />
            Load web fonts
          </label>
        )}
      </div>

      {!!missing.length && !webfonts && (
        <p className="text-3xs text-warning inline-flex items-start gap-1">
          <Info className="w-3 h-3 mt-px shrink-0" />
          {missing.join(', ')} {missing.length === 1 ? 'is' : 'are'} not installed here, so the preview is
          showing a fallback typeface. Tick the box to fetch from Google Fonts, or trust the name over the picture.
        </p>
      )}

      <div className="rounded-xl overflow-hidden ring-1 ring-subtle" style={{ background: p.bg }}>
        {pane === 'site' && (
          <div style={{ fontFamily: body, color: p.fg, padding: step(5, 32) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: step(3, 16), marginBottom: step(5, 32) }}>
              {wordmark}
              <span style={{ flex: 1 }} />
              {['Product', 'Pricing', 'Docs'].map((x) => (
                <span key={x} style={{ ...lv(['body-md'], { size: 15 }), color: p.muted }}>{x}</span>
              ))}
              <button style={btn}>Get started</button>
            </div>

            <h1 style={{ ...lv(['display', 'h1'], { size: 48, weight: 600, lh: 1.05, track: '-0.02em' }), margin: 0 }}>
              {tokens.brand.tagline || 'One sentence that says what you do.'}
            </h1>
            <p style={{ ...lv(['body-lg', 'body-md'], { size: 17, lh: 1.6 }), color: p.muted, maxWidth: 560, marginTop: step(2, 12) }}>
              {tokens.brand.description
                || 'The second line explains it to somebody who has never heard of you, in words they already use. Then it stops.'}
            </p>
            <div style={{ display: 'flex', gap: step(1, 8), marginTop: step(4, 24) }}>
              <button style={btn}>Start free <ArrowRight size={14} /></button>
              <button style={ghost}>Talk to us</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: step(2, 12), marginTop: step(6, 48) }}>
              {['Fast', 'Honest', 'Yours'].map((title, i) => (
                <div key={title} style={{
                  background: p.surface, border: `1px solid ${p.border}`,
                  borderRadius: rad('lg', 16), padding: step(3, 16), boxShadow: shade('md'),
                }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: rad('sm', 6),
                    background: mix(p.accent, p.surface, 0.82),
                    display: 'grid', placeItems: 'center', marginBottom: step(1, 8),
                  }}>
                    <Check size={15} color={p.accent} />
                  </div>
                  <div style={lv(['h3', 'h2'], { size: 17, weight: 600 })}>{title}</div>
                  <div style={{ ...lv(['body-md'], { size: 15, lh: 1.5 }), color: p.muted, marginTop: 2 }}>
                    {['No waiting around.', 'It says what it does.', 'Export everything.'][i]}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {pane === 'app' && (
          <div style={{ fontFamily: body, color: p.fg, display: 'flex', minHeight: 330 }}>
            <div style={{ width: 172, background: p.surface, borderRight: `1px solid ${p.border}`, padding: step(2, 12) }}>
              <div style={{ marginBottom: step(3, 16) }}>{wordmark}</div>
              {['Overview', 'Customers', 'Invoices', 'Settings'].map((x, i) => (
                <div key={x} style={{
                  ...lv(['body-md'], { size: 14 }),
                  padding: `6px ${step(1, 8)}px`, borderRadius: rad('sm', 6), marginBottom: 2,
                  fontWeight: i === 1 ? 600 : undefined,
                  background: i === 1 ? mix(p.accent, p.surface, 0.86) : 'transparent',
                  color: i === 1 ? p.accent : p.muted,
                }}>{x}</div>
              ))}
            </div>

            <div style={{ flex: 1, padding: step(3, 16), minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: step(1, 8), marginBottom: step(3, 16) }}>
                <h2 style={{ ...lv(['h2', 'h1'], { size: 20, weight: 600 }), margin: 0 }}>Customers</h2>
                <span style={{ flex: 1 }} />
                <div style={{
                  ...lv(['body-md'], { size: 14 }),
                  display: 'inline-flex', alignItems: 'center', gap: 6, height: 32,
                  padding: `0 ${step(1, 8)}px`, borderRadius: rad('md', 10),
                  border: `1px solid ${p.border}`, color: p.muted,
                }}>
                  <Search size={13} /> Search
                </div>
                <button style={{ ...btn, padding: `6px ${step(2, 12)}px` }}>New</button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: step(1, 8), marginBottom: step(3, 16) }}>
                {[['Revenue', '€128,400'], ['Open', '12'], ['Overdue', '3']].map(([k, v], i) => (
                  <div key={k} style={{
                    background: p.surface, border: `1px solid ${p.border}`,
                    borderRadius: rad('md', 10), padding: step(2, 12), boxShadow: shade('sm'),
                  }}>
                    <div style={{ ...lv(['label'], { size: 12, weight: 600, track: '0.04em' }), color: p.muted, textTransform: 'uppercase' }}>{k}</div>
                    <div style={{
                      ...lv(['mono-md', 'h3'], { size: 20, weight: 600 }),
                      fontFamily: mono, fontVariantNumeric: 'tabular-nums',
                      marginTop: 2, color: i === 2 ? p.danger : p.fg,
                    }}>{v}</div>
                  </div>
                ))}
              </div>

              <div style={{ border: `1px solid ${p.border}`, borderRadius: rad('md', 10), overflow: 'hidden' }}>
                {[['Northwind Ltd', 'Paid', p.success], ['Acme GmbH', 'Due soon', p.warning], ['Globex', 'Overdue', p.danger]].map(([n, st, c], i) => (
                  <div key={n} style={{
                    ...lv(['body-md'], { size: 14 }),
                    display: 'flex', alignItems: 'center', gap: step(1, 8), padding: `10px ${step(2, 12)}px`,
                    borderBottom: i < 2 ? `1px solid ${p.border}` : 'none',
                  }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: 999, background: mix(p.accent, p.bg, 0.8),
                      color: p.accent, display: 'grid', placeItems: 'center',
                      fontSize: 11, fontWeight: 600,
                    }}>{n[0]}</div>
                    <span style={{ flex: 1 }}>{n}</span>
                    <span style={{
                      fontSize: 12, fontWeight: 600, color: c,
                      background: mix(c, p.bg, 0.88), padding: '2px 8px', borderRadius: 999,
                    }}>{st}</span>
                    <MoreHorizontal size={15} color={p.muted} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {pane === 'type' && (
          <div style={{ padding: step(4, 24), fontFamily: body, color: p.fg }}>
            {(tokens.type.levels?.length ? tokens.type.levels : [{ name: 'body-md', fontSize: 16 }]).map((l) => (
              <div key={l.name} style={{ padding: '10px 0', borderBottom: `1px solid ${p.border}` }}>
                <div style={{ fontFamily: mono, fontSize: 10.5, color: p.muted, marginBottom: 4, letterSpacing: '0.02em' }}>
                  {l.name} · {l.fontSize}px
                  {'fontWeight' in l && (l as any).fontWeight ? ` · ${(l as any).fontWeight}` : ''}
                  {'lineHeight' in l && (l as any).lineHeight ? ` · ${(l as any).lineHeight}` : ''}
                  {'letterSpacing' in l && (l as any).letterSpacing ? ` · ${(l as any).letterSpacing}` : ''}
                  {(l as any).use ? ` — ${(l as any).use}` : ''}
                </div>
                <div style={{
                  fontFamily: (l as any).fontFamily ? `"${(l as any).fontFamily}", sans-serif` : (isHeading(l.name) ? head : body),
                  fontSize: l.fontSize,
                  fontWeight: (l as any).fontWeight ?? 400,
                  lineHeight: (l as any).lineHeight ?? 1.3,
                  letterSpacing: (l as any).letterSpacing,
                  overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                }}>
                  {l.fontSize >= 28 ? 'Design is how it works' : 'The quick brown fox jumps over the lazy dog'}
                </div>
              </div>
            ))}
          </div>
        )}

        {pane === 'parts' && (
          <div style={{ padding: step(3, 16), fontFamily: body, color: p.fg }}>
            {/* The components the spec declares, drawn from their own tokens.
                A `components` map nobody can see is a map nobody notices is
                wrong — and it is the section an agent copies most literally. */}
            {(tokens.components || []).length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: step(2, 12) }}>
                {tokens.components.map((c) => {
                  const prop = (k: string) => {
                    const v = c.props.find((x) => x.key.toLowerCase() === k.toLowerCase())?.value;
                    return v ? resolveRefs(v, tokens) : undefined;
                  };
                  const style: React.CSSProperties = {
                    background: prop('backgroundColor') || p.surface,
                    color: prop('textColor') || p.fg,
                    borderRadius: prop('rounded') || rad('md', 10),
                    padding: prop('padding') || `${step(2, 12)}px`,
                    border: prop('borderColor') ? `${prop('borderWidth') || '1px'} solid ${prop('borderColor')}` : `1px solid ${p.border}`,
                    boxShadow: prop('shadow') ? shade(prop('shadow')!) : undefined,
                    minHeight: prop('height'),
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    ...lv(['label', 'body-md'], { size: 14, weight: 600 }),
                  };
                  return (
                    <div key={c.name}>
                      <div style={{ fontFamily: mono, fontSize: 10.5, color: p.muted, marginBottom: 5 }}>{c.name}</div>
                      <div style={style}>{c.name.replace(/[-_]/g, ' ')}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ ...lv(['body-md'], { size: 14 }), color: p.muted }}>
                No components declared yet. A button described once is a button that looks the same
                everywhere — it is the section an agent copies most literally.
              </p>
            )}

            {!!tokens.elevation?.length && (
              <>
                <div style={{ fontFamily: mono, fontSize: 10.5, color: p.muted, margin: `${step(3, 16)}px 0 8px` }}>elevation</div>
                <div style={{ display: 'flex', gap: step(2, 12), flexWrap: 'wrap' }}>
                  {tokens.elevation.map((e) => (
                    <div key={e.name} style={{ textAlign: 'center' }}>
                      <div style={{
                        width: 76, height: 52, background: p.surface, border: `1px solid ${p.border}`,
                        borderRadius: rad('md', 10), boxShadow: resolveRefs(e.value, tokens),
                      }} />
                      <div style={{ fontFamily: mono, fontSize: 10, color: p.muted, marginTop: 6 }}>{e.name}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {!!tokens.radius?.length && (
              <>
                <div style={{ fontFamily: mono, fontSize: 10.5, color: p.muted, margin: `${step(3, 16)}px 0 8px` }}>shapes</div>
                <div style={{ display: 'flex', gap: step(2, 12), flexWrap: 'wrap' }}>
                  {tokens.radius.map((r) => (
                    <div key={r.name} style={{ textAlign: 'center' }}>
                      <div style={{
                        width: 52, height: 52, background: mix(p.accent, p.bg, 0.82),
                        border: `1px solid ${p.border}`, borderRadius: Math.min(r.px, 26),
                      }} />
                      <div style={{ fontFamily: mono, fontSize: 10, color: p.muted, marginTop: 6 }}>{r.name} {r.px}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {!!tokens.space.scale?.length && (
              <>
                <div style={{ fontFamily: mono, fontSize: 10.5, color: p.muted, margin: `${step(3, 16)}px 0 8px` }}>spacing</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                  {tokens.space.scale.map((n, i) => (
                    <div key={i} style={{ textAlign: 'center' }}>
                      <div style={{ width: Math.min(n, 64), height: Math.min(n, 64), background: p.accent, opacity: 0.85, borderRadius: 2 }} />
                      <div style={{ fontFamily: mono, fontSize: 9.5, color: p.muted, marginTop: 4 }}>{n}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {pane === 'contrast' && (
          <div style={{ padding: step(3, 16), fontFamily: body }}>
            {/* Real text on the real colour — a ratio in a table is a number,
                and the point is whether you can read it. */}
            {contrastRows(tokens).map((r, i) => {
              const ratio = contrast(r.fg, r.bg);
              const grade = contrastGrade(ratio);
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: step(1, 8), padding: '7px 10px',
                  background: r.bg, borderRadius: rad('sm', 6), marginBottom: 4,
                  border: `1px solid ${p.border}`,
                }}>
                  <span style={{ color: r.fg, fontSize: 14, flex: 1, minWidth: 0 }}>{r.label}</span>
                  <span style={{ fontFamily: mono, fontSize: 11, color: r.fg, opacity: 0.75 }}>{ratio.toFixed(2)}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', padding: '2px 6px', borderRadius: 999,
                    background: grade === 'Fail' ? '#DC2626' : grade === 'AAA' ? '#16A34A' : '#D97706', color: '#fff',
                  }}>{grade}</span>
                </div>
              );
            })}
            <p style={{ fontSize: 11, color: p.muted, marginTop: 8, lineHeight: 1.5 }}>
              WCAG 2.1: 4.5 for body text (AA), 7 for AAA. Large text — 24px, or 18.7px bold — passes AA at 3.
              A Fail here is a real one: it is the same arithmetic an auditor runs.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
