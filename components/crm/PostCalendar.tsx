'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, MessageCircle } from 'lucide-react';
import type { PostListItem } from '@/lib/crm/data';

/**
 * Month view for Post Studio, with drag to reschedule.
 *
 * Uses the HTML5 drag-and-drop API rather than @dnd-kit, which the kanban board
 * uses. dnd-kit shines at sortable lists where the ORDER within a container
 * matters; here a card only ever moves from one day to another and nothing is
 * ordered within a day, so the native API does the whole job with a drop target
 * per cell and no sensors, collision detection or overlay to configure.
 *
 * Dates are handled in LOCAL time throughout. A post scheduled for the 1st at
 * 09:00 must appear on the 1st for the person who scheduled it — keying cells by
 * UTC would slide it to the previous day for anyone west of Greenwich.
 */

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Local YYYY-MM-DD. toISOString would convert to UTC and shift the day. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The 6×7 grid covering a month, starting Monday. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  // getDay() is 0=Sun; shift so Monday is column 0.
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - lead);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

const STATUS_DOT: Record<string, string> = {
  draft: 'bg-strong',
  in_review: 'bg-warning',
  approved: 'bg-success',
  published: 'bg-accent',
};

function PostChip({ post, onOpen, onDragStart }: {
  post: PostListItem; onOpen: () => void; onDragStart: () => void;
}) {
  return (
    <button
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onClick={onOpen}
      className="w-full text-left flex items-center gap-1.5 rounded-md px-1.5 py-1 bg-surface-hover hover:bg-surface-sunken transition-colors cursor-grab active:cursor-grabbing"
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[post.status] || STATUS_DOT.draft}`} />
      <span className="text-3xs text-primary truncate flex-1">{post.content || 'Untitled post'}</span>
      {post.comment_count > 0 && (
        <span className="shrink-0 inline-flex items-center gap-0.5 text-3xs text-tertiary">
          <MessageCircle className="w-2.5 h-2.5" />{post.comment_count}
        </span>
      )}
    </button>
  );
}

export default function PostCalendar({ posts, onOpen, onReschedule }: {
  posts: PostListItem[];
  onOpen: (id: string) => void;
  onReschedule: (id: string, at: string | null) => void;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const days = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);

  const { byDay, backlog } = useMemo(() => {
    const map = new Map<string, PostListItem[]>();
    const none: PostListItem[] = [];
    for (const p of posts) {
      if (!p.scheduled_at) { none.push(p); continue; }
      const k = dayKey(new Date(p.scheduled_at));
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    return { byDay: map, backlog: none };
  }, [posts]);

  const drop = (date: Date | null) => {
    if (!dragId) return;
    // Land at 09:00 local — a working-hours default beats midnight, which reads
    // as "not really scheduled". The editor can set an exact time.
    const at = date ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9, 0, 0).toISOString() : null;
    onReschedule(dragId, at);
    setDragId(null);
    setOverKey(null);
  };

  const todayKey = dayKey(today);
  const monthLabel = cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-medium text-primary tabular-nums">{monthLabel}</h2>
        <div className="ml-auto flex items-center gap-1">
          <button aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-tertiary hover:text-primary hover:bg-surface-hover transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
            className="h-8 px-2.5 rounded-md text-xs font-medium text-secondary hover:text-primary hover:bg-surface-hover transition-colors">
            Today
          </button>
          <button aria-label="Next month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-tertiary hover:text-primary hover:bg-surface-hover transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Scrolls rather than shrinking: seven columns at 360px would leave each
          day too narrow to show a single post title. */}
      <div className="overflow-x-auto">
        <div className="min-w-[680px] card-surface overflow-hidden">
          <div className="grid grid-cols-7 border-b border-subtle">
            {DAY_NAMES.map((d) => (
              <div key={d} className="px-2 py-2 text-3xs font-medium uppercase tracking-wider text-tertiary">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d, i) => {
              const k = dayKey(d);
              const inMonth = d.getMonth() === cursor.getMonth();
              const items = byDay.get(k) ?? [];
              return (
                <div
                  key={k}
                  onDragOver={(e) => { e.preventDefault(); setOverKey(k); }}
                  onDragLeave={() => setOverKey((cur) => (cur === k ? null : cur))}
                  onDrop={(e) => { e.preventDefault(); drop(d); }}
                  className={`min-h-[92px] p-1.5 space-y-1 border-b border-r border-subtle transition-colors ${
                    i % 7 === 6 ? 'border-r-0' : ''
                  } ${inMonth ? '' : 'bg-surface-sunken/40'} ${overKey === k ? 'bg-accent/10' : ''}`}
                >
                  <div className={`text-2xs tabular-nums px-0.5 ${
                    k === todayKey
                      ? 'font-medium text-accent'
                      : inMonth ? 'text-secondary' : 'text-tertiary'
                  }`}>
                    {d.getDate()}
                  </div>
                  {items.map((p) => (
                    <PostChip key={p.id} post={p} onOpen={() => onOpen(p.id)} onDragStart={() => setDragId(p.id)} />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* The backlog is a drop target too, so a post can come off the calendar
          without needing a menu. */}
      <div
        onDragOver={(e) => { e.preventDefault(); setOverKey('backlog'); }}
        onDragLeave={() => setOverKey((c) => (c === 'backlog' ? null : c))}
        onDrop={(e) => { e.preventDefault(); drop(null); }}
        className={`card-surface p-4 transition-colors ${overKey === 'backlog' ? 'ring-2 ring-accent' : ''}`}
      >
        <h3 className="text-base font-medium text-primary">Unscheduled</h3>
        <p className="mt-0.5 text-xs text-tertiary">
          Ideas without a date. Drag one onto a day to schedule it, or drop a scheduled post here to take it off.
        </p>
        {backlog.length === 0 ? (
          <p className="mt-3 text-xs text-tertiary">Nothing waiting.</p>
        ) : (
          <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {backlog.map((p) => (
              <PostChip key={p.id} post={p} onOpen={() => onOpen(p.id)} onDragStart={() => setDragId(p.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
