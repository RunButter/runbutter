'use client';

import { useState } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { presetsByGroup, presetTokens, type Preset } from '@/lib/design/presets';
import { readableOn } from '@/lib/design/color';
import type { DesignTokens } from '@/lib/design/tokens';

/**
 * Start from a style that already works.
 *
 * ── NOBODY TYPES A DESIGN SYSTEM FROM NOTHING ───────────────────────────────
 * Six type levels with tracking, a shadow scale and nine colour roles is an
 * afternoon of decisions, and the first one is the hardest. Designers work the
 * way everyone works: take something close and change what is wrong with it.
 * The skills editor learned the same lesson when it stopped opening a blank box.
 *
 * ── EACH CARD IS THE REAL THING, NOT A THUMBNAIL ────────────────────────────
 * The swatch row and the specimen line are rendered FROM the preset's own
 * tokens, so a card cannot show one thing and load another. A picture of a
 * style beside a style is two things to keep in step, and one of them always
 * loses.
 *
 * ── IT REPLACES, AND SAYS SO ────────────────────────────────────────────────
 * Picking a style overwrites the spec, which is the right behaviour and a
 * terrible surprise — so it asks once when there is real work to lose. The
 * brand NAME survives, because nobody meant to rename their company by
 * choosing a typeface.
 */

export default function PresetPicker({ current, onPick, dense }: {
  current: DesignTokens;
  onPick: (t: DesignTokens) => void;
  /** Collapsed by default, for the signed-in screen where it is not step one. */
  dense?: boolean;
}) {
  const [open, setOpen] = useState(!dense);
  const [confirming, setConfirming] = useState<Preset | null>(null);

  // "Real work" is a spec somebody has actually touched: more than the name.
  const hasWork = !!(current.colors.length || current.type.levels?.length || current.rules.dont.length);

  const take = (p: Preset) => {
    const next = presetTokens(p);
    if (current.brand.name?.trim()) next.brand.name = current.brand.name;
    onPick(next);
    setConfirming(null);
  };

  const choose = (p: Preset) => (hasWork ? setConfirming(p) : take(p));

  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-left">
        {open ? <ChevronDown className="w-3.5 h-3.5 text-tertiary" /> : <ChevronRight className="w-3.5 h-3.5 text-tertiary" />}
        <span className="text-sm font-medium text-primary">Start from a style</span>
        <span className="text-2xs text-tertiary">— then change what is wrong with it</span>
      </button>

      {open && (
        <div className="mt-2.5 flex flex-col gap-3">
          {presetsByGroup().map((g) => (
            <div key={g.group}>
              <p className="text-3xs font-semibold uppercase tracking-wide text-tertiary">{g.group}</p>
              <div className="mt-1.5 grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {g.items.map((p) => {
                  const t = p.tokens;
                  const at = (n: string) => t.colors.find((c) => c.name === n)?.hex;
                  const bg = at('background') || '#FFFFFF';
                  const fg = at('foreground') || '#111111';
                  const primary = at('primary') || at('accent') || '#4F46E5';
                  const display = t.type.levels?.find((l) => l.name === 'display') || t.type.levels?.[0];
                  return (
                    <button key={p.id} onClick={() => choose(p)}
                      className="text-left rounded-xl ring-1 ring-subtle overflow-hidden hover:ring-strong transition-shadow">
                      {/* Drawn from the preset's own tokens. A screenshot beside
                          a spec is two things to keep in step. */}
                      <div style={{ background: bg, padding: '14px 14px 12px' }}>
                        <div style={{
                          fontFamily: t.type.heading ? `"${t.type.heading}", sans-serif` : 'system-ui, sans-serif',
                          fontSize: 21, fontWeight: display?.fontWeight ?? 600,
                          letterSpacing: display?.letterSpacing, lineHeight: 1.05, color: fg,
                        }}>
                          {p.label}
                        </div>
                        <div style={{
                          fontFamily: t.type.body ? `"${t.type.body}", sans-serif` : 'system-ui, sans-serif',
                          fontSize: 11.5, color: at('muted') || '#6B7280', marginTop: 4, lineHeight: 1.45,
                        }}>
                          {t.brand.tagline}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                          <span style={{
                            background: primary, color: at('on-primary') || readableOn(primary),
                            fontSize: 10, fontWeight: 600, padding: '4px 10px',
                            borderRadius: t.radius.find((r) => r.name === 'full')?.px ?? t.radius[1]?.px ?? 8,
                            border: at('border') === fg ? `2px solid ${fg}` : 'none',
                            boxShadow: t.elevation[0]?.value?.includes('{') ? undefined : t.elevation[0]?.value,
                          }}>
                            Button
                          </span>
                          <span style={{ display: 'flex', gap: 3 }}>
                            {t.colors.slice(0, 6).map((c) => (
                              <span key={c.name} style={{
                                width: 12, height: 12, borderRadius: 3, background: c.hex,
                                boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / 0.08)',
                              }} />
                            ))}
                          </span>
                        </div>
                      </div>
                      <div className="px-3 py-2 bg-surface-sunken">
                        <p className="text-2xs text-primary leading-snug">{p.essence}</p>
                        <p className="mt-0.5 text-2xs text-tertiary leading-snug">{p.blurb}</p>
                        <p className="mt-1 text-3xs text-tertiary font-mono truncate">
                          {[t.type.heading, t.type.body].filter(Boolean).join(' · ')}
                          {t.type.levels?.length ? ` · ${t.type.levels.length} levels` : ''}
                          {t.elevation.length ? ` · ${t.elevation.length} shadows` : ' · no shadows'}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {confirming && (
        <div className="mt-2 rounded-lg bg-warning/10 ring-1 ring-warning/30 p-3">
          <p className="text-2xs text-secondary">
            Loading <b className="text-primary">{confirming.label}</b> replaces the colours, type,
            spacing, components and rules you have now. Your brand name stays.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => take(confirming)}
              className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md text-2xs font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">
              <Check className="w-3 h-3" /> Replace
            </button>
            <button onClick={() => setConfirming(null)}
              className="h-7 px-2.5 rounded-md text-2xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-hover">
              Keep mine
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
