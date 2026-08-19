'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Info, MoreHorizontal, Search } from 'lucide-react';
import { contrast, contrastGrade, mix, readableOn } from '@/lib/design/color';
import { contrastRows } from '@/lib/design/export';
import type { DesignTokens } from '@/lib/design/tokens';

/**
 * The brand, applied to something.
 *
 * ── A PALETTE IS NOT A DESIGN ───────────────────────────────────────────────
 * Nine hex swatches in a row always look fine. The same nine become a button
 * whose label cannot be read, a "surface" indistinguishable from the page, and
 * a warning colour that reads as decoration — and none of that is visible until
 * something real is drawn with them. So this renders the two things anybody
 * actually makes: a marketing page and a product screen.
 *
 * ── EVERYTHING IS INLINE STYLE, NOT A CLASS ─────────────────────────────────
 * Deliberately: the preview must show the USER'S brand, not ours, and one
 * inherited token from the app's own stylesheet would make it flattering
 * instead of accurate. The surrounding chrome uses app tokens; everything
 * inside the frame uses theirs and nothing else.
 *
 * ── FONTS TELL THE TRUTH ────────────────────────────────────────────────────
 * A named font that is not installed silently renders as the fallback, so the
 * preview would show Helvetica and call it Söhne. `document.fonts.check` says
 * so out loud, and loading from Google is opt-in because it is a request to
 * somebody else's server that nothing else on this page makes.
 */

type Pane = 'site' | 'app' | 'type' | 'contrast';

const PANES: { id: Pane; label: string }[] = [
  { id: 'site', label: 'Page' },
  { id: 'app', label: 'Product' },
  { id: 'type', label: 'Type' },
  { id: 'contrast', label: 'Contrast' },
];

/** Fallbacks so an unfinished palette still draws. Reported, never hidden. */
function palette(t: DesignTokens) {
  const get = (n: string, fb: string) => {
    const hit = t.colors.find((c) => c.name === n && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.hex));
    return { hex: hit ? hit.hex.toUpperCase() : fb, real: !!hit };
  };
  return {
    accent: get('accent', '#6366F1'),
    fg: get('foreground', '#111114'),
    muted: get('muted', '#6B7280'),
    bg: get('background', '#FFFFFF'),
    surface: get('surface', '#F7F7F8'),
    border: get('border', '#E5E7EB'),
    success: get('success', '#16A34A'),
    warning: get('warning', '#D97706'),
    danger: get('danger', '#DC2626'),
  };
}

const stack = (name: string | undefined, fb: string) => (name ? `"${name}", ${fb}` : fb);

export default function DesignPreview({ tokens, logoUrl }: { tokens: DesignTokens; logoUrl?: string | null }) {
  const [pane, setPane] = useState<Pane>('site');
  const [webfonts, setWebfonts] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);

  const p = useMemo(() => palette(tokens), [tokens]);
  const head = stack(tokens.type.heading, 'system-ui, sans-serif');
  const body = stack(tokens.type.body, 'system-ui, sans-serif');
  const mono = stack(tokens.type.mono, 'ui-monospace, monospace');

  const size = (name: string, fb: number) => tokens.type.scale?.find((s) => s.name === name)?.px ?? fb;
  const rad = (name: string, fb: number) => tokens.radius?.find((r) => r.name === name)?.px ?? fb;
  const step = (i: number, fb: number) => tokens.space.scale?.[i] ?? fb;

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
    const id = window.setTimeout(run, 300);
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [fonts, webfonts]);

  // Opt-in, and only ever the families named in the tokens.
  useEffect(() => {
    if (!webfonts || !fonts.length) return;
    const href = `https://fonts.googleapis.com/css2?${fonts
      .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`)
      .join('&')}&display=swap`;
    const el = document.createElement('link');
    el.rel = 'stylesheet'; el.href = href;
    document.head.appendChild(el);
    return () => { el.remove(); };
  }, [webfonts, fonts]);

  const btn = {
    background: p.accent.hex, color: readableOn(p.accent.hex),
    borderRadius: rad('md', 10), fontFamily: body, fontSize: size('sm', 14),
    fontWeight: 600, padding: `${step(1, 8)}px ${step(3, 16)}px`,
    border: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
  } as const;

  const ghost = {
    background: 'transparent', color: p.fg.hex, borderRadius: rad('md', 10),
    fontFamily: body, fontSize: size('sm', 14), fontWeight: 500,
    padding: `${step(1, 8)}px ${step(3, 16)}px`, border: `1px solid ${p.border.hex}`,
  } as const;

  const wordmark = logoUrl
    ? <img src={logoUrl} alt="" style={{ height: 28, width: 'auto', objectFit: 'contain' }} />
    : <span style={{ fontFamily: head, fontSize: size('lg', 20), fontWeight: 600, color: p.fg.hex }}>
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
            Load web fonts from Google
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

      <div className="rounded-xl overflow-hidden ring-1 ring-subtle" style={{ background: p.bg.hex }}>
        {pane === 'site' && (
          <div style={{ fontFamily: body, color: p.fg.hex, padding: step(5, 32) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: step(3, 16), marginBottom: step(5, 32) }}>
              {wordmark}
              <span style={{ flex: 1 }} />
              {['Product', 'Pricing', 'Docs'].map((x) => (
                <span key={x} style={{ fontSize: size('sm', 14), color: p.muted.hex }}>{x}</span>
              ))}
              <button style={btn as any}>Get started</button>
            </div>

            <h1 style={{ fontFamily: head, fontSize: size('3xl', 44), lineHeight: 1.1, fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>
              {tokens.brand.tagline || 'One sentence that says what you do.'}
            </h1>
            <p style={{ fontSize: size('base', 16), color: p.muted.hex, maxWidth: 520, marginTop: step(2, 12), lineHeight: 1.6 }}>
              The second line explains it to somebody who has never heard of you, in words they
              already use. Then it stops.
            </p>
            <div style={{ display: 'flex', gap: step(1, 8), marginTop: step(4, 24) }}>
              <button style={btn as any}>Start free <ArrowRight size={14} /></button>
              <button style={ghost as any}>Talk to us</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: step(2, 12), marginTop: step(6, 48) }}>
              {['Fast', 'Honest', 'Yours'].map((title, i) => (
                <div key={title} style={{
                  background: p.surface.hex, border: `1px solid ${p.border.hex}`,
                  borderRadius: rad('lg', 16), padding: step(3, 16),
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: rad('sm', 6),
                    background: mix(p.accent.hex, p.surface.hex, 0.82),
                    display: 'grid', placeItems: 'center', marginBottom: step(1, 8),
                  }}>
                    <Check size={14} color={p.accent.hex} />
                  </div>
                  <div style={{ fontFamily: head, fontSize: size('base', 16), fontWeight: 600 }}>{title}</div>
                  <div style={{ fontSize: size('sm', 14), color: p.muted.hex, marginTop: 2, lineHeight: 1.5 }}>
                    {['No waiting around.', 'It says what it does.', 'Export everything.'][i]}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {pane === 'app' && (
          <div style={{ fontFamily: body, color: p.fg.hex, display: 'flex', minHeight: 320 }}>
            <div style={{ width: 168, background: p.surface.hex, borderRight: `1px solid ${p.border.hex}`, padding: step(2, 12) }}>
              <div style={{ marginBottom: step(3, 16) }}>{wordmark}</div>
              {['Overview', 'Customers', 'Invoices', 'Settings'].map((x, i) => (
                <div key={x} style={{
                  fontSize: size('sm', 14), padding: `6px ${step(1, 8)}px`, borderRadius: rad('sm', 6),
                  marginBottom: 2, fontWeight: i === 1 ? 600 : 400,
                  background: i === 1 ? mix(p.accent.hex, p.surface.hex, 0.86) : 'transparent',
                  color: i === 1 ? p.accent.hex : p.muted.hex,
                }}>{x}</div>
              ))}
            </div>

            <div style={{ flex: 1, padding: step(3, 16), minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: step(1, 8), marginBottom: step(3, 16) }}>
                <h2 style={{ fontFamily: head, fontSize: size('lg', 20), fontWeight: 600, margin: 0 }}>Customers</h2>
                <span style={{ flex: 1 }} />
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, height: 30,
                  padding: `0 ${step(1, 8)}px`, borderRadius: rad('md', 10),
                  border: `1px solid ${p.border.hex}`, color: p.muted.hex, fontSize: size('sm', 14),
                }}>
                  <Search size={13} /> Search
                </div>
                <button style={{ ...btn, padding: `6px ${step(2, 12)}px` } as any}>New</button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: step(1, 8), marginBottom: step(3, 16) }}>
                {[['Revenue', '€128,400'], ['Open', '12'], ['Overdue', '3']].map(([k, v], i) => (
                  <div key={k} style={{
                    background: p.surface.hex, border: `1px solid ${p.border.hex}`,
                    borderRadius: rad('md', 10), padding: step(2, 12),
                  }}>
                    <div style={{ fontSize: size('xs', 12), color: p.muted.hex, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</div>
                    <div style={{ fontFamily: mono, fontSize: size('lg', 20), fontWeight: 600, marginTop: 2, color: i === 2 ? p.danger.hex : p.fg.hex }}>{v}</div>
                  </div>
                ))}
              </div>

              <div style={{ border: `1px solid ${p.border.hex}`, borderRadius: rad('md', 10), overflow: 'hidden' }}>
                {[['Northwind Ltd', 'Paid', p.success.hex], ['Acme GmbH', 'Due soon', p.warning.hex], ['Globex', 'Overdue', p.danger.hex]].map(([n, s, c], i) => (
                  <div key={n as string} style={{
                    display: 'flex', alignItems: 'center', gap: step(1, 8), padding: `10px ${step(2, 12)}px`,
                    borderBottom: i < 2 ? `1px solid ${p.border.hex}` : 'none', fontSize: size('sm', 14),
                  }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: 999, background: mix(p.accent.hex, p.bg.hex, 0.8),
                      color: p.accent.hex, display: 'grid', placeItems: 'center',
                      fontSize: size('xs', 12), fontWeight: 600,
                    }}>{(n as string)[0]}</div>
                    <span style={{ flex: 1 }}>{n}</span>
                    <span style={{
                      fontSize: size('xs', 12), fontWeight: 600, color: c as string,
                      background: mix(c as string, p.bg.hex, 0.88), padding: '2px 8px', borderRadius: 999,
                    }}>{s}</span>
                    <MoreHorizontal size={15} color={p.muted.hex} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {pane === 'type' && (
          <div style={{ padding: step(4, 24), fontFamily: body, color: p.fg.hex }}>
            {(tokens.type.scale?.length ? tokens.type.scale : [{ name: 'base', px: 16 }]).slice().reverse().map((s) => (
              <div key={s.name} style={{ display: 'flex', alignItems: 'baseline', gap: step(2, 12), padding: '6px 0', borderBottom: `1px solid ${p.border.hex}` }}>
                <span style={{ width: 76, flexShrink: 0, fontFamily: mono, fontSize: 11, color: p.muted.hex }}>
                  {s.name} · {s.px}
                </span>
                <span style={{ fontFamily: s.px >= 20 ? head : body, fontSize: s.px, lineHeight: 1.2, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  The quick brown fox
                </span>
              </div>
            ))}
            {!!tokens.type.weights?.length && (
              <div style={{ marginTop: step(3, 16) }}>
                {tokens.type.weights.map((w) => (
                  <div key={w.name} style={{ display: 'flex', alignItems: 'baseline', gap: step(2, 12), padding: '4px 0' }}>
                    <span style={{ width: 76, flexShrink: 0, fontFamily: mono, fontSize: 11, color: p.muted.hex }}>{w.name} · {w.value}</span>
                    <span style={{ fontFamily: head, fontSize: size('base', 16), fontWeight: w.value }}>Hierarchy from size and colour first</span>
                  </div>
                ))}
              </div>
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
                  border: `1px solid ${p.border.hex}`,
                }}>
                  <span style={{ color: r.fg, fontSize: size('sm', 14), flex: 1, minWidth: 0 }}>{r.label}</span>
                  <span style={{ fontFamily: mono, fontSize: 11, color: r.fg, opacity: 0.75 }}>{ratio.toFixed(2)}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', padding: '2px 6px', borderRadius: 999,
                    background: grade === 'Fail' ? '#DC2626' : grade === 'AAA' ? '#16A34A' : '#D97706', color: '#fff',
                  }}>{grade}</span>
                </div>
              );
            })}
            <p style={{ fontSize: 11, color: p.muted.hex, marginTop: 8, lineHeight: 1.5 }}>
              WCAG 2.1: 4.5 for body text (AA), 7 for AAA. Large text — 24px, or 18.7px bold — passes AA at 3.
              A Fail here is a real one: it is the same arithmetic an auditor runs.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
