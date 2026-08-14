'use client';

import { useEffect, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import type { ObjectDef, FieldDef } from '@/lib/crm/types';
import { groupRows, cardTitle, norm, UNSET, type BoardColumn } from '@/lib/crm/views';
import { updateRecord } from '@/lib/crm/data';
import { useDialog } from '@/components/ui/Dialog';
import { FieldValue } from './RecordTable';

/**
 * A kanban board over ANY object, grouped by one of its `tags` columns.
 *
 * The deal board (PipelineBoard) does this for `pipeline_records` only, and it
 * cannot be reused: a deal's column is a row in `pipeline_stages` with an id, a
 * colour and an explicit order, while everything else in the product stores its
 * state as a plain string in a column. This board is the general case.
 *
 * MOVING A CARD IS A ONE-KEY PARTIAL UPDATE, and that is only safe because of
 * 0088. Before it, every `update_record` branch used a bare
 * `nullif(p_data->>'x','')` and therefore blanked every column the payload did
 * not mention — so dragging an invoice from Draft to Sent would have erased its
 * number, its dates and its notes. The rule now is key ABSENT = leave alone,
 * key PRESENT = write it, which is what makes `{ status: 'sent' }` a legal
 * thing to send.
 *
 * Dragging is offered only when the group field is EDITABLE — present in the
 * object's form. A `tags` column with no form entry is computed or read-only,
 * and a card that slides back a half-second later is worse than one that never
 * moved.
 */

function CardBody({ object, row, secondary, dragging = false }: {
  object: ObjectDef; row: any; secondary: FieldDef[]; dragging?: boolean;
}) {
  return (
    <div className={`bg-surface rounded-lg ring-1 p-2.5 transition-all duration-150 ${dragging ? 'shadow-lg ring-strong rotate-1' : 'ring-subtle hover:ring-strong'}`}>
      <div className="text-sm font-medium text-primary truncate">{cardTitle(object, row)}</div>
      {secondary.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {secondary.map((f) => {
            const v = row[f.key];
            if (v === null || v === undefined || String(v).trim() === '') return null;
            return (
              <span key={f.key} className="text-2xs text-tertiary inline-flex items-center gap-1 min-w-0">
                <FieldValue field={f} row={row} />
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Card({ object, row, secondary, onOpen, canMove }: {
  object: ObjectDef; row: any; secondary: FieldDef[]; onOpen: () => void; canMove: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: row.id, disabled: !canMove });
  return (
    <div
      ref={setNodeRef} {...(canMove ? attributes : {})} {...(canMove ? listeners : {})}
      // A click that never became a drag opens the record — the same gesture the
      // table row uses, so the two views behave identically.
      onClick={onOpen}
      className={`mb-2 outline-none ${canMove ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${isDragging ? 'opacity-40' : ''}`}>
      <CardBody object={object} row={row} secondary={secondary} />
    </div>
  );
}

function Column({ col, object, secondary, onOpen, canMove }: {
  col: BoardColumn; object: ObjectDef; secondary: FieldDef[];
  onOpen: (row: any) => void; canMove: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  return (
    <div className="w-64 shrink-0 flex flex-col max-h-full">
      <div className="flex items-center gap-2 px-1 mb-2">
        <span className={`text-xs font-semibold capitalize ${col.key === UNSET ? 'text-tertiary' : 'text-secondary'}`}>{col.label}</span>
        <span className="text-2xs text-tertiary tabular-nums">{col.rows.length}</span>
      </div>
      <div ref={setNodeRef}
        className={`flex-1 overflow-y-auto rounded-xl p-2 ring-1 transition-colors duration-150 ${isOver ? 'bg-accent/10 ring-accent/30' : 'bg-surface-sunken/60 ring-subtle'}`}>
        {col.rows.map((r) => (
          <Card key={r.id} object={object} row={r} secondary={secondary} canMove={canMove} onOpen={() => onOpen(r)} />
        ))}
        {col.rows.length === 0 && (
          <div className="h-16 rounded-lg border border-dashed border-subtle flex items-center justify-center text-2xs text-tertiary">
            {canMove ? 'Drop here' : 'Empty'}
          </div>
        )}
      </div>
    </div>
  );
}

export default function RecordBoard({ object, rows, groupKey, privy, onOpen, onChanged }: {
  object: ObjectDef;
  rows: any[];
  /** Which `tags` field forms the columns. */
  groupKey: string;
  /** Signed-in user id. Null means read-only — sample data or signed out. */
  privy?: string | null;
  onOpen: (row: any) => void;
  onChanged?: () => void;
}) {
  const { notify } = useDialog();
  const [local, setLocal] = useState<any[]>(rows);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // The parent owns the data and reloads after a write elsewhere (the copilot
  // creating a record, a filter changing). Without this the board would freeze
  // on whatever it was handed when it mounted.
  useEffect(() => { setLocal(rows); }, [rows]);

  // Writable only if the grouping column is something a person could edit on
  // the form. See the header — a card that springs back is worse than one that
  // never moved.
  const editable = (object.form || []).some((f) => f.key === groupKey);
  const canMove = !!privy && editable;

  // Two or three extra fields for context, skipping the headline (already the
  // title) and the grouping column (already the column it is sitting in).
  const secondary = object.fields
    .filter((f) => !f.primary && f.key !== groupKey && f.type !== 'avatar' && f.type !== 'image')
    .slice(0, 3);

  const columns = groupRows(object, local, groupKey);

  function onDragStart(e: DragStartEvent) { setActiveId(String(e.active.id)); }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || !canMove) return;
    const id = String(active.id);
    const target = String(over.id);
    const before = local;
    const moved = before.find((r) => r.id === id);
    if (!moved || norm(moved[groupKey]) === target) return;

    // Dropping into "No value" CLEARS the field. 0088 made an explicit null
    // mean "clear this column" rather than "ignore me", which is the only
    // reading that lets a board have an unset column at all.
    const value = target === UNSET ? null : target;

    setLocal((rs) => rs.map((r) => (r.id === id ? { ...r, [groupKey]: value } : r)));

    const { error } = await updateRecord(privy!, object.slug, id, { [groupKey]: value });
    if (error) {
      setLocal(before);   // put it back where it was, then say why
      notify(error);
    } else {
      onChanged?.();
    }
  }

  const activeRow = local.find((r) => r.id === activeId) || null;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex gap-4 h-full overflow-x-auto pb-2">
        {columns.map((c) => (
          <Column key={c.key} col={c} object={object} secondary={secondary} onOpen={onOpen} canMove={canMove} />
        ))}
      </div>
      <DragOverlay>
        {activeRow ? <div className="w-60"><CardBody object={object} row={activeRow} secondary={secondary} dragging /></div> : null}
      </DragOverlay>
    </DndContext>
  );
}
