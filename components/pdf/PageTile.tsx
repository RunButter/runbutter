'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { RotateCw, Trash2, GripVertical, Check, Loader2 } from 'lucide-react';

export interface EditorPage {
  /** Stable identity for dnd-kit — must survive reordering. */
  key: string;
  fileIndex: number;
  pageIndex: number;
  rotation: number;
  thumb: string | null;      // null while it renders
  sourceName: string;
}

interface Props {
  page: EditorPage;
  index: number;
  selected: boolean;
  multiFile: boolean;
  onToggle: (key: string, shiftKey: boolean) => void;
  onRotate: (key: string) => void;
  onDelete: (key: string) => void;
}

export default function PageTile({ page, index, selected, multiFile, onToggle, onRotate, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.key });
  // 90° and 270° swap the page's long and short edges relative to the tile.
  const quarterTurn = page.rotation % 180 !== 0;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group ${isDragging ? 'opacity-40' : ''}`}
    >
      {/* The page image is the whole affordance. Caption sits BELOW it rather
          than overlaid — a permanent bar across every thumbnail buries the one
          thing the grid exists to show. */}
      <div
        className={`relative rounded-lg overflow-hidden bg-surface transition-shadow ${
          selected ? 'ring-2 ring-accent shadow-card' : 'ring-1 ring-subtle group-hover:shadow-card'
        }`}
      >
        <button
          type="button"
          onClick={(e) => onToggle(page.key, e.shiftKey)}
          className="block w-full aspect-[1/1.414] bg-surface-sunken"
          aria-pressed={selected}
          aria-label={`Page ${index + 1}${selected ? ', selected' : ''}`}
        >
          {page.thumb ? (
            <img
              src={page.thumb}
              alt=""
              // Rotated visually so the tile matches what will be exported,
              // without re-rasterising through pdf.js.
              //
              // CSS rotation happens AFTER layout, so a portrait page turned 90°
              // is still laid out portrait and spills past the tile's width —
              // it renders clipped on both sides. Scaling by the tile's own
              // aspect ratio (1 / 1.414) brings the long edge back inside.
              style={{ transform: `rotate(${page.rotation}deg)${quarterTurn ? ' scale(0.7072)' : ''}` }}
              className="w-full h-full object-contain transition-transform duration-200"
            />
          ) : (
            <span className="w-full h-full flex items-center justify-center text-tertiary">
              <Loader2 className="w-4 h-4 animate-spin" />
            </span>
          )}
        </button>

        {/* Actions reveal on hover; on touch they stay visible, since there is
            no hover to reveal them with. */}
        <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
          <button type="button" onClick={() => onRotate(page.key)}
            className="p-1.5 rounded-md bg-surface/90 text-secondary ring-1 ring-subtle hover:text-primary backdrop-blur-sm"
            aria-label={`Rotate page ${index + 1}`}>
            <RotateCw className="w-3 h-3" />
          </button>
          <button type="button" onClick={() => onDelete(page.key)}
            className="p-1.5 rounded-md bg-surface/90 text-secondary ring-1 ring-subtle hover:text-danger backdrop-blur-sm"
            aria-label={`Remove page ${index + 1}`}>
            <Trash2 className="w-3 h-3" />
          </button>
        </div>

        {/* Separate from the select target, or you cannot select without
            starting a drag. */}
        <button
          {...attributes}
          {...listeners}
          className="absolute top-1.5 left-1.5 p-1.5 rounded-md bg-surface/90 text-tertiary ring-1 ring-subtle opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100 cursor-grab active:cursor-grabbing backdrop-blur-sm transition-opacity"
          aria-label={`Reorder page ${index + 1}`}
        >
          <GripVertical className="w-3 h-3" />
        </button>

        {selected && (
          <span className="absolute bottom-1.5 right-1.5 w-4 h-4 rounded-full bg-accent text-accent-fg flex items-center justify-center">
            <Check className="w-2.5 h-2.5" />
          </span>
        )}
      </div>

      <div className="mt-1 flex items-baseline gap-1.5 px-0.5">
        <span className={`text-2xs tabular-nums ${selected ? 'text-accent font-medium' : 'text-tertiary'}`}>
          {index + 1}
        </span>
        {multiFile && <span className="text-2xs text-tertiary truncate">{page.sourceName}</span>}
      </div>
    </div>
  );
}
