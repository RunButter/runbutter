'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ObjectDef, FieldDef } from '@/lib/crm/types';
import { cardTitle, dayOf, monthGrid, todayKey } from '@/lib/crm/views';
import { updateRecord } from '@/lib/crm/data';
import { useDialog } from '@/components/ui/Dialog';

/**
 * A month calendar over ANY object, laid out on one of its date columns.
 *
 * The posts calendar (PostCalendar) does this for scheduled social posts and
 * knows about `post_targets` and publish state, so it cannot be pointed at
 * invoices. This is the general case: it needs nothing but a date field, which
 * six built-ins and every custom object with a `date` field already have.
 *
 * DRAGGING RESCHEDULES, and like the board it is a one-key partial update —
 * safe only because 0088 stopped `update_record` blanking the columns a payload
 * does not mention. It writes the same `YYYY-MM-DD` shape the record form
 * writes, so a date set here and a date typed there are indistinguishable.
 *
 * DATES ARE COMPARED AS STRINGS, NEVER PARSED. `new Date('2026-08-14')` is UTC
 * midnight, which renders as the 13th for anyone west of Greenwich — a calendar
 * that puts invoices on the wrong day is worse than no calendar, and the bug
 * only appears for some users in some timezones, which is how it survives
 * review. `dayOf` slices the ISO prefix instead.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_PER_DAY = 3;

function Chip({ object, row, dragging = false }: { object: ObjectDef; row: any; dragging?: boolean }) {
  return (
    <div className={`px-1.5 py-1 rounded-md bg-accent/10 text-accent text-2xs font-medium truncate ${dragging ? 'shadow-lg ring-1 ring-accent/30' : ''}`}>
      {cardTitle(object, row)}
    </div>
  );
}

function DraggableChip({ object, row, onOpen, canMove }: {
  object: ObjectDef; row: any; onOpen: () => void; canMove: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: row.id, disabled: !canMove });
  return (
    <div ref={setNodeRef} {...(canMove ? attributes : {})} {...(canMove ? listeners : {})}
      onClick={onOpen}
      className={`outline-none ${canMove ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${isDragging ? 'opacity-40' : ''}`}>
      <Chip object={object} row={row} />
    </div>
  );
}

function Day({ day, inMonth, rows, object, onOpen, canMove, onExpand, expanded }: {
  day: string; inMonth: boolean; rows: any[]; object: ObjectDef;
  onOpen: (r: any) => void; canMove: boolean; onExpand: () => void; expanded: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: day, disabled: !canMove });
  const isToday = day === todayKey();
  const shown = expanded ? rows : rows.slice(0, MAX_PER_DAY);
  return (
    <div ref={setNodeRef}
      className={`min-h-[92px] p-1 border-b border-r border-subtle flex flex-col gap-1 transition-colors duration-150
        ${inMonth ? '' : 'bg-surface-sunken/40'} ${isOver ? 'bg-accent/10' : ''}`}>
      <div className="flex items-center justify-between px-0.5">
        <span className={`text-2xs tabular-nums ${isToday ? 'w-4 h-4 rounded-full bg-accent text-accent-fg inline-flex items-center justify-center font-semibold' : inMonth ? 'text-secondary' : 'text-tertiary'}`}>
          {Number(day.slice(8, 10))}
        </span>
      </div>
      {shown.map((r) => (
        <DraggableChip key={r.id} object={object} row={r} canMove={canMove} onOpen={() => onOpen(r)} />
      ))}
      {rows.length > MAX_PER_DAY && (
        <button onClick={onExpand} className="px-1.5 text-2xs text-tertiary hover:text-accent text-left">
          {expanded ? 'Show less' : `+${rows.length - MAX_PER_DAY} more`}
        </button>
      )}
    </div>
  );
}

export default function RecordCalendar({ object, rows, dateField, privy, onOpen, onChanged }: {
  object: ObjectDef;
  rows: any[];
  dateField: FieldDef;
  privy?: string | null;
  onOpen: (row: any) => void;
  onChanged?: () => void;
}) {
  const { notify } = useDialog();
  const [local, setLocal] = useState<any[]>(rows);
  const [anchor, setAnchor] = useState(() => new Date());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => { setLocal(rows); }, [rows]);

  const editable = (object.form || []).some((f) => f.key === dateField.key);
  const canMove = !!privy && editable;

  const { days } = useMemo(() => monthGrid(anchor), [anchor]);
  const month = anchor.getMonth();

  const byDay = useMemo(() => {
    const out = new Map<string, any[]>();
    for (const r of local) {
      const d = dayOf(r[dateField.key]);
      if (!d) continue;
      const bucket = out.get(d);
      if (bucket) bucket.push(r);
      else out.set(d, [r]);
    }
    return out;
  }, [local, dateField.key]);

  // Records whose date is empty have nowhere to sit. Saying so beats letting
  // someone conclude the calendar lost them.
  const undated = local.filter((r) => !dayOf(r[dateField.key])).length;

  const label = new Date(Date.UTC(anchor.getFullYear(), month, 1))
    .toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const shift = (n: number) => setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + n, 1));

  function onDragStart(e: DragStartEvent) { setActiveId(String(e.active.id)); }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || !canMove) return;
    const id = String(active.id);
    const day = String(over.id);
    const before = local;
    const moved = before.find((r) => r.id === id);
    if (!moved || dayOf(moved[dateField.key]) === day) return;

    setLocal((rs) => rs.map((r) => (r.id === id ? { ...r, [dateField.key]: day } : r)));

    const { error } = await updateRecord(privy!, object.slug, id, { [dateField.key]: day });
    if (error) {
      setLocal(before);
      notify(error);
    } else {
      onChanged?.();
    }
  }

  const activeRow = local.find((r) => r.id === activeId) || null;

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
            on {dateField.label}
            {undated > 0 && ` · ${undated} without a date`}
          </span>
        </div>

        <div className="grid grid-cols-7 shrink-0 border-t border-l border-subtle">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-1 border-b border-r border-subtle text-2xs font-semibold text-tertiary">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 flex-1 min-h-0 overflow-y-auto border-l border-subtle">
          {days.map((d) => (
            <Day key={d} day={d} inMonth={Number(d.slice(5, 7)) - 1 === month}
              rows={byDay.get(d) || []} object={object} onOpen={onOpen} canMove={canMove}
              expanded={expanded === d} onExpand={() => setExpanded((x) => (x === d ? null : d))} />
          ))}
        </div>
      </div>
      <DragOverlay>{activeRow ? <div className="w-40"><Chip object={object} row={activeRow} dragging /></div> : null}</DragOverlay>
    </DndContext>
  );
}
