'use client';

import { useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import type { PipelineStage, PipelineRecord } from '@/lib/crm/types';
import { rpc } from '@/lib/rpc';

function initials(s: string) {
  return (s || '?').split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function subjectOf(r: PipelineRecord) {
  return r.person?.name || r.company?.name || r.title || 'Untitled';
}

function CardBody({ rec, dragging = false }: { rec: PipelineRecord; dragging?: boolean }) {
  const subject = subjectOf(rec);
  const sub = rec.person?.title || rec.company?.domain;
  return (
    <div className={`bg-surface rounded-lg ring-1 ring-subtle p-2.5 ${dragging ? 'shadow-lg ring-strong rotate-1' : 'hover:ring-strong'} transition-all duration-150`}>
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 text-secondary text-[10px] font-semibold flex items-center justify-center shrink-0">{initials(subject)}</div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-primary truncate">{subject}</div>
          {sub && <div className="text-[11px] text-tertiary truncate">{sub}</div>}
        </div>
      </div>
      {rec.amount ? <div className="mt-2 text-[11px] font-semibold text-success tabular-nums">${rec.amount.toLocaleString()}</div> : null}
    </div>
  );
}

function Card({ rec }: { rec: PipelineRecord }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: rec.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
      className={`mb-2 cursor-grab active:cursor-grabbing outline-none ${isDragging ? 'opacity-40' : ''}`}>
      <CardBody rec={rec} />
    </div>
  );
}

function Column({ stage, records }: { stage: PipelineStage; records: PipelineRecord[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const sum = records.reduce((a, r) => a + (r.amount || 0), 0);
  return (
    <div className="w-64 shrink-0 flex flex-col max-h-full">
      <div className="flex items-center gap-2 px-1 mb-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: stage.color }} />
        <span className="text-[12px] font-semibold text-secondary">{stage.name}</span>
        <span className="text-[11px] text-tertiary tabular-nums">{records.length}</span>
        {sum > 0 && <span className="ml-auto text-[11px] font-semibold text-tertiary tabular-nums">${sum.toLocaleString()}</span>}
      </div>
      <div ref={setNodeRef}
        className={`flex-1 overflow-y-auto rounded-xl p-2 ring-1 transition-colors duration-150 ${isOver ? 'bg-accent/10 ring-accent/30' : 'bg-surface-sunken/60 ring-subtle'}`}>
        {records.map((r) => <Card key={r.id} rec={r} />)}
      </div>
    </div>
  );
}

export default function PipelineBoard({ stages, records: initial }: { stages: PipelineStage[]; records: PipelineRecord[] }) {
  const [records, setRecords] = useState<PipelineRecord[]>(initial);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function onDragStart(e: DragStartEvent) { setActiveId(String(e.active.id)); }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const stageId = String(over.id);
    setRecords((rs) => rs.map((r) => (r.id === active.id ? { ...r, stage_id: stageId } : r)));
    // Persist: rpc('move_pipeline_record', { p_privy, p_record: active.id, p_stage: stageId, p_position: 0 })
  }

  const activeRec = records.find((r) => r.id === activeId) || null;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex gap-4 h-full overflow-x-auto pb-2">
        {stages.map((s) => (
          <Column key={s.id} stage={s} records={records.filter((r) => r.stage_id === s.id)} />
        ))}
      </div>
      <DragOverlay>{activeRec ? <div className="w-60"><CardBody rec={activeRec} dragging /></div> : null}</DragOverlay>
    </DndContext>
  );
}
