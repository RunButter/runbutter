'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Upload } from 'lucide-react';
import { parseSheet, serializeSheet, csvToSheet, type Sheet } from '@/lib/crm/doc-formats';

/**
 * A small table.
 *
 * NOT A SPREADSHEET, and the difference is deliberate: no formulas, no cell
 * references, no recalculation. Anyone who needs those already has the
 * spreadsheet feed (0078) and two-way Excel sync (0079) pointing at real
 * records, and a half-built formula engine here would be a worse version of a
 * thing this product already integrates with properly. This is for the tables
 * that live inside a document — a rate card, a list of accounts, a set of
 * numbers someone pasted out of an email.
 *
 * It stores a markdown table in the same body column as every other kind, so it
 * opens in the rich editor, exports through one path, and is found by the same
 * search.
 */
export default function SheetEditor({ value, onChange, editable = true }: {
  value: string; onChange: (markdown: string) => void; editable?: boolean;
}) {
  const parsed = useMemo(() => parseSheet(value), [value]);
  const [sheet, setSheet] = useState<Sheet>(parsed);
  const emitted = useRef(value);
  const filePick = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value === emitted.current) return;
    setSheet(parseSheet(value));
    emitted.current = value;
  }, [value]);

  const commit = useCallback((next: Sheet) => {
    setSheet(next);
    const md = serializeSheet(next);
    emitted.current = md;
    onChange(md);
  }, [onChange]);

  const setCell = (r: number, c: number, v: string) =>
    commit({ ...sheet, rows: sheet.rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)) });

  const setHeader = (c: number, v: string) =>
    commit({ ...sheet, headers: sheet.headers.map((h, i) => (i === c ? v : h)) });

  const addRow = () => commit({ ...sheet, rows: [...sheet.rows, sheet.headers.map(() => '')] });

  const addCol = () => commit({
    headers: [...sheet.headers, `Column ${sheet.headers.length + 1}`],
    rows: sheet.rows.map((r) => [...r, '']),
  });

  // The last row and column stay, always. An empty grid has nowhere to type,
  // and "delete everything then wonder how to start again" is a dead end.
  const delRow = (r: number) =>
    sheet.rows.length > 1 && commit({ ...sheet, rows: sheet.rows.filter((_, i) => i !== r) });

  const delCol = (c: number) =>
    sheet.headers.length > 1 && commit({
      headers: sheet.headers.filter((_, i) => i !== c),
      rows: sheet.rows.map((r) => r.filter((_, i) => i !== c)),
    });

  /** Tab out of the last cell adds a row, so filling a table never needs the mouse. */
  const onKey = (e: React.KeyboardEvent, r: number, c: number) => {
    if (e.key === 'Tab' && !e.shiftKey && r === sheet.rows.length - 1 && c === sheet.headers.length - 1) {
      e.preventDefault(); addRow();
    }
  };

  const importCsv = async (file: File | undefined) => {
    if (!file) return;
    // Replaces rather than merges. Two tables with different columns cannot be
    // stitched together without guessing, and a guess here silently corrupts
    // the data someone just imported.
    commit(csvToSheet(await file.text()));
  };

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto px-5 sm:px-6 py-8">
        {/* The grid scrolls inside its own container — a wide table must never
            make the page scroll sideways. */}
        <div className="overflow-x-auto rounded-lg ring-1 ring-subtle bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {sheet.headers.map((h, c) => (
                  <th key={c} className="group relative border-b border-r border-subtle last:border-r-0 p-0 min-w-[9rem]">
                    <input value={h} disabled={!editable} onChange={(e) => setHeader(c, e.target.value)}
                      className="w-full h-9 px-2.5 bg-surface-sunken text-xs font-medium text-primary outline-none focus:bg-surface focus:ring-1 focus:ring-inset focus:ring-accent" />
                    {editable && sheet.headers.length > 1 && (
                      <button onClick={() => delCol(c)} aria-label={`Delete column ${h}`}
                        className="absolute top-0.5 right-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 text-tertiary hover:text-danger transition-opacity">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, r) => (
                <tr key={r} className="group">
                  {row.map((cell, c) => (
                    <td key={c} className="relative border-b border-r border-subtle last:border-r-0 p-0">
                      <input value={cell} disabled={!editable}
                        onChange={(e) => setCell(r, c, e.target.value)}
                        onKeyDown={(e) => onKey(e, r, c)}
                        className="w-full h-9 px-2.5 bg-transparent text-sm text-secondary outline-none focus:bg-surface-hover focus:ring-1 focus:ring-inset focus:ring-accent" />
                      {editable && c === row.length - 1 && sheet.rows.length > 1 && (
                        <button onClick={() => delRow(r)} aria-label={`Delete row ${r + 1}`}
                          className="absolute top-1/2 -translate-y-1/2 right-1 p-1 rounded opacity-0 group-hover:opacity-100 bg-surface text-tertiary hover:text-danger transition-opacity">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button onClick={addRow} disabled={!editable}
            className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-hover disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> Row
          </button>
          <button onClick={addCol} disabled={!editable}
            className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-hover disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> Column
          </button>
          <input ref={filePick} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => { importCsv(e.target.files?.[0]); e.target.value = ''; }} />
          <button onClick={() => filePick.current?.click()} disabled={!editable}
            title="Replaces the whole table"
            className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-hover disabled:opacity-40">
            <Upload className="w-3.5 h-3.5" /> Import CSV
          </button>
        </div>

        <p className="mt-4 text-2xs text-tertiary">
          Tab moves across, and adds a row at the end. Export as CSV or PDF from the menu above.
          For live data in a real spreadsheet, use Settings → Integrations instead.
        </p>
      </div>
    </div>
  );
}
