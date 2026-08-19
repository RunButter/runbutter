'use client';

import { useState } from 'react';
import { Plus, Trash2, Wand2, X } from 'lucide-react';
import { shades } from '@/lib/design/color';
import type { DesignTokens, Swatch } from '@/lib/design/tokens';

/**
 * Every value in the spec, on one screen.
 *
 * ── NOTHING IS BEHIND A DISCLOSURE ──────────────────────────────────────────
 * A design spec is not a settings page: the whole point is to see the palette,
 * the scale and the rules at once, because they only make sense against each
 * other. Panels that hide two of the three turn "does this scale fit this
 * type?" into a memory test.
 *
 * The exception is per-colour shade generation, which is an ACTION rather than
 * a value — it appears when you ask for it and writes real rows you then edit.
 */

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const field = 'h-8 px-2.5 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary placeholder:text-tertiary';

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card-surface p-4">
      <h2 className="text-sm font-medium text-primary">{title}</h2>
      {hint && <p className="mt-0.5 text-2xs text-tertiary">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A list of sentences: the shape voice and rules both take. */
function StringList({ label, hint, items, onChange, placeholder }: {
  label: string; hint?: string; items: string[]; placeholder: string;
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = () => { const v = draft.trim(); if (!v) return; onChange([...items, v]); setDraft(''); };
  return (
    <div>
      <p className="text-3xs font-semibold uppercase tracking-wide text-tertiary">{label}</p>
      {hint && <p className="text-3xs text-tertiary/90 mt-0.5">{hint}</p>}
      <div className="mt-1.5 flex flex-col gap-1">
        {items.map((v, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <input value={v} aria-label={`${label} ${i + 1}`}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
              className={`${field} flex-1 min-w-0`} />
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove"
              className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10 shrink-0">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex items-center gap-1.5">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder}
            aria-label={`Add to ${label}`} className={`${field} flex-1 min-w-0`} />
          <button type="submit" aria-label={`Add to ${label}`}
            className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover shrink-0"><Plus className="w-4 h-4" /></button>
        </form>
      </div>
    </div>
  );
}

/** Comma-separated words, which is how anybody types a tone of voice. */
function Chips({ label, hint, items, onChange, placeholder }: {
  label: string; hint?: string; items: string[]; placeholder: string; onChange: (v: string[]) => void;
}) {
  return (
    <div>
      <p className="text-3xs font-semibold uppercase tracking-wide text-tertiary">{label}</p>
      {hint && <p className="text-3xs text-tertiary/90 mt-0.5">{hint}</p>}
      <input value={items.join(', ')} placeholder={placeholder} aria-label={label}
        onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
        className={`${field} mt-1.5 w-full`} />
    </div>
  );
}

export default function TokenEditor({ t, set }: {
  t: DesignTokens;
  set: (fn: (prev: DesignTokens) => DesignTokens) => void;
}) {
  const [ramp, setRamp] = useState<string | null>(null);

  const setColors = (colors: Swatch[]) => set((p) => ({ ...p, colors }));
  const patchColor = (i: number, patch: Partial<Swatch>) =>
    setColors(t.colors.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const applyRamp = (c: Swatch) => {
    const rows = shades(c.hex).map((s) => ({ name: `${c.name}-${s.name}`, hex: s.hex, use: '' }));
    // The source colour keeps its own row and its own name. Replacing it with
    // `accent-900` would rename the one token everything else refers to.
    setColors([...t.colors, ...rows.filter((r) => !t.colors.some((x) => x.name === r.name))]);
    setRamp(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <Section title="Brand" hint="The name every heading in the exported file uses, and the one line that says what you do.">
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="block">
            <span className="text-3xs text-tertiary">Name</span>
            <input value={t.brand.name} placeholder="Acme"
              onChange={(e) => set((p) => ({ ...p, brand: { ...p.brand, name: e.target.value } }))}
              className={`${field} mt-0.5 w-full`} />
          </label>
          <label className="block">
            <span className="text-3xs text-tertiary">Tagline</span>
            <input value={t.brand.tagline || ''} placeholder="One sentence that says what you do."
              onChange={(e) => set((p) => ({ ...p, brand: { ...p.brand, tagline: e.target.value } }))}
              className={`${field} mt-0.5 w-full`} />
          </label>
        </div>
      </Section>

      <Section title="Colour"
        hint="A role, a hex, and what it is for. The third column is the one an agent actually reads — “Primary actions” tells it something “blue” never will.">
        <div className="flex flex-col gap-1.5">
          {t.colors.map((c, i) => (
            <div key={i}>
              <div className="flex items-center gap-1.5">
                <input type="color" value={HEX.test(c.hex) ? (c.hex.length === 4 ? `#${c.hex[1]}${c.hex[1]}${c.hex[2]}${c.hex[2]}${c.hex[3]}${c.hex[3]}` : c.hex) : '#000000'}
                  onChange={(e) => patchColor(i, { hex: e.target.value.toUpperCase() })}
                  aria-label={`${c.name} colour`}
                  className="w-8 h-8 rounded-lg ring-1 ring-subtle shrink-0 bg-transparent cursor-pointer p-0.5" />
                <input value={c.name} onChange={(e) => patchColor(i, { name: e.target.value })}
                  aria-label={`Name for colour ${i + 1}`} placeholder="accent"
                  className={`${field} w-28 shrink-0`} />
                <input value={c.hex} onChange={(e) => patchColor(i, { hex: e.target.value })}
                  aria-label={`Hex for ${c.name}`} placeholder="#6366F1"
                  className={`${field} w-24 shrink-0 font-mono text-2xs ${HEX.test(c.hex) ? '' : 'ring-danger/50'}`} />
                <input value={c.use || ''} onChange={(e) => patchColor(i, { use: e.target.value })}
                  aria-label={`What ${c.name} is for`} placeholder="Use it for…"
                  className={`${field} flex-1 min-w-0`} />
                <button onClick={() => setRamp(ramp === c.name ? null : c.name)} aria-label={`Shades of ${c.name}`}
                  className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover shrink-0"><Wand2 className="w-3.5 h-3.5" /></button>
                <button onClick={() => setColors(t.colors.filter((_, j) => j !== i))} aria-label={`Remove ${c.name}`}
                  className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              {ramp === c.name && HEX.test(c.hex) && (
                <div className="mt-1.5 ml-9 rounded-lg bg-surface-sunken ring-1 ring-subtle p-2">
                  <div className="flex gap-0.5">
                    {shades(c.hex).map((s) => (
                      <div key={s.name} className="flex-1 text-center">
                        <div className="h-7 rounded ring-1 ring-subtle" style={{ background: s.hex }} title={s.hex} />
                        <span className="text-3xs text-tertiary">{s.name}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-1.5 text-3xs text-tertiary">
                    <b className="text-secondary">{c.hex.toUpperCase()}</b> stays exactly as it is — the step nearest its
                    lightness is replaced with it rather than approximated.
                  </p>
                  <button onClick={() => applyRamp(c)}
                    className="mt-1.5 h-7 px-2.5 rounded-md text-2xs font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">
                    Add these ten
                  </button>
                </div>
              )}
            </div>
          ))}
          <button onClick={() => setColors([...t.colors, { name: '', hex: '#000000', use: '' }])}
            className="self-start h-7 px-2.5 inline-flex items-center gap-1 rounded-md text-2xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-hover">
            <Plus className="w-3 h-3" /> Add a colour
          </button>
        </div>
      </Section>

      <Section title="Type" hint="Name the families even if the machine reading this cannot render them — the name is what a designer needs and a model can look up.">
        <div className="grid sm:grid-cols-3 gap-2">
          {(['heading', 'body', 'mono'] as const).map((slot) => (
            <label key={slot} className="block">
              <span className="text-3xs text-tertiary capitalize">{slot}</span>
              <input value={t.type[slot] || ''} placeholder={slot === 'mono' ? 'JetBrains Mono' : 'Inter'}
                onChange={(e) => set((p) => ({ ...p, type: { ...p.type, [slot]: e.target.value } }))}
                className={`${field} mt-0.5 w-full`} />
            </label>
          ))}
        </div>

        <p className="mt-3 text-3xs font-semibold uppercase tracking-wide text-tertiary">Scale</p>
        <p className="text-3xs text-tertiary/90">Sizes come from here. A one-off pixel value is how a scale stops being one.</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(t.type.scale || []).map((s, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-surface-sunken ring-1 ring-subtle px-1.5 py-1">
              <input value={s.name} aria-label={`Step ${i + 1} name`}
                onChange={(e) => set((p) => ({ ...p, type: { ...p.type, scale: (p.type.scale || []).map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) } }))}
                className="w-12 bg-transparent text-2xs text-primary outline-none" />
              <input type="number" value={s.px} aria-label={`Step ${i + 1} size`}
                onChange={(e) => set((p) => ({ ...p, type: { ...p.type, scale: (p.type.scale || []).map((x, j) => (j === i ? { ...x, px: +e.target.value || 0 } : x)) } }))}
                className="w-11 bg-transparent text-2xs text-secondary font-mono outline-none tabular-nums" />
              <button aria-label={`Remove ${s.name}`} className="text-tertiary hover:text-danger"
                onClick={() => set((p) => ({ ...p, type: { ...p.type, scale: (p.type.scale || []).filter((_, j) => j !== i) } }))}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button onClick={() => set((p) => ({ ...p, type: { ...p.type, scale: [...(p.type.scale || []), { name: 'new', px: 16 }] } }))}
            className="h-7 px-2 inline-flex items-center gap-1 rounded-lg text-2xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-hover">
            <Plus className="w-3 h-3" /> Step
          </button>
        </div>

        <p className="mt-3 text-3xs font-semibold uppercase tracking-wide text-tertiary">Weights</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(t.type.weights || []).map((w, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-surface-sunken ring-1 ring-subtle px-1.5 py-1">
              <input value={w.name} aria-label={`Weight ${i + 1} name`}
                onChange={(e) => set((p) => ({ ...p, type: { ...p.type, weights: (p.type.weights || []).map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) } }))}
                className="w-16 bg-transparent text-2xs text-primary outline-none" />
              <input type="number" step={100} value={w.value} aria-label={`Weight ${i + 1} value`}
                onChange={(e) => set((p) => ({ ...p, type: { ...p.type, weights: (p.type.weights || []).map((x, j) => (j === i ? { ...x, value: +e.target.value || 400 } : x)) } }))}
                className="w-11 bg-transparent text-2xs text-secondary font-mono outline-none tabular-nums" />
              <button aria-label={`Remove ${w.name}`} className="text-tertiary hover:text-danger"
                onClick={() => set((p) => ({ ...p, type: { ...p.type, weights: (p.type.weights || []).filter((_, j) => j !== i) } }))}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button onClick={() => set((p) => ({ ...p, type: { ...p.type, weights: [...(p.type.weights || []), { name: 'bold', value: 700 }] } }))}
            className="h-7 px-2 inline-flex items-center gap-1 rounded-lg text-2xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-hover">
            <Plus className="w-3 h-3" /> Weight
          </button>
        </div>
      </Section>

      <Section title="Space and shape" hint="A rhythm and a corner. Two numbers that decide more of how something feels than any colour does.">
        <div className="flex items-end gap-3 flex-wrap">
          <label className="block">
            <span className="text-3xs text-tertiary">Base unit (px)</span>
            <input type="number" value={t.space.base ?? ''} placeholder="4" aria-label="Base spacing unit"
              onChange={(e) => set((p) => ({ ...p, space: { ...p.space, base: +e.target.value || undefined } }))}
              className={`${field} mt-0.5 w-20 tabular-nums`} />
          </label>
          <label className="block flex-1 min-w-[14rem]">
            <span className="text-3xs text-tertiary">Steps (px, comma separated)</span>
            <input value={(t.space.scale || []).join(', ')} placeholder="4, 8, 12, 16, 24, 32, 48, 64"
              aria-label="Spacing steps"
              onChange={(e) => set((p) => ({ ...p, space: { ...p.space, scale: e.target.value.split(',').map((n) => +n.trim()).filter((n) => Number.isFinite(n) && n >= 0) } }))}
              className={`${field} mt-0.5 w-full font-mono text-2xs`} />
          </label>
        </div>

        <p className="mt-3 text-3xs font-semibold uppercase tracking-wide text-tertiary">Corner radius</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(t.radius || []).map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-surface-sunken ring-1 ring-subtle px-1.5 py-1">
              <span className="w-5 h-5 bg-inverse/10 ring-1 ring-subtle shrink-0" style={{ borderRadius: Math.min(r.px, 12) }} />
              <input value={r.name} aria-label={`Radius ${i + 1} name`}
                onChange={(e) => set((p) => ({ ...p, radius: p.radius.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))}
                className="w-10 bg-transparent text-2xs text-primary outline-none" />
              <input type="number" value={r.px} aria-label={`Radius ${i + 1} size`}
                onChange={(e) => set((p) => ({ ...p, radius: p.radius.map((x, j) => (j === i ? { ...x, px: +e.target.value || 0 } : x)) }))}
                className="w-12 bg-transparent text-2xs text-secondary font-mono outline-none tabular-nums" />
              <button aria-label={`Remove ${r.name}`} className="text-tertiary hover:text-danger"
                onClick={() => set((p) => ({ ...p, radius: p.radius.filter((_, j) => j !== i) }))}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button onClick={() => set((p) => ({ ...p, radius: [...p.radius, { name: 'md', px: 10 }] }))}
            className="h-7 px-2 inline-flex items-center gap-1 rounded-lg text-2xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-hover">
            <Plus className="w-3 h-3" /> Radius
          </button>
        </div>
      </Section>

      <Section title="Voice" hint="The part no PDF carries and no model can infer. It is also the part that makes generated copy sound like you rather than like everyone.">
        <div className="flex flex-col gap-3">
          <Chips label="We sound" hint="A few words, comma separated." placeholder="plain, direct, warm, never breathless"
            items={t.voice.tone || []} onChange={(v) => set((p) => ({ ...p, voice: { ...p.voice, tone: v } }))} />
          <StringList label="We say" hint="Real phrases, exactly as they appear in the product."
            placeholder="Get started" items={t.voice.weSay || []}
            onChange={(v) => set((p) => ({ ...p, voice: { ...p.voice, weSay: v } }))} />
          <StringList label="We never say" hint="The words that make you sound like a press release."
            placeholder="Effortlessly" items={t.voice.weNeverSay || []}
            onChange={(v) => set((p) => ({ ...p, voice: { ...p.voice, weNeverSay: v } }))} />
        </div>
      </Section>

      <Section title="Rules" hint="Judgement, written down. This is the half of a brand a palette cannot hold.">
        <div className="flex flex-col gap-3">
          <StringList label="How to use it" placeholder="Use one accent colour per screen."
            items={t.rules.do} onChange={(v) => set((p) => ({ ...p, rules: { ...p.rules, do: v } }))} />
          <StringList label="Never" hint="Last in the file and blunt on purpose — a rule buried mid-paragraph is one an agent averages away."
            placeholder="Never invent a colour that is not in the palette."
            items={t.rules.dont} onChange={(v) => set((p) => ({ ...p, rules: { ...p.rules, dont: v } }))} />
        </div>
      </Section>
    </div>
  );
}
