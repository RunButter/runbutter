'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toggleDocItem, tagDot, kindOf, KIND_META, type DocMeta } from '@/lib/crm/docs';
import { parseTodo, parseSheet } from '@/lib/crm/doc-formats';

/**
 * A document as a card that renders its own content.
 *
 * THE POINT IS TICKING WITHOUT OPENING. The index used to show a 140-character
 * snippet, which for a checklist is a wall of "- [ ] " — it told you the
 * document existed and nothing else. A list is a thing you glance at and tick,
 * so opening a document to check one box off was the entire friction.
 *
 * The tick is OPTIMISTIC and reverts on failure. A checkbox that waits for a
 * network round trip feels broken, and this one cannot half-succeed: the server
 * takes an explicit done-state rather than a toggle, so a revert lands exactly
 * where it started even if two taps race.
 *
 * The card renders from `preview`, which is TRUNCATED — so it never writes
 * anything derived from it. Ticking goes through `toggle_doc_item`, which flips
 * the line in SQL and never transports the body.
 */
export default function DocCard({ doc, privy, onOpen, onDelete, canEdit }: {
  doc: DocMeta;
  privy: string | null;
  onOpen: () => void;
  onDelete: (e: React.MouseEvent) => void;
  canEdit: boolean;
}) {
  const kind = kindOf(doc.kind);
  const body = doc.preview ?? doc.snippet ?? '';
  const parsed = parseTodo(body);

  // Local overrides layered over the server's state, so a tick shows instantly
  // without refetching the whole list.
  const [ticks, setTicks] = useState<Record<number, boolean>>({});
  const [failed, setFailed] = useState(false);

  const isChecklist = (kind === 'todo' || kind === 'note') && parsed.items.length > 0;
  const shownItems = parsed.items.slice(0, 8);
  const hiddenItems = Math.max(0, (doc.item_count ?? parsed.items.length) - shownItems.length);

  // Counts come from SQL, over the whole body — the preview is truncated, so
  // counting from it would under-report a long list.
  const total = doc.item_count ?? parsed.items.length;
  const doneBase = doc.done_count ?? parsed.items.filter((t) => t.done).length;
  const doneDelta = Object.entries(ticks).reduce((n, [i, v]) => {
    const was = parsed.items[Number(i)]?.done ?? false;
    return n + (v === was ? 0 : v ? 1 : -1);
  }, 0);
  const done = Math.max(0, Math.min(total, doneBase + doneDelta));

  const tick = async (index: number, next: boolean) => {
    if (!privy || !canEdit) return;
    setTicks((t) => ({ ...t, [index]: next }));
    setFailed(false);
    const { ok, error } = await toggleDocItem(privy, doc.id, index, next);
    if (!ok || error) {
      // Back to exactly where it started. Safe to do blindly because the server
      // was told a state, not asked to flip one.
      setTicks((t) => { const c = { ...t }; delete c[index]; return c; });
      setFailed(true);
    }
  };

  const sheet = kind === 'sheet' ? parseSheet(body) : null;

  return (
    <div
      onClick={onOpen}
      // break-inside-avoid keeps a card whole in the masonry columns; without
      // it a checklist gets sliced across a column boundary mid-item.
      className="group break-inside-avoid mb-4 cursor-pointer card-surface p-5 hover:ring-strong hover:shadow-elevated transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-md font-medium text-primary leading-snug min-w-0 flex-1">
          {doc.title || 'Untitled'}
        </h3>
        <button onClick={onDelete} disabled={!canEdit} aria-label={`Delete ${doc.title}`}
          className="p-1 -mr-1 -mt-0.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:hidden">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {isChecklist ? (
        <ul className="mt-3 space-y-1.5">
          {shownItems.map((item, i) => {
            const checked = ticks[i] ?? item.done;
            return (
              <li key={item.id} style={{ marginLeft: item.indent * 20 }}>
                {/* The whole row is the hit target — a 16px box is a miss on a
                    phone. stopPropagation so ticking does not also open. */}
                <label onClick={(e) => e.stopPropagation()}
                  className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input type="checkbox" checked={checked} disabled={!canEdit}
                    onChange={(e) => tick(i, e.target.checked)}
                    className="mt-0.5 w-[18px] h-[18px] shrink-0 rounded accent-[hsl(var(--text-primary))] cursor-pointer" />
                  <span className={`text-sm leading-snug ${checked ? 'text-tertiary line-through' : 'text-secondary'}`}>
                    {item.text || <span className="italic text-tertiary">empty</span>}
                  </span>
                </label>
              </li>
            );
          })}
          {hiddenItems > 0 && (
            <li className="text-2xs text-tertiary pl-[28px] pt-0.5">+{hiddenItems} more</li>
          )}
        </ul>
      ) : sheet ? (
        // Header plus three rows: enough to recognise the table, not so much
        // that one card fills the column.
        <div className="mt-3 -mx-1 overflow-hidden">
          <table className="w-full text-2xs">
            <thead>
              <tr>{sheet.headers.slice(0, 4).map((h, i) => (
                <th key={i} className="text-left font-medium text-tertiary px-1 pb-1 truncate">{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {sheet.rows.slice(0, 3).map((r, i) => (
                <tr key={i} className="border-t border-subtle">
                  {r.slice(0, 4).map((c, j) => (
                    <td key={j} className="px-1 py-1 text-secondary truncate max-w-[8rem]">{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {sheet.rows.length > 3 && (
            <p className="text-2xs text-tertiary px-1 pt-1">+{sheet.rows.length - 3} more rows</p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-secondary leading-snug line-clamp-6 whitespace-pre-wrap">
          {plainPreview(body) || `Empty ${KIND_META[kind].label.toLowerCase()}`}
        </p>
      )}

      {failed && (
        <p className="mt-2 text-2xs text-danger">Couldn&apos;t save that — open the list and try again.</p>
      )}

      {(doc.tags?.length || total > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-4">
          {doc.tags?.map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5 h-6 pl-1.5 pr-2.5 rounded-full ring-1 ring-subtle text-2xs text-secondary">
              <span className={`w-2 h-2 rounded-full ${tagDot(t)}`} />
              {t}
            </span>
          ))}
          {total > 0 && (
            <span className="text-2xs text-tertiary tabular-nums ml-auto">{done}/{total}</span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Strip the markdown a card cannot render, so a prose preview does not open
 * with "## " or a row of pipes. Only the markers — the words are the preview.
 */
function plainPreview(body: string): string {
  return body
    .split('\n')
    .filter((l) => !/^\s*\|/.test(l) && !/^\s*```/.test(l))
    .map((l) => l
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\s*[-*+]\s+/, '• ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/(\*\*|__|\*|_|`)/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
