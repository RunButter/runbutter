'use client';

import { useEffect, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { Trash2, Loader2 } from 'lucide-react';
import type { PipelineStage, PipelineRecord } from '@/lib/crm/types';
import { moveDeal, deleteDeal } from '@/lib/crm/data';
import { useDialog } from '@/components/ui/Dialog';
import CompanyLogo from './CompanyLogo';

/**
 * The deal board.
 *
 * DRAGGING USED TO BE A LIE. onDragEnd moved the card in local state and left a
 * comment where the write should have been, so every reorder survived exactly
 * until the next reload — the single worst kind of bug, because it looks like it
 * worked. It now calls move_pipeline_record and puts the card back if that
 * fails, which is the only honest way to do an optimistic update.
 *
 * `live` decides whether any of that is attempted at all: signed out, the board
 * is sample data, and dragging a made-up card must not produce an error about a
 * record id that never existed.
 */

/**
 * Person first, because a recruitment card IS a person and their name is the
 * only thing that identifies it. A sales deal usually has no person, so it
 * falls through to its own title — which is what the card should say, with the
 * company underneath as context. ("Q4 renewal" and "Northwind" are both true;
 * only one of them is the deal.)
 */
function subjectOf(r: PipelineRecord) {
  return r.person?.name || r.title || r.company?.name || 'Untitled';
}

function CardBody({ rec, dragging = false, onDelete, busy }: {
  rec: PipelineRecord; dragging?: boolean; onDelete?: () => void; busy?: boolean;
}) {
  const subject = subjectOf(rec);
  // Whatever the headline did NOT use: a role for a candidate, the company for
  // a deal. Never the same string twice.
  const sub = rec.person ? rec.person.title : (rec.company?.name !== subject ? rec.company?.name : rec.company?.domain);
  return (
    <div className={`group/card relative bg-surface rounded-lg ring-1 ring-subtle p-2.5 ${dragging ? 'shadow-lg ring-strong rotate-1' : 'hover:ring-strong'} transition-all duration-150`}>
      <div className="flex items-center gap-2">
        <CompanyLogo name={rec.company?.name || subject} domain={rec.company?.domain} size={24} />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-primary truncate">{subject}</div>
          {sub && <div className="text-2xs text-tertiary truncate">{sub}</div>}
        </div>
      </div>
      {rec.amount ? <div className="mt-2 text-2xs font-semibold text-success tabular-nums">${Number(rec.amount).toLocaleString()}</div> : null}
      {onDelete && (
        // Stops the pointer sensor claiming the press, or the button is
        // unclickable: a 4px move turns it into a drag.
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          aria-label={`Delete ${subject}`} disabled={busy}
          className="absolute top-1.5 right-1.5 p-1 rounded-md text-tertiary hover:text-danger hover:bg-danger/10 opacity-0 group-hover/card:opacity-100 focus:opacity-100 transition-opacity">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
}

function Card({ rec, onDelete, busy }: { rec: PipelineRecord; onDelete?: () => void; busy?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: rec.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
      className={`mb-2 cursor-grab active:cursor-grabbing outline-none ${isDragging ? 'opacity-40' : ''}`}>
      <CardBody rec={rec} onDelete={onDelete} busy={busy} />
    </div>
  );
}

function Column({ stage, records, onDelete, busyId }: {
  stage: PipelineStage; records: PipelineRecord[];
  onDelete?: (r: PipelineRecord) => void; busyId?: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const sum = records.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  return (
    <div className="w-64 shrink-0 flex flex-col max-h-full">
      <div className="flex items-center gap-2 px-1 mb-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: stage.color }} />
        <span className="text-xs font-semibold text-secondary">{stage.name}</span>
        <span className="text-2xs text-tertiary tabular-nums">{records.length}</span>
        {sum > 0 && <span className="ml-auto text-2xs font-semibold text-tertiary tabular-nums">${sum.toLocaleString()}</span>}
      </div>
      <div ref={setNodeRef}
        className={`flex-1 overflow-y-auto rounded-xl p-2 ring-1 transition-colors duration-150 ${isOver ? 'bg-accent/10 ring-accent/30' : 'bg-surface-sunken/60 ring-subtle'}`}>
        {records.map((r) => (
          <Card key={r.id} rec={r} busy={busyId === r.id}
            onDelete={onDelete ? () => onDelete(r) : undefined} />
        ))}
        {records.length === 0 && (
          <div className="h-16 rounded-lg border border-dashed border-subtle flex items-center justify-center text-2xs text-tertiary">
            Drop here
          </div>
        )}
      </div>
    </div>
  );
}

export default function PipelineBoard({ stages, records: initial, privy, live, onChanged }: {
  stages: PipelineStage[];
  records: PipelineRecord[];
  /** Signed-in user id. Null means nothing is persisted. */
  privy?: string | null;
  /** False when the board is showing sample data — writes are skipped. */
  live?: boolean;
  onChanged?: () => void;
}) {
  const { confirm: confirmDialog, notify } = useDialog();
  const [records, setRecords] = useState<PipelineRecord[]>(initial);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // The parent reloads after a create; without this the new deal never appears,
  // because this component owns the list once it is mounted.
  useEffect(() => { setRecords(initial); }, [initial]);

  const canWrite = !!privy && !!live;

  function onDragStart(e: DragStartEvent) { setActiveId(String(e.active.id)); }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const id = String(active.id);
    const stageId = String(over.id);
    const before = records;
    const moved = before.find((r) => r.id === id);
    if (!moved || moved.stage_id === stageId) return;

    // Top of the target column, matching where create_pipeline_record puts a
    // new card — the thing you just acted on is the thing you want to see.
    const position = Math.min(0, ...before.filter((r) => r.stage_id === stageId).map((r) => r.position)) - 1;

    setRecords((rs) => rs.map((r) => (r.id === id ? { ...r, stage_id: stageId, position } : r)));
    if (!canWrite) return;

    const { error } = await moveDeal(privy!, id, stageId, position);
    if (error) {
      setRecords(before);   // put it back where it was, then say why
      notify(error);
    } else {
      onChanged?.();
    }
  }

  async function remove(rec: PipelineRecord) {
    const ok = await confirmDialog({
      title: `Delete “${subjectOf(rec)}”?`,
      body: 'This removes the deal from the pipeline. It cannot be undone.',
    });
    if (!ok) return;
    setBusyId(rec.id);
    const { error } = await deleteDeal(privy!, rec.id);
    setBusyId(null);
    if (error) return notify(error);
    setRecords((rs) => rs.filter((r) => r.id !== rec.id));
    onChanged?.();
  }

  const activeRec = records.find((r) => r.id === activeId) || null;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex gap-4 h-full overflow-x-auto pb-2">
        {stages.map((s) => (
          <Column key={s.id} stage={s} busyId={busyId}
            records={records.filter((r) => r.stage_id === s.id).sort((a, b) => a.position - b.position)}
            onDelete={canWrite ? remove : undefined} />
        ))}
      </div>
      <DragOverlay>{activeRec ? <div className="w-60"><CardBody rec={activeRec} dragging /></div> : null}</DragOverlay>
    </DndContext>
  );
}
