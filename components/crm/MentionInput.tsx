'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { rpc } from '@/lib/rpc';
import { activeQuery, applyMention } from '@/lib/crm/mentions';

/**
 * A textarea that resolves `@` into a real record reference.
 *
 * ── IT WRAPS A PLAIN TEXTAREA ON PURPOSE ────────────────────────────────────
 * The alternative is a contenteditable with rendered chips, which brings its own
 * selection model, its own paste handling and its own IME bugs — and this
 * product already learned that lesson once with the doc editor. A textarea keeps
 * the value a string, which is what every caller already sends to the server.
 * The token is visible while typing and rendered on read, which is a fair trade
 * for not owning a second editor.
 *
 * The picker opens only on an `@` that starts a word, so an email address does
 * not summon it — see activeQuery.
 */
interface Hit { object: string; id: string; label: string; kind: string }

export default function MentionInput({
  value, onChange, privy, workspaceId, placeholder, rows = 3, className, onSubmit, onPaste, onDrop,
}: {
  value: string;
  onChange: (v: string) => void;
  privy: string | null;
  workspaceId: string | null;
  placeholder?: string;
  rows?: number;
  className?: string;
  /** Enter (without shift) submits, when provided. */
  onSubmit?: () => void;
  /**
   * Passed straight through. Chat attaches files by paste and drop, and a
   * mention picker must not cost the composer that — wrapping a textarea only
   * pays off if it stays a textarea.
   */
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const anchor = useRef<{ at: number; caret: number } | null>(null);

  const search = useCallback(async (q: string) => {
    if (!privy || !workspaceId) return;
    const { data } = await rpc('search_mentionable', { p_privy: privy, p_workspace: workspaceId, p_query: q });
    const rows = Array.isArray(data) ? (data as Hit[]) : [];
    setHits(rows);
    setOpen(rows.length > 0);
    setActive(0);
  }, [privy, workspaceId]);

  // Debounced: a picker that fires a query per keystroke is a query per
  // keystroke for everybody in the workspace.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const found = activeQuery(value, el.selectionStart ?? value.length);
    if (!found || found.query.length < 1) { setOpen(false); anchor.current = null; return; }
    anchor.current = { at: found.at, caret: el.selectionStart ?? value.length };
    const t = setTimeout(() => search(found.query), 160);
    return () => clearTimeout(t);
  }, [value, search]);

  function choose(h: Hit) {
    const a = anchor.current;
    const el = ref.current;
    if (!a || !el) return;
    const next = applyMention(value, a.at, a.caret, { object: h.object, id: h.id });
    onChange(next.text);
    setOpen(false);
    // Restore the caret after React re-renders, or it jumps to the end and the
    // next word is typed in the wrong place.
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(next.caret, next.caret); });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (open && hits.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % hits.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + hits.length) % hits.length); return; }
      // Enter picks the highlighted record rather than sending the message —
      // the picker is open, so that is unambiguously what Enter means here.
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(hits[active]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    }
    if (onSubmit && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); }
  }

  return (
    <div className="relative">
      <textarea
        ref={ref} value={value} rows={rows} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDrop={onDrop}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className={className ?? 'w-full p-2.5 text-sm bg-surface-sunken rounded-lg ring-1 ring-subtle text-primary placeholder:text-tertiary outline-none focus:ring-2 focus:ring-accent/30 resize-none'} />

      {open && hits.length > 0 && (
        <div className="absolute z-20 bottom-full mb-1 left-0 w-72 max-h-56 overflow-y-auto bg-surface rounded-lg ring-1 ring-subtle shadow-lg">
          {hits.map((h, i) => (
            <button key={`${h.object}-${h.id}`} type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(h)}
              onMouseEnter={() => setActive(i)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left ${i === active ? 'bg-surface-sunken' : ''}`}>
              <span className="text-xs text-primary truncate flex-1">{h.label}</span>
              <span className="text-2xs text-tertiary shrink-0">{h.kind}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
