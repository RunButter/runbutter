'use client';

import { useState } from 'react';
import {
  Plus, Trash2, Copy, ChevronUp, ChevronDown, X, Palette,
  Heading1, Type, Image as ImageIcon, MousePointerClick, Columns2,
  CircleUser, Minus, MoveVertical, Code2,
} from 'lucide-react';
import {
  DOC_BLOCK_META, DOC_PRESETS, FONT_FAMILIES,
  addBlock, removeBlock, moveBlock, duplicateBlock, patchBlock, patchRoot, rootChildren, ROOT,
  type EmailDoc, type DocBlockType,
} from '@/lib/marketing/email-doc';

/**
 * The visual email builder.
 *
 * The document and the HTML come from EmailBuilder.js (MIT); this is the part
 * we own — a block list, a properties panel, and the design controls for the
 * canvas itself. Their editor is Material-UI and would have brought a second
 * design system into an app that already has one, so only their renderer is
 * used.
 *
 * SELECTION IS THE WHOLE INTERACTION. One block is selected; its properties are
 * the panel. That is what keeps this from becoming twenty stacked forms, which
 * is what the previous editor was and the reason this exists.
 */

const ICON: Record<string, any> = {
  Heading: Heading1, Text: Type, Image: ImageIcon, Button: MousePointerClick,
  ColumnsContainer: Columns2, Avatar: CircleUser, Divider: Minus,
  Spacer: MoveVertical, Html: Code2,
};

const inp = 'input-field !h-8 !text-xs w-full';
const area = 'input-field !h-auto py-2 !text-xs w-full resize-y';
const chip = (on: boolean) =>
  `h-7 px-2 rounded-md text-3xs font-medium transition-colors ${
    on ? 'bg-inverse text-inverse-fg' : 'text-secondary ring-1 ring-subtle hover:bg-surface-sunken'}`;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-3xs text-tertiary w-14 shrink-0">{label}</span>
      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function Colour({ value, onChange, fallback = '#000000' }: {
  value?: string | null; onChange: (v: string) => void; fallback?: string;
}) {
  return (
    <input type="color" value={value || fallback} onChange={(e) => onChange(e.target.value)}
      className="w-7 h-7 rounded-md border border-subtle bg-surface cursor-pointer shrink-0" />
  );
}

/** Padding as one number per side is four spinners nobody uses. This is presets. */
function Padding({ value, onChange }: { value?: any; onChange: (p: any) => void }) {
  const v = value ?? { top: 16, right: 24, bottom: 16, left: 24 };
  const set = (top: number, bottom: number) => onChange({ ...v, top, bottom });
  const on = (t: number, b: number) => v.top === t && v.bottom === b;
  return (
    <Row label="Spacing">
      <button className={chip(on(0, 0))} onClick={() => set(0, 0)}>None</button>
      <button className={chip(on(8, 8))} onClick={() => set(8, 8)}>Tight</button>
      <button className={chip(on(16, 16))} onClick={() => set(16, 16)}>Normal</button>
      <button className={chip(on(32, 32))} onClick={() => set(32, 32)}>Roomy</button>
    </Row>
  );
}

export default function EmailDesigner({ doc, onChange, disabled }: {
  doc: EmailDoc; onChange: (d: EmailDoc) => void; disabled?: boolean;
}) {
  const ids = rootChildren(doc);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [design, setDesign] = useState(false);

  const root = doc[ROOT]?.data ?? {};
  const accent = '#4653CE';

  const sel = selected && doc[selected] ? doc[selected] : null;

  const add = (type: DocBlockType) => {
    const { doc: next, id } = addBlock(doc, type);
    onChange(next); setAdding(false); setSelected(id);
  };

  if (ids.length === 0 && !adding) {
    return (
      <div className="rounded-xl ring-1 ring-subtle bg-surface-sunken px-4 py-6 text-center space-y-3">
        <p className="text-xs text-tertiary">Start from a layout — you can change everything afterwards.</p>
        <div className="flex flex-wrap justify-center gap-1.5">
          {DOC_PRESETS.filter((p) => p.key !== 'blank').map((p) => (
            <button key={p.key} disabled={disabled} title={p.description} onClick={() => onChange(p.build(accent))}
              className="h-7 px-2.5 rounded-md text-2xs font-medium text-secondary ring-1 ring-subtle bg-surface hover:ring-strong disabled:opacity-50">
              {p.name}
            </button>
          ))}
        </div>
        <button disabled={disabled} onClick={() => setAdding(true)}
          className="text-2xs text-tertiary hover:text-primary underline underline-offset-2">or start from a blank canvas</button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Canvas design — collapsed, because it is set once and the blocks are
          what you come back to. */}
      <div className="rounded-lg ring-1 ring-subtle bg-surface overflow-hidden">
        <button onClick={() => setDesign((d) => !d)} aria-expanded={design}
          className="w-full flex items-center gap-2 px-2.5 h-9 hover:bg-surface-hover text-left">
          <Palette className="w-3.5 h-3.5 text-accent shrink-0" />
          <span className="text-2xs font-medium text-primary">Design</span>
          <span className="text-2xs text-tertiary truncate">
            {FONT_FAMILIES.find((f) => f.v === root.fontFamily)?.label ?? 'Modern sans'}
          </span>
          <span className="ml-auto flex items-center gap-1 shrink-0">
            <span className="w-3.5 h-3.5 rounded-sm ring-1 ring-subtle" style={{ background: root.backdropColor || '#F5F5F5' }} />
            <span className="w-3.5 h-3.5 rounded-sm ring-1 ring-subtle" style={{ background: root.canvasColor || '#FFFFFF' }} />
          </span>
        </button>
        {design && (
          <div className="border-t border-subtle p-2.5 space-y-2">
            <Row label="Font">
              <select value={root.fontFamily || 'MODERN_SANS'} disabled={disabled}
                onChange={(e) => onChange(patchRoot(doc, { fontFamily: e.target.value }))}
                className={inp}>
                {FONT_FAMILIES.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
              </select>
            </Row>
            <Row label="Page">
              <Colour value={root.backdropColor} fallback="#F5F5F5" onChange={(v) => onChange(patchRoot(doc, { backdropColor: v }))} />
              <span className="text-3xs text-tertiary">behind</span>
              <Colour value={root.canvasColor} fallback="#FFFFFF" onChange={(v) => onChange(patchRoot(doc, { canvasColor: v }))} />
              <span className="text-3xs text-tertiary">card</span>
              <Colour value={root.textColor} fallback="#242424" onChange={(v) => onChange(patchRoot(doc, { textColor: v }))} />
              <span className="text-3xs text-tertiary">text</span>
            </Row>
            <div className="flex flex-wrap gap-1 pt-0.5">
              <span className="text-3xs text-tertiary w-14 shrink-0 self-center">Replace</span>
              {DOC_PRESETS.filter((p) => p.key !== 'blank').map((p) => (
                <button key={p.key} disabled={disabled} title={p.description}
                  onClick={() => onChange(p.build(accent))} className={chip(false)}>{p.name}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {ids.map((id, i) => {
        const b = doc[id];
        const Icon = ICON[b.type] ?? Type;
        const active = selected === id;
        return (
          <div key={id} className={`rounded-lg ring-1 bg-surface overflow-hidden transition-colors ${active ? 'ring-accent' : 'ring-subtle'}`}>
            <div className="flex items-center gap-1 px-2 h-9">
              <button onClick={() => setSelected(active ? null : id)} aria-pressed={active}
                className="flex items-center gap-1.5 min-w-0 flex-1 h-full text-left rounded-md px-1 hover:bg-surface-hover">
                <Icon className="w-3.5 h-3.5 text-accent shrink-0" />
                <span className="text-2xs font-medium text-primary shrink-0">
                  {DOC_BLOCK_META.find((m) => m.type === b.type)?.name ?? b.type}
                </span>
                <span className="text-2xs text-tertiary truncate">{summarise(b)}</span>
              </button>
              <div className="flex items-center shrink-0">
                <button onClick={() => onChange(moveBlock(doc, id, -1))} disabled={disabled || i === 0} aria-label="Move up"
                  className="p-1 rounded text-tertiary hover:text-primary disabled:opacity-25"><ChevronUp className="w-3.5 h-3.5" /></button>
                <button onClick={() => onChange(moveBlock(doc, id, 1))} disabled={disabled || i === ids.length - 1} aria-label="Move down"
                  className="p-1 rounded text-tertiary hover:text-primary disabled:opacity-25"><ChevronDown className="w-3.5 h-3.5" /></button>
                <button onClick={() => onChange(duplicateBlock(doc, id))} disabled={disabled} aria-label="Duplicate"
                  className="p-1 rounded text-tertiary hover:text-primary disabled:opacity-40"><Copy className="w-3.5 h-3.5" /></button>
                <button onClick={() => { onChange(removeBlock(doc, id)); if (active) setSelected(null); }}
                  disabled={disabled} aria-label="Delete"
                  className="p-1 rounded text-tertiary hover:text-danger disabled:opacity-40"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            {active && (
              <div className="border-t border-subtle p-2.5 space-y-2">
                <Props doc={doc} id={id} onChange={onChange} disabled={disabled} />
              </div>
            )}
          </div>
        );
      })}

      {adding ? (
        <div className="rounded-lg ring-1 ring-subtle bg-surface-sunken p-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {DOC_BLOCK_META.map((m) => {
              const Icon = ICON[m.type] ?? Type;
              return (
                <button key={m.type} onClick={() => add(m.type)} title={m.hint}
                  className="flex items-center gap-1.5 h-8 px-2 rounded-md bg-surface ring-1 ring-subtle text-2xs text-secondary hover:text-primary hover:ring-strong">
                  <Icon className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span className="truncate">{m.name}</span>
                </button>
              );
            })}
          </div>
          <button onClick={() => setAdding(false)} className="mt-2 h-7 px-2 rounded-md text-2xs text-tertiary hover:text-primary">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} disabled={disabled}
          className="w-full h-9 inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-subtle text-xs text-tertiary hover:text-primary hover:border-strong disabled:opacity-50">
          <Plus className="w-3.5 h-3.5" /> Add block
        </button>
      )}
    </div>
  );
}

/** What the collapsed row shows, so a long email stays navigable. */
function summarise(b: { type: string; data?: any }): string {
  const p = b.data?.props ?? {};
  const trim = (s: string, n = 52) => (s.length > n ? `${s.slice(0, n)}…` : s);
  switch (b.type) {
    case 'Heading':
    case 'Text': return p.text ? trim(String(p.text).replace(/\s+/g, ' ').trim()) : 'Empty';
    case 'Button': return p.text ? `${p.text} → ${p.url || 'no link'}` : 'Empty';
    case 'Image':
    case 'Avatar': return p.url || p.imageUrl ? trim(String(p.url || p.imageUrl), 40) : 'No image yet';
    case 'ColumnsContainer': return `${p.columnsCount ?? 2} columns`;
    case 'Spacer': return `${p.height ?? 24}px`;
    case 'Html': return p.contents ? trim(String(p.contents).replace(/\s+/g, ' ').trim(), 40) : 'Empty';
    default: return '';
  }
}

// ── The properties panel ────────────────────────────────────────────────────

function Props({ doc, id, onChange, disabled }: {
  doc: EmailDoc; id: string; onChange: (d: EmailDoc) => void; disabled?: boolean;
}) {
  const b = doc[id];
  const p = b.data?.props ?? {};
  const st = b.data?.style ?? {};
  const setP = (patch: any) => onChange(patchBlock(doc, id, 'props', patch));
  const setS = (patch: any) => onChange(patchBlock(doc, id, 'style', patch));

  const align = (
    <Row label="Align">
      {['left', 'center', 'right'].map((a) => (
        <button key={a} disabled={disabled} onClick={() => setS({ textAlign: a })}
          className={chip((st.textAlign || 'left') === a)}>{a === 'center' ? 'Centre' : a[0].toUpperCase() + a.slice(1)}</button>
      ))}
    </Row>
  );
  const padding = <Padding value={st.padding} onChange={(v) => setS({ padding: v })} />;

  switch (b.type) {
    case 'Heading':
      return (
        <>
          <input value={p.text || ''} disabled={disabled} onChange={(e) => setP({ text: e.target.value })}
            placeholder="Heading" className={inp} />
          <Row label="Size">
            {['h1', 'h2', 'h3'].map((l) => (
              <button key={l} disabled={disabled} onClick={() => setP({ level: l })}
                className={chip((p.level || 'h2') === l)}>{l.toUpperCase()}</button>
            ))}
          </Row>
          {align}
          <Row label="Colour"><Colour value={st.color} fallback="#242424" onChange={(v) => setS({ color: v })} /></Row>
          {padding}
        </>
      );

    case 'Text':
      return (
        <>
          <textarea value={p.text || ''} disabled={disabled} rows={6} onChange={(e) => setP({ text: e.target.value })}
            placeholder="Write here. A blank line starts a new paragraph." className={area} />
          <Row label="Size">
            {[13, 15, 16, 18].map((n) => (
              <button key={n} disabled={disabled} onClick={() => setS({ fontSize: n })}
                className={chip((st.fontSize || 16) === n)}>{n}</button>
            ))}
          </Row>
          {align}
          <Row label="Colour"><Colour value={st.color} fallback="#242424" onChange={(v) => setS({ color: v })} /></Row>
          {padding}
        </>
      );

    case 'Image':
      return (
        <>
          <input value={p.url || ''} disabled={disabled} onChange={(e) => setP({ url: e.target.value })}
            placeholder="https://… (image URL)" className={`${inp} font-mono`} />
          <input value={p.alt || ''} disabled={disabled} onChange={(e) => setP({ alt: e.target.value })}
            placeholder="Alt text — shown while images are blocked, which is most first opens" className={inp} />
          <input value={p.linkHref || ''} disabled={disabled} onChange={(e) => setP({ linkHref: e.target.value })}
            placeholder="Link when clicked (optional)" className={`${inp} font-mono`} />
          {padding}
          <p className="text-3xs text-tertiary leading-relaxed">
            The image must already be on the web — a mail client cannot read a file from your computer.
          </p>
        </>
      );

    case 'Button':
      return (
        <>
          <input value={p.text || ''} disabled={disabled} onChange={(e) => setP({ text: e.target.value })}
            placeholder="Button label" className={inp} />
          <input value={p.url || ''} disabled={disabled} onChange={(e) => setP({ url: e.target.value })}
            placeholder="https://…" className={`${inp} font-mono`} />
          <Row label="Shape">
            {['rectangle', 'rounded', 'pill'].map((s) => (
              <button key={s} disabled={disabled} onClick={() => setP({ buttonStyle: s })}
                className={chip((p.buttonStyle || 'rounded') === s)}>{s[0].toUpperCase() + s.slice(1)}</button>
            ))}
          </Row>
          <Row label="Size">
            {['small', 'medium', 'large'].map((s) => (
              <button key={s} disabled={disabled} onClick={() => setP({ size: s })}
                className={chip((p.size || 'medium') === s)}>{s[0].toUpperCase() + s.slice(1)}</button>
            ))}
          </Row>
          <Row label="Colour">
            <Colour value={p.buttonBackgroundColor} fallback="#4653CE" onChange={(v) => setP({ buttonBackgroundColor: v })} />
            <span className="text-3xs text-tertiary">fill</span>
            <Colour value={p.buttonTextColor} fallback="#FFFFFF" onChange={(v) => setP({ buttonTextColor: v })} />
            <span className="text-3xs text-tertiary">label</span>
          </Row>
          {align}
          {padding}
        </>
      );

    case 'Avatar':
      return (
        <>
          <input value={p.imageUrl || ''} disabled={disabled} onChange={(e) => setP({ imageUrl: e.target.value })}
            placeholder="https://… (image URL)" className={`${inp} font-mono`} />
          <Row label="Shape">
            {['circle', 'square', 'rounded'].map((s) => (
              <button key={s} disabled={disabled} onClick={() => setP({ shape: s })}
                className={chip((p.shape || 'circle') === s)}>{s[0].toUpperCase() + s.slice(1)}</button>
            ))}
          </Row>
          <Row label="Size">
            {[48, 64, 96].map((n) => (
              <button key={n} disabled={disabled} onClick={() => setP({ size: n })}
                className={chip((p.size || 64) === n)}>{n}</button>
            ))}
          </Row>
          {align}
          {padding}
        </>
      );

    case 'Divider':
      return (
        <>
          <Row label="Colour"><Colour value={p.lineColor} fallback="#E4E4E7" onChange={(v) => setP({ lineColor: v })} /></Row>
          {padding}
        </>
      );

    case 'Spacer':
      return (
        <Row label="Height">
          {[8, 16, 24, 48].map((n) => (
            <button key={n} disabled={disabled} onClick={() => setP({ height: n })}
              className={chip((p.height ?? 24) === n)}>{n}</button>
          ))}
        </Row>
      );

    case 'ColumnsContainer':
      return (
        <>
          <Row label="Columns">
            {[2, 3].map((n) => (
              <button key={n} disabled={disabled}
                onClick={() => setP({
                  columnsCount: n,
                  // The array has to grow with the count or the extra column
                  // renders as nothing and looks like a bug in the renderer.
                  columns: Array.from({ length: 3 }, (_, i) => p.columns?.[i] ?? { childrenIds: [] }),
                })}
                className={chip((p.columnsCount ?? 2) === n)}>{n}</button>
            ))}
          </Row>
          <Row label="Gap">
            {[0, 8, 16, 24].map((n) => (
              <button key={n} disabled={disabled} onClick={() => setP({ columnsGap: n })}
                className={chip((p.columnsGap ?? 16) === n)}>{n}</button>
            ))}
          </Row>
          {padding}
          {/* Said plainly rather than left to be discovered: nesting is what
              makes an email builder unmaintainable, and the honest version of
              "we do not do that" is a sentence, not a missing button. */}
          <p className="text-3xs text-tertiary leading-relaxed">
            Columns hold text and images side by side on a desktop and stack on a phone. Adding blocks
            inside a column is not supported yet — use two of these one after another instead.
          </p>
        </>
      );

    case 'Html':
      return (
        <>
          <textarea value={p.contents || ''} disabled={disabled} rows={10} spellCheck={false}
            onChange={(e) => setP({ contents: e.target.value })}
            placeholder="<table>…</table>" className={`${area} font-mono !text-3xs`} />
          {padding}
          <p className="text-3xs text-tertiary leading-relaxed">
            Pasted from another tool. Scripts, styles, iframes and event handlers are removed before
            sending — and Gmail strips <code>&lt;style&gt;</code> blocks anyway, so use inline styles
            and tables.
          </p>
        </>
      );

    default:
      return <p className="text-3xs text-tertiary">Nothing to configure.</p>;
  }
}
