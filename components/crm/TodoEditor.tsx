'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, GripVertical, Indent, Outdent, CheckCheck } from 'lucide-react';
import { parseTodo, serializeTodo, type TodoItem } from '@/lib/crm/doc-formats';

/**
 * A real checklist, not a note that happens to contain checkboxes.
 *
 * The difference is everything a list needs and prose does not: Enter makes the
 * next item, Backspace on an empty one removes it and puts the caret back where
 * it was, Tab nests, Alt+arrow reorders, and there is a count of what is left.
 * In the rich editor all of those are text operations that happen to look like
 * a list.
 *
 * It still stores markdown (`- [ ] …`) in the same body column, so the same
 * document opens in the rich editor, exports through one path, and is found by
 * the same search. See lib/crm/doc-formats.ts.
 */
export default function TodoEditor({ value, onChange, editable = true }: {
  value: string; onChange: (markdown: string) => void; editable?: boolean;
}) {
  const parsed = useMemo(() => parseTodo(value), [value]);
  const [items, setItems] = useState<TodoItem[]>(parsed.items.length ? parsed.items : [{ id: 'n0', text: '', done: false, indent: 0 }]);
  const [prelude] = useState(parsed.prelude);
  // Which row to focus after the next render — set by Enter and Backspace, so
  // the caret follows the edit instead of being dropped at the end of the list.
  const focusAt = useRef<number | null>(null);
  const rows = useRef<(HTMLInputElement | null)[]>([]);
  // What we last emitted, so an external reload (a save round trip) does not
  // clobber what is being typed.
  const emitted = useRef(value);

  useEffect(() => {
    if (value === emitted.current) return;
    const next = parseTodo(value);
    setItems(next.items.length ? next.items : [{ id: 'n0', text: '', done: false, indent: 0 }]);
    emitted.current = value;
  }, [value]);

  useEffect(() => {
    if (focusAt.current === null) return;
    const el = rows.current[focusAt.current];
    el?.focus();
    // Caret to the end, so a Backspace-merge continues from where the text ends
    // rather than from wherever the browser put it.
    el?.setSelectionRange(el.value.length, el.value.length);
    focusAt.current = null;
  });

  const commit = useCallback((next: TodoItem[]) => {
    setItems(next);
    const md = serializeTodo(next, prelude);
    emitted.current = md;
    onChange(md);
  }, [onChange, prelude]);

  const patch = (i: number, p: Partial<TodoItem>) =>
    commit(items.map((t, n) => (n === i ? { ...t, ...p } : t)));

  const insertAfter = (i: number) => {
    const next = [...items];
    // A new item inherits its neighbour's indent — otherwise every sub-task has
    // to be re-nested by hand.
    next.splice(i + 1, 0, { id: `n${Date.now()}`, text: '', done: false, indent: items[i]?.indent ?? 0 });
    focusAt.current = i + 1;
    commit(next);
  };

  const removeAt = (i: number) => {
    const next = items.filter((_, n) => n !== i);
    focusAt.current = Math.max(0, i - 1);
    // The last row stays: an empty list has nowhere to type, and "delete
    // everything then wonder how to start again" is a dead end.
    commit(next.length ? next : [{ id: 'n0', text: '', done: false, indent: 0 }]);
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    focusAt.current = j;
    commit(next);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key === 'Enter') { e.preventDefault(); insertAfter(i); return; }
    if (e.key === 'Backspace' && !items[i].text) { e.preventDefault(); removeAt(i); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      // The first item cannot be a child of nothing, and nothing can be nested
      // more than one step deeper than the item above it.
      const max = i === 0 ? 0 : Math.min(3, (items[i - 1]?.indent ?? 0) + 1);
      patch(i, { indent: e.shiftKey ? Math.max(0, items[i].indent - 1) : Math.min(max, items[i].indent + 1) });
      return;
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); move(i, e.key === 'ArrowUp' ? -1 : 1); return;
    }
    if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); focusAt.current = i - 1; setItems([...items]); }
    if (e.key === 'ArrowDown' && i < items.length - 1) { e.preventDefault(); focusAt.current = i + 1; setItems([...items]); }
  };

  const real = items.filter((t) => t.text.trim());
  const done = real.filter((t) => t.done).length;

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-2xl mx-auto px-6 sm:px-8 py-8">
        {/* Text above the first item is kept on save, so it has to be visible —
            preserving something the editor does not show is how people lose
            track of their own words. Not editable here: this view is a list,
            and the rich editor is where prose is edited. */}
        {prelude && (
          <p className="text-sm text-secondary whitespace-pre-wrap mb-4">{prelude}</p>
        )}

        {real.length > 0 && (
          <div className="flex items-center gap-3 mb-5">
            <span className="h-1.5 rounded-full bg-surface-hover flex-1 overflow-hidden">
              <span className="block h-full rounded-full bg-accent transition-[width] duration-300"
                    style={{ width: `${(done / real.length) * 100}%` }} />
            </span>
            <span className="text-2xs text-tertiary tabular-nums shrink-0">
              {done === real.length
                ? <span className="inline-flex items-center gap-1 text-success"><CheckCheck className="w-3.5 h-3.5" /> all done</span>
                : `${real.length - done} left`}
            </span>
          </div>
        )}

        <div className="space-y-0.5">
          {items.map((t, i) => (
            <div key={t.id} className="group flex items-start gap-2 rounded-md hover:bg-surface-hover px-1 py-0.5"
                 style={{ marginLeft: t.indent * 22 }}>
              <button onClick={() => move(i, -1)} disabled={!editable} tabIndex={-1}
                title="Alt+↑ / Alt+↓ to reorder" aria-label="Move up"
                className="opacity-0 group-hover:opacity-100 mt-1.5 text-tertiary hover:text-secondary transition-opacity shrink-0">
                <GripVertical className="w-3.5 h-3.5" />
              </button>
              <input type="checkbox" checked={t.done} disabled={!editable}
                onChange={(e) => patch(i, { done: e.target.checked })}
                aria-label={t.text || 'Untitled item'}
                className="mt-2 w-4 h-4 shrink-0 accent-[hsl(var(--accent))] cursor-pointer" />
              <input
                ref={(el) => { rows.current[i] = el; }}
                value={t.text} disabled={!editable}
                onChange={(e) => patch(i, { text: e.target.value })}
                onKeyDown={(e) => onKey(e, i)}
                placeholder="Something to do"
                className={`flex-1 min-w-0 bg-transparent outline-none py-1 text-sm placeholder:text-tertiary ${
                  t.done ? 'text-tertiary line-through' : 'text-primary'}`} />
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button onClick={() => patch(i, { indent: Math.max(0, t.indent - 1) })} disabled={!editable || t.indent === 0}
                  tabIndex={-1} title="Outdent (Shift+Tab)" aria-label="Outdent"
                  className="p-1 rounded text-tertiary hover:text-secondary disabled:opacity-30"><Outdent className="w-3.5 h-3.5" /></button>
                <button onClick={() => patch(i, { indent: Math.min(3, t.indent + 1) })} disabled={!editable || i === 0}
                  tabIndex={-1} title="Indent (Tab)" aria-label="Indent"
                  className="p-1 rounded text-tertiary hover:text-secondary disabled:opacity-30"><Indent className="w-3.5 h-3.5" /></button>
                <button onClick={() => removeAt(i)} disabled={!editable} tabIndex={-1} aria-label="Delete item"
                  className="p-1 rounded text-tertiary hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>

        <button onClick={() => insertAfter(items.length - 1)} disabled={!editable}
          className="mt-2 h-8 px-2 -ml-1 inline-flex items-center gap-1.5 rounded-md text-sm text-tertiary hover:text-primary hover:bg-surface-hover disabled:opacity-40">
          <Plus className="w-3.5 h-3.5" /> Add item
        </button>

        <p className="mt-6 text-2xs text-tertiary">
          Enter for the next item · Tab to nest · Alt+↑/↓ to reorder · Backspace on an empty item deletes it
        </p>
      </div>
    </div>
  );
}
