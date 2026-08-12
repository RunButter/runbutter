'use client';

import { useState } from 'react';
import {
  Plus, Trash2, Copy, ChevronUp, ChevronDown, GripVertical,
  Heading1, Type, Image as ImageIcon, MousePointerClick, Columns2,
  List, Quote, Minus, MoveVertical, Code2, ChevronRight,
} from 'lucide-react';
import {
  BLOCK_META, BLOCK_PRESETS, newBlock,
  type EmailBlock, type BlockType, type DigestItem,
} from '@/lib/marketing/newsletter-templates';

/**
 * The email builder: a vertical list of typed blocks.
 *
 * NOT A CANVAS, and that is the design rather than a limitation. The renderer
 * this feeds (`newsletter-templates.ts`) argues at length that drag-and-drop
 * email builders produce nested-table HTML nobody can maintain against Outlook.
 * What is composable here is the ORDER and the CHOICE of blocks; the HTML each
 * one becomes is fixed and ours. So there is no way to express a layout we have
 * not already made work in an inbox.
 *
 * ONE BLOCK OPEN AT A TIME. A stack of twenty expanded editors is a wall you
 * scroll past; the collapsed row shows enough of the block's own content to
 * find it by, which is what a preview pane cannot do once the email is long.
 */

const ICON: Record<BlockType, any> = {
  heading: Heading1, text: Type, image: ImageIcon, button: MousePointerClick,
  columns: Columns2, items: List, quote: Quote, divider: Minus,
  spacer: MoveVertical, html: Code2,
};

/** What the collapsed row shows, so a long email is still navigable. */
function summarise(b: EmailBlock): string {
  const trim = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);
  switch (b.type) {
    case 'heading':
    case 'text':
    case 'quote': return b.text?.trim() ? trim(b.text.replace(/\s+/g, ' ').trim()) : 'Empty';
    case 'button': return b.text?.trim() ? `${b.text} → ${b.url || 'no link'}` : 'Empty';
    case 'image': return b.url?.trim() ? trim(b.url, 48) : 'No image yet';
    case 'columns': return `${(b.columns || []).length} columns`;
    case 'items': return `${(b.items || []).length} link${(b.items || []).length === 1 ? '' : 's'}`;
    case 'html': return b.html?.trim() ? `${b.html.replace(/\s+/g, ' ').trim().slice(0, 48)}…` : 'Empty';
    default: return '';
  }
}

const label = (t: BlockType) => BLOCK_META.find((m) => m.type === t)?.name ?? t;

export default function BlockEditor({ blocks, onChange, disabled }: {
  blocks: EmailBlock[]; onChange: (next: EmailBlock[]) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const patch = (id: string, p: Partial<EmailBlock>) =>
    onChange(blocks.map((b) => (b.id === id ? { ...b, ...p } : b)));

  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const add = (type: BlockType) => {
    const b = newBlock(type);
    onChange([...blocks, b]);
    setAdding(false);
    setOpen(b.id);
  };

  const duplicate = (b: EmailBlock) => {
    const copy = { ...structuredClone(b), id: newBlock(b.type).id };
    const i = blocks.findIndex((x) => x.id === b.id);
    onChange([...blocks.slice(0, i + 1), copy, ...blocks.slice(i + 1)]);
  };

  return (
    <div className="space-y-2">
      {blocks.length === 0 && !adding && (
        <div className="rounded-xl ring-1 ring-subtle bg-surface-sunken px-4 py-6 text-center space-y-3">
          <p className="text-xs text-tertiary">Empty. Start from a layout, or add a block.</p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {BLOCK_PRESETS.filter((p) => p.key !== 'blank').map((p) => (
              <button key={p.key} disabled={disabled} onClick={() => onChange(p.blocks())} title={p.description}
                className="h-7 px-2.5 rounded-md text-2xs font-medium text-secondary ring-1 ring-subtle hover:bg-surface disabled:opacity-50">
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {blocks.map((b, i) => {
        const Icon = ICON[b.type] ?? Type;
        const expanded = open === b.id;
        return (
          <div key={b.id} className="rounded-lg ring-1 ring-subtle bg-surface overflow-hidden">
            <div className="flex items-center gap-1 px-2 h-9">
              <button onClick={() => setOpen((k) => (k === b.id ? null : b.id))} aria-expanded={expanded}
                className="flex items-center gap-1.5 min-w-0 flex-1 h-full text-left rounded-md px-1 hover:bg-surface-hover">
                <ChevronRight className={`w-3 h-3 text-tertiary shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                <Icon className="w-3.5 h-3.5 text-accent shrink-0" />
                <span className="text-2xs font-medium text-primary shrink-0">{label(b.type)}</span>
                <span className="text-2xs text-tertiary truncate">{summarise(b)}</span>
              </button>
              <div className="flex items-center shrink-0">
                <button onClick={() => move(i, -1)} disabled={disabled || i === 0} aria-label="Move up"
                  className="p-1 rounded text-tertiary hover:text-primary disabled:opacity-25"><ChevronUp className="w-3.5 h-3.5" /></button>
                <button onClick={() => move(i, 1)} disabled={disabled || i === blocks.length - 1} aria-label="Move down"
                  className="p-1 rounded text-tertiary hover:text-primary disabled:opacity-25"><ChevronDown className="w-3.5 h-3.5" /></button>
                <button onClick={() => duplicate(b)} disabled={disabled} aria-label="Duplicate"
                  className="p-1 rounded text-tertiary hover:text-primary disabled:opacity-40"><Copy className="w-3.5 h-3.5" /></button>
                <button onClick={() => onChange(blocks.filter((x) => x.id !== b.id))} disabled={disabled} aria-label="Delete"
                  className="p-1 rounded text-tertiary hover:text-danger disabled:opacity-40"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            {expanded && (
              <div className="border-t border-subtle p-2.5 space-y-2">
                <BlockFields b={b} patch={(p) => patch(b.id, p)} disabled={disabled} />
              </div>
            )}
          </div>
        );
      })}

      {adding ? (
        <div className="rounded-lg ring-1 ring-subtle bg-surface-sunken p-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {BLOCK_META.map((m) => {
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

// ── One block's fields ──────────────────────────────────────────────────────

const inp = 'input-field !h-8 !text-xs w-full';
const area = 'input-field !h-auto py-2 !text-xs w-full resize-y';

function Seg({ value, options, onChange, disabled, name }: {
  value: string; options: { v: string; label: string }[]; onChange: (v: string) => void;
  disabled?: boolean; name?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      {/* Named, because two unlabelled groups side by side read as one row of
          six chips with two of them mysteriously on — which is what a size
          control and an alignment control next to each other actually look
          like. */}
      {name && <span className="text-3xs text-tertiary w-9 shrink-0">{name}</span>}
      {options.map((o) => (
        <button key={o.v} disabled={disabled} onClick={() => onChange(o.v)}
          className={`h-7 px-2 rounded-md text-3xs font-medium transition-colors disabled:opacity-50 ${
            value === o.v ? 'bg-inverse text-inverse-fg' : 'text-secondary ring-1 ring-subtle hover:bg-surface-sunken'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const ALIGN = [{ v: 'left', label: 'Left' }, { v: 'center', label: 'Centre' }, { v: 'right', label: 'Right' }];

function BlockFields({ b, patch, disabled }: {
  b: EmailBlock; patch: (p: Partial<EmailBlock>) => void; disabled?: boolean;
}) {
  const items: DigestItem[] = b.items || [];
  const cols = b.columns || [];

  switch (b.type) {
    case 'heading':
      return (
        <>
          <input value={b.text || ''} disabled={disabled} onChange={(e) => patch({ text: e.target.value })}
            placeholder="Heading" className={inp} />
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Seg name="Size" value={b.size || 'md'} disabled={disabled} onChange={(v) => patch({ size: v as any })}
              options={[{ v: 'sm', label: 'Small' }, { v: 'md', label: 'Medium' }, { v: 'lg', label: 'Large' }]} />
            <Seg name="Align" value={b.align || 'left'} disabled={disabled} onChange={(v) => patch({ align: v as any })} options={ALIGN} />
          </div>
        </>
      );

    case 'text':
      return (
        <>
          <textarea value={b.text || ''} disabled={disabled} rows={6} onChange={(e) => patch({ text: e.target.value })}
            placeholder="Write here. A blank line starts a new paragraph." className={area} />
          <Seg name="Align" value={b.align || 'left'} disabled={disabled} onChange={(v) => patch({ align: v as any })} options={ALIGN} />
        </>
      );

    case 'image':
      return (
        <>
          <input value={b.url || ''} disabled={disabled} onChange={(e) => patch({ url: e.target.value })}
            placeholder="https://… (image URL)" className={`${inp} font-mono`} />
          <input value={b.alt || ''} disabled={disabled} onChange={(e) => patch({ alt: e.target.value })}
            placeholder="Alt text — shown while images are blocked, which is most of the time on first open" className={inp} />
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Seg name="Size" value={b.size || 'lg'} disabled={disabled} onChange={(v) => patch({ size: v as any })}
              options={[{ v: 'sm', label: 'Small' }, { v: 'md', label: 'Medium' }, { v: 'lg', label: 'Full' }]} />
            <Seg name="Align" value={b.align || 'center'} disabled={disabled} onChange={(v) => patch({ align: v as any })} options={ALIGN} />
          </div>
          <p className="text-3xs text-tertiary leading-relaxed">
            The image must already be on the web — email clients cannot read a file from your computer.
          </p>
        </>
      );

    case 'button':
      return (
        <>
          <input value={b.text || ''} disabled={disabled} onChange={(e) => patch({ text: e.target.value })}
            placeholder="Button label" className={inp} />
          <input value={b.url || ''} disabled={disabled} onChange={(e) => patch({ url: e.target.value })}
            placeholder="https://…" className={`${inp} font-mono`} />
          <Seg name="Align" value={b.align || 'left'} disabled={disabled} onChange={(v) => patch({ align: v as any })} options={ALIGN} />
        </>
      );

    case 'quote':
      return (
        <>
          <textarea value={b.text || ''} disabled={disabled} rows={3} onChange={(e) => patch({ text: e.target.value })}
            placeholder="“It changed how we work.”" className={area} />
          <input value={b.attribution || ''} disabled={disabled} onChange={(e) => patch({ attribution: e.target.value })}
            placeholder="Who said it" className={inp} />
        </>
      );

    case 'spacer':
      return (
        <Seg name="Height" value={b.size || 'md'} disabled={disabled} onChange={(v) => patch({ size: v as any })}
          options={[{ v: 'sm', label: 'Small' }, { v: 'md', label: 'Medium' }, { v: 'lg', label: 'Large' }]} />
      );

    case 'divider':
      return <p className="text-3xs text-tertiary">A horizontal rule. Nothing to configure.</p>;

    case 'columns':
      return (
        <>
          <div className="grid sm:grid-cols-2 gap-2">
            {[0, 1].map((i) => (
              <div key={i} className="space-y-1.5 rounded-md ring-1 ring-subtle p-2">
                <span className="text-3xs text-tertiary">{i === 0 ? 'Left' : 'Right'}</span>
                <input value={cols[i]?.imageUrl || ''} disabled={disabled}
                  onChange={(e) => patch({ columns: [0, 1].map((j) => ({ ...(cols[j] || {}), ...(j === i ? { imageUrl: e.target.value } : {}) })) })}
                  placeholder="Image URL (optional)" className={`${inp} font-mono`} />
                <textarea value={cols[i]?.text || ''} disabled={disabled} rows={3}
                  onChange={(e) => patch({ columns: [0, 1].map((j) => ({ ...(cols[j] || {}), ...(j === i ? { text: e.target.value } : {}) })) })}
                  placeholder="Text" className={area} />
                <div className="flex gap-1.5">
                  <input value={cols[i]?.label || ''} disabled={disabled}
                    onChange={(e) => patch({ columns: [0, 1].map((j) => ({ ...(cols[j] || {}), ...(j === i ? { label: e.target.value } : {}) })) })}
                    placeholder="Link text" className={inp} />
                  <input value={cols[i]?.url || ''} disabled={disabled}
                    onChange={(e) => patch({ columns: [0, 1].map((j) => ({ ...(cols[j] || {}), ...(j === i ? { url: e.target.value } : {}) })) })}
                    placeholder="https://…" className={`${inp} font-mono`} />
                </div>
              </div>
            ))}
          </div>
          <p className="text-3xs text-tertiary leading-relaxed">Side by side on a desktop, stacked on a phone.</p>
        </>
      );

    case 'items':
      return (
        <>
          <div className="space-y-1.5">
            {items.map((it, i) => (
              <div key={i} className="rounded-md ring-1 ring-subtle p-2 space-y-1.5">
                <div className="flex gap-1.5">
                  <input value={it.title} disabled={disabled} placeholder="Title" className={inp}
                    onChange={(e) => patch({ items: items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                  <button disabled={disabled} aria-label="Remove item"
                    onClick={() => patch({ items: items.filter((_, j) => j !== i) })}
                    className="p-1.5 rounded-md text-tertiary hover:text-danger shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <input value={it.blurb || ''} disabled={disabled} placeholder="One line about it" className={inp}
                  onChange={(e) => patch({ items: items.map((x, j) => (j === i ? { ...x, blurb: e.target.value } : x)) })} />
                <input value={it.url || ''} disabled={disabled} placeholder="https://…" className={`${inp} font-mono`}
                  onChange={(e) => patch({ items: items.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
              </div>
            ))}
          </div>
          <button disabled={disabled} onClick={() => patch({ items: [...items, { title: '' }] })}
            className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-2xs text-tertiary hover:text-primary hover:bg-surface-hover disabled:opacity-50">
            <Plus className="w-3 h-3" /> Add link
          </button>
        </>
      );

    case 'html':
      return (
        <>
          <textarea value={b.html || ''} disabled={disabled} rows={10} spellCheck={false}
            onChange={(e) => patch({ html: e.target.value })}
            placeholder="<table>…</table>" className={`${area} font-mono !text-3xs`} />
          {/* Said plainly and up front, because the alternative is somebody
              pasting a template, seeing it work in the preview, and finding out
              in the inbox. */}
          <p className="text-3xs text-tertiary leading-relaxed">
            Pasted from another tool. Scripts, styles, iframes and event handlers are removed before
            sending — and Gmail strips <code>&lt;style&gt;</code> blocks anyway, so use inline styles
            and tables. This block is not checked for how it renders in Outlook; the others are.
          </p>
        </>
      );

    default:
      return null;
  }
}
