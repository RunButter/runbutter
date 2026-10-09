'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PipelineRecord, PipelineStage } from '@/lib/crm/types';
import { dayOf, monthGrid, todayKey } from '@/lib/crm/views';
import { setDealCloseDate } from '@/lib/crm/data';
import { useDialog } from '@/components/ui/Dialog';

/**
 * The pipeline as a month: every open deal on its expected close date (0130).
 *
 * RecordCalendar does this for CRUD objects and writes through `update_record`;
 * a deal is a pipeline record with its own setter, so it gets its own small
 * calendar rather than a flag on the general one. Same rules otherwise: dates
 * are compared as STRINGS (`dayOf`), never parsed, so a deal closing on the
 * 14th never shows on the 13th west of Greenwich; dragging is optimistic and
 * puts the card back if the write fails.
 *
 * Deals with no date sit in a tray underneath — the honest answer to "where did
 * my deal go" — and dragging one onto a day schedules it, dragging a dated one
 * back onto the tray clears it.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TRAY = '__no_date__';
const MAX_PER_DAY = 3;

const title = (r: PipelineRecord) => r.title || r.company?.name || r.person?.name || 'Untitled';
const money = (n?: number | null) => (n ? `$${Number(n).toLocaleString()}` : '');

function Chip({ r, stage, dragging = false }: { r: PipelineRecord; stage?: PipelineStage; dragging?: boolean }) {
  const tone = r.status === 'won' ? 'bg-success/10 text-success' : r.status === 'lost' ? 'bg-surface-hover text-tertiary line-through' : 'bg-accent/10 text-accent';
  return (
    <div title={`${title(r)}${stage ? ` · ${stage.name}` : ''}`}
      className={`px-1.5 py-1 rounded-md text-2xs font-medium flex items-center gap-1 min-w-0 ${tone} ${dragging ? 'shadow-lg ring-1 ring-accent/30' : ''}`}>
      <span className="truncate">{title(r)}</span>
      {r.amount ? <span className="ml-auto shrink-0 tabular-nums opacity-80">{money(r.amount)}</span> : null}
    </div>
  );
}

function Draggable({ r, stage, canMove }: { r: PipelineRecord; stage?: PipelineStage; canMove: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: r.id, disabled: !canMove });
  return (
    <div ref={setNodeRef} {...(canMove ? attributes : {})} {...(canMove ? listeners : {})}
      className={`outline-none ${canMove ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-40' : ''}`}>
      <Chip r={r} stage={stage} />
    </div>
  );
}

function Day({ day, inMonth, rows, stages, canMove, expanded, onExpand }: {
  day: string; inMonth: boolean; rows: PipelineRecord[]; stages: Map<string, PipelineStage>;
  canMove: boolean; expanded: boolean; onExpand: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: day, disabled: !canMove });
  const isToday = day === todayKey();
  const shown = expanded ? rows : rows.slice(0, MAX_PER_DAY);
  const sum = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  return (
    <div ref={setNodeRef}
      className={`min-h-[96px] p-1 border-b border-r border-subtle flex flex-col gap-1 transition-colors duration-150
        ${inMonth ? '' : 'bg-surface-sunken/40'} ${isOver ? 'bg-accent/10' : ''}`}>
      <div className="flex items-center justify-between px-0.5">
        <span className={`text-2xs tabular-nums ${isToday ? 'w-4 h-4 rounded-full bg-accent text-accent-fg inline-flex items-center justify-center font-semibold' : inMonth ? 'text-secondary' : 'text-tertiary'}`}>
          {Number(day.slice(8, 10))}
        </span>
        {rows.length > 1 && sum > 0 && <span className="text-3xs text-tertiary tabular-nums">{money(sum)}</span>}
      </div>
      {shown.map((r) => <Draggable key={r.id} r={r} stage={stages.get(r.stage_id)} canMove={canMove} />)}
      {rows.length > MAX_PER_DAY && (
        <button onClick={onExpand} className="px-1.5 text-2xs text-tertiary hover:text-accent text-left">
          {expanded ? 'Show less' : `+${rows.length - MAX_PER_DAY} more`}
        </button>
      )}
    </div>
  );
}

function Tray({ rows, stages, canMove }: { rows: PipelineRecord[]; stages: Map<string, PipelineStage>; canMove: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: TRAY, disabled: !canMove });
  return (
    <div ref={setNodeRef}
      className={`shrink-0 mt-3 rounded-xl ring-1 ring-subtle bg-surface p-3 transition-colors ${isOver ? 'bg-accent/5 ring-accent/30' : ''}`}>
      <div className="text-xs font-medium text-primary">No close date <span className="text-tertiary tabular-nums">{rows.length}</span></div>
      <p className="text-2xs text-tertiary mt-0.5">
        {canMove ? 'Drag a deal onto a day to set when it should close.' : 'Open deals without an expected close date.'}
      </p>
      {rows.length > 0 && (
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
          {rows.map((r) => <Draggable key={r.id} r={r} stage={stages.get(r.stage_id)} canMove={canMove} />)}
        </div>
      )}
    </div>
  );
}

export default function DealCalendar({ stages, records, privy, live, onChanged }: {
  stages: PipelineStage[]; records: PipelineRecord[];
  privy: string | null; live: boolean; onChanged?: () => void;
}) {
  const { notify } = useDialog();
  const [local, setLocal] = useState<PipelineRecord[]>(records);
  const [anchor, setAnchor] = useState(() => new Date());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  useEffect(() => { setLocal(records); }, [records]);

  // A sample board's ids exist in no database, so nothing moves on it.
  const canMove = !!privy && live;
  const stageMap = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);
  const { days } = useMemo(() => monthGrid(anchor), [anchor]);
  const month = anchor.getMonth();

  const byDay = useMemo(() => {
    const out = new Map<string, PipelineRecord[]>();
    for (const r of local) {
      const d = dayOf(r.close_date);
      if (!d) continue;
      (out.get(d) || out.set(d, []).get(d)!).push(r);
    }
    return out;
  }, [local]);
  const undated = local.filter((r) => !dayOf(r.close_date) && r.status === 'active');

  const inView = days.filter((d) => Number(d.slice(5, 7)) - 1 === month)
    .flatMap((d) => byDay.get(d) || []).filter((r) => r.status === 'active');
  const monthSum = inView.reduce((a, r) => a + (Number(r.amount) || 0), 0);

  const label = new Date(Date.UTC(anchor.getFullYear(), month, 1))
    .toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const shift = (n: number) => setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + n, 1));

  function onDragStart(e: DragStartEvent) { setActiveId(String(e.active.id)); }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    if (!e.over || !canMove) return;
    const id = String(e.active.id);
    const target = String(e.over.id);
    const next = target === TRAY ? null : target;
    const before = local;
    const moved = before.find((r) => r.id === id);
    if (!moved || (dayOf(moved.close_date) ?? null) === next) return;

    setLocal((rs) => rs.map((r) => (r.id === id ? { ...r, close_date: next } : r)));
    const { error } = await setDealCloseDate(privy!, id, next);
    if (error) { setLocal(before); notify(error); }
    else onChanged?.();
  }

  const active = local.find((r) => r.id === activeId) || null;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="h-full flex flex-col min-h-0">
        <div className="shrink-0 flex items-center gap-2 mb-2">
          <button onClick={() => shift(-1)} aria-label="Previous month"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-secondary hover:bg-surface-sunken">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium text-primary min-w-[9rem]">{label}</span>
          <button onClick={() => shift(1)} aria-label="Next month"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-secondary hover:bg-surface-sunken">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button onClick={() => setAnchor(new Date())}
            className="h-7 px-2 rounded-md text-xs font-semibold text-secondary hover:bg-surface-sunken">Today</button>
          <span className="ml-auto text-2xs text-tertiary">
            {inView.length} open {inView.length === 1 ? 'deal' : 'deals'} closing this month
            {monthSum > 0 && <> · <span className="text-success font-semibold tabular-nums">{money(monthSum)}</span></>}
          </span>
        </div>

        <div className="rounded-xl ring-1 ring-subtle bg-surface overflow-hidden flex flex-col min-h-0 flex-1">
          <div className="grid grid-cols-7 shrink-0 border-subtle">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 py-1.5 border-b border-r border-subtle last:border-r-0 text-2xs font-semibold text-tertiary">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 flex-1 min-h-0 overflow-y-auto">
            {days.map((d) => (
              <Day key={d} day={d} inMonth={Number(d.slice(5, 7)) - 1 === month}
                rows={byDay.get(d) || []} stages={stageMap} canMove={canMove}
                expanded={expanded === d} onExpand={() => setExpanded((x) => (x === d ? null : d))} />
            ))}
          </div>
        </div>

        <Tray rows={undated} stages={stageMap} canMove={canMove} />
      </div>
      <DragOverlay>{active ? <div className="w-44"><Chip r={active} dragging /></div> : null}</DragOverlay>
    </DndContext>
  );
}
