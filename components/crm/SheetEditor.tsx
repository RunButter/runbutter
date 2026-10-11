'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Upload, FunctionSquare } from 'lucide-react';
import { parseSheet, serializeSheet, csvToSheet, type Sheet } from '@/lib/crm/doc-formats';
import { computeSheet, sheetFunctions, isFormula, colName, type Computed } from '@/lib/sheets/calc';

/**
 * A table that can calculate.
 *
 * It used to say "NOT A SPREADSHEET — a half-built formula engine here would be
 * worse than none", and that was right: the engine is the hard part. This one
 * is not half-built. It is GridCraft's (wasm/sheetcalc/README.md, MIT): Excel's
 * formula language, 501 functions, Excel number formats, dynamic arrays — the
 * same `=SUMIFS(…)` and `=XLOOKUP(…)` people already know.
 *
 * What did NOT change is the storage: the body is still a markdown table, and a
 * cell holds what the person typed ("=B2*C2", "$2.50"). Every other editor,
 * search, the export path and the agents read the same text. Values are derived
 * on every render and never stored, so they cannot go stale.
 *
 * Addressing is what you see: column letters across the top, row numbers down
 * the side, and the HEADER row is row 1 — so data starts at row 2, exactly as
 * in a spreadsheet whose first row holds the titles.
 */
type Pos = { r: number; c: number };

export default function SheetEditor({ value, onChange, editable = true }: {
  value: string; onChange: (markdown: string) => void; editable?: boolean;
}) {
  const parsed = useMemo(() => parseSheet(value), [value]);
  const [sheet, setSheet] = useState<Sheet>(parsed);
  const emitted = useRef(value);
  const filePick = useRef<HTMLInputElement>(null);

  // grid[0] is the header row (row 1); grid[1..] are the data rows.
  const grid = useMemo(() => [sheet.headers, ...sheet.rows], [sheet]);

  const [sel, setSel] = useState<Pos | null>(null);
  // Which cell's input has focus — that one shows its formula, the rest show values.
  const [focused, setFocused] = useState<Pos | null>(null);
  const [computed, setComputed] = useState<Computed[][] | null>(null);
  const [engine, setEngine] = useState<'off' | 'loading' | 'ready' | 'failed'>('off');
  const [fns, setFns] = useState<string[]>([]);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const bar = useRef<HTMLInputElement>(null);
  // The element a formula is being typed into (a cell or the formula bar).
  const active = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (value === emitted.current) return;
    setSheet(parseSheet(value));
    emitted.current = value;
  }, [value]);

  const wantsEngine = useMemo(() => grid.some((r) => r.some((x) => x.startsWith('='))), [grid]);

  // Load the engine the first time anything looks like a formula, then
  // recompute on every change. A sheet with no formulas never downloads it.
  useEffect(() => {
    if (!wantsEngine) { setComputed(null); return; }
    let cancelled = false;
    if (engine === 'off') setEngine('loading');
    computeSheet(grid)
      .then((out) => { if (!cancelled) { setComputed(out); setEngine('ready'); } })
      .catch(() => { if (!cancelled) setEngine('failed'); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, wantsEngine]);

  useEffect(() => { if (engine === 'ready' && !fns.length) sheetFunctions().then(setFns); }, [engine, fns.length]);

  const commit = useCallback((next: Sheet) => {
    setSheet(next);
    const md = serializeSheet(next);
    emitted.current = md;
    onChange(md);
  }, [onChange]);

  const setCell = (r: number, c: number, v: string) => {
    if (r === 0) commit({ ...sheet, headers: sheet.headers.map((h, i) => (i === c ? v : h)) });
    else commit({ ...sheet, rows: sheet.rows.map((row, i) => (i === r - 1 ? row.map((x, j) => (j === c ? v : x)) : row)) });
  };

  const addRow = () => commit({ ...sheet, rows: [...sheet.rows, sheet.headers.map(() => '')] });
  const addCol = () => commit({
    headers: [...sheet.headers, `Column ${sheet.headers.length + 1}`],
    rows: sheet.rows.map((r) => [...r, '']),
  });
  // The last row and column stay, always. An empty grid has nowhere to type,
  // and "delete everything then wonder how to start again" is a dead end.
  const delRow = (r: number) =>
    sheet.rows.length > 1 && commit({ ...sheet, rows: sheet.rows.filter((_, i) => i !== r - 1) });
  const delCol = (c: number) =>
    sheet.headers.length > 1 && commit({
      headers: sheet.headers.filter((_, i) => i !== c),
      rows: sheet.rows.map((r) => r.filter((_, i) => i !== c)),
    });

  const focusCell = (p: Pos) => { const el = inputs.current.get(`${p.r}:${p.c}`); el?.focus(); el?.select(); };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const last = { r: grid.length - 1, c: grid[0].length - 1 };
    // Tab out of the last cell adds a row, so filling a table never needs the mouse.
    if (e.key === 'Tab' && !e.shiftKey && r === last.r && c === last.c && editable) {
      e.preventDefault(); addRow(); setTimeout(() => focusCell({ r: r + 1, c: 0 }), 0);
    } else if (e.key === 'Enter') {
      // Enter moves down, as in every spreadsheet (and commits the formula).
      e.preventDefault();
      if (r < last.r) focusCell({ r: r + 1, c });
      else if (editable) { addRow(); setTimeout(() => focusCell({ r: r + 1, c }), 0); }
    } else if (e.key === 'Escape') {
      (e.target as HTMLInputElement).blur();
    }
  };

  /**
   * Click another cell while typing a formula and its address goes in, the way
   * Excel does it — the formula keeps focus. Shift-click turns the reference
   * just inserted into a range ("B2" → "B2:B5").
   */
  const onCellMouseDown = (e: React.MouseEvent, r: number, c: number) => {
    const el = active.current;
    if (!el || !el.value.startsWith('=') || document.activeElement !== el) return;
    if (focused && focused.r === r && focused.c === c && el !== bar.current) return;
    e.preventDefault();
    const ref = `${colName(c)}${r + 1}`;
    const caret = el.selectionStart ?? el.value.length;
    let before = el.value.slice(0, caret);
    const after = el.value.slice(el.selectionEnd ?? caret);
    let insert = ref;
    const prev = /([A-Z]{1,3}\d{1,6})$/.exec(before);
    if (e.shiftKey && prev) { before = before.slice(0, -prev[1].length); insert = `${prev[1]}:${ref}`; }
    else if (prev) before = before.slice(0, -prev[1].length); // clicking again swaps the reference
    const next = before + insert + after;
    const target = sel || focused;
    if (target) setCell(target.r, target.c, next);
    requestAnimationFrame(() => { el.focus(); const at = (before + insert).length; el.setSelectionRange(at, at); });
  };

  const selRaw = sel ? grid[sel.r]?.[sel.c] ?? '' : '';
  const token = /([A-Za-z][A-Za-z0-9.]*)$/.exec(isFormula(selRaw) ? selRaw : '')?.[1]?.toUpperCase() || '';
  const suggestions = token && fns.length ? rankFunctions(fns, token) : [];
  const accept = (name: string) => {
    if (!sel) return;
    const next = selRaw.slice(0, selRaw.length - token.length) + name + '(';
    setCell(sel.r, sel.c, next);
    requestAnimationFrame(() => { const el = active.current || bar.current; el?.focus(); el?.setSelectionRange(next.length, next.length); });
  };

  const shown = (r: number, c: number, raw: string): { text: string; cell?: Computed } => {
    const out = computed?.[r]?.[c];
    if (!out || (focused && focused.r === r && focused.c === c)) return { text: raw };
    // Only formulas and recognisable values ("$2.50", "50%", a date) change on
    // display; plain text stays exactly as typed.
    if (isFormula(raw) || out.kind === 'n' || out.kind === 'e') return { text: out.text, cell: out };
    return { text: raw, cell: out };
  };

  const cellClass = (cell?: Computed) =>
    cell?.kind === 'e' ? 'text-danger' : cell?.kind === 'n' ? 'text-right tabular-nums' : '';

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto px-5 sm:px-6 py-6">
        {/* Formula bar: the selected cell's address and what is really in it. */}
        <div className="relative mb-2">
          <div className="flex items-center gap-2 rounded-lg ring-1 ring-subtle bg-surface px-2 h-9">
            <span className="w-12 shrink-0 text-xs font-mono text-tertiary text-center">{sel ? `${colName(sel.c)}${sel.r + 1}` : ''}</span>
            <FunctionSquare className="w-4 h-4 text-tertiary shrink-0" aria-hidden />
            <input ref={bar} value={selRaw} disabled={!editable || !sel} aria-label="Cell contents"
              onFocus={() => { active.current = bar.current; }}
              onChange={(e) => sel && setCell(sel.r, sel.c, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && sel) { e.preventDefault(); focusCell(sel); } if (e.key === 'Tab' && suggestions[0]) { e.preventDefault(); accept(suggestions[0]); } }}
              placeholder={sel ? 'Type a value, or = to start a formula' : 'Select a cell'}
              className="flex-1 min-w-0 h-full bg-transparent text-sm font-mono text-primary outline-none placeholder:font-sans placeholder:text-tertiary" />
            {engine === 'loading' && <span className="text-3xs text-tertiary shrink-0">Loading formulas…</span>}
            {engine === 'failed' && <span className="text-3xs text-danger shrink-0">Formulas unavailable</span>}
          </div>
          {suggestions.length > 0 && (
            <div className="absolute left-16 top-10 z-10 rounded-lg bg-surface ring-1 ring-subtle shadow-popover p-1 min-w-[10rem]">
              {suggestions.map((f, i) => (
                <button key={f} onMouseDown={(e) => { e.preventDefault(); accept(f); }}
                  className={`block w-full text-left px-2 py-1 rounded text-xs font-mono hover:bg-surface-hover ${i === 0 ? 'text-primary' : 'text-secondary'}`}>
                  {f}{i === 0 && <span className="ml-2 font-sans text-3xs text-tertiary">Tab</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* The grid scrolls inside its own container — a wide table must never
            make the page scroll sideways. */}
        <div className="overflow-x-auto rounded-lg ring-1 ring-subtle bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-10 border-b border-r border-subtle bg-surface-sunken" />
                {grid[0].map((_, c) => (
                  <th key={c} className={`group relative h-6 border-b border-r border-subtle last:border-r-0 bg-surface-sunken text-3xs font-medium ${sel?.c === c ? 'text-primary' : 'text-tertiary'}`}>
                    {colName(c)}
                    {editable && grid[0].length > 1 && (
                      <button onClick={() => delCol(c)} aria-label={`Delete column ${colName(c)}`}
                        className="absolute top-0.5 right-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 text-tertiary hover:text-danger transition-opacity">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row, r) => (
                <tr key={r} className="group">
                  <td className={`relative w-10 border-b border-r border-subtle bg-surface-sunken text-center text-3xs tabular-nums ${sel?.r === r ? 'text-primary' : 'text-tertiary'}`}>
                    {r + 1}
                    {editable && r > 0 && sheet.rows.length > 1 && (
                      <button onClick={() => delRow(r)} aria-label={`Delete row ${r + 1}`}
                        className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-surface-sunken text-tertiary hover:text-danger transition-opacity">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </td>
                  {row.map((raw, c) => {
                    const { text, cell } = shown(r, c, raw);
                    const isSel = sel?.r === r && sel?.c === c;
                    return (
                      <td key={c} onMouseDown={(e) => onCellMouseDown(e, r, c)}
                        className={`relative border-b border-r border-subtle last:border-r-0 p-0 min-w-[8rem] ${r === 0 ? 'bg-surface-sunken/60' : ''}`}>
                        <input
                          ref={(el) => { const k = `${r}:${c}`; if (el) inputs.current.set(k, el); else inputs.current.delete(k); }}
                          value={text} readOnly={!editable}
                          aria-label={`${colName(c)}${r + 1}`}
                          title={cell?.why ? `Formula problem: ${cell.why}` : cell?.kind === 'e' && isFormula(raw) ? raw : undefined}
                          onFocus={(e) => { setSel({ r, c }); setFocused({ r, c }); active.current = e.currentTarget; }}
                          onBlur={() => setFocused((f) => (f && f.r === r && f.c === c ? null : f))}
                          onChange={(e) => setCell(r, c, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Tab' && suggestions[0] && isSel && isFormula(raw)) { e.preventDefault(); accept(suggestions[0]); return; }
                            onKey(e, r, c);
                          }}
                          className={`w-full h-9 px-2.5 bg-transparent outline-none focus:bg-surface-hover focus:ring-1 focus:ring-inset focus:ring-accent ${r === 0 ? 'text-xs font-medium text-primary' : 'text-sm text-secondary'} ${cellClass(cell)} ${isSel && !focused ? 'ring-1 ring-inset ring-accent/60' : ''}`} />
                      </td>
                    );
                  })}
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
            onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) commit(csvToSheet(await f.text())); }} />
          <button onClick={() => filePick.current?.click()} disabled={!editable}
            title="Replaces the whole table"
            className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-hover disabled:opacity-40">
            <Upload className="w-3.5 h-3.5" /> Import CSV
          </button>
        </div>

        <p className="mt-4 text-2xs text-tertiary leading-relaxed">
          Type <code className="font-mono bg-surface-hover rounded px-1">=</code> to start a formula — <code className="font-mono">=SUM(B2:B9)</code>, <code className="font-mono">=AVERAGE()</code>, <code className="font-mono">=IF()</code>, <code className="font-mono">=XLOOKUP()</code> and 500 more work as in Excel.
          While typing one, click a cell to insert it; shift-click for a range. Row 1 is the header row. Enter moves down, Tab across.
          Exports show the values; Markdown keeps the formulas.
        </p>
        <p className="mt-1 text-3xs text-tertiary">Formula engine: GridCraft (MIT).</p>
      </div>
    </div>
  );
}

/**
 * What people actually type first. Alphabetical put SUBSTITUTE above SUM for
 * "=SU", so Tab completed the wrong function on the most common formula there is.
 */
const COMMON = ['SUM', 'AVERAGE', 'COUNT', 'COUNTA', 'IF', 'IFERROR', 'MIN', 'MAX', 'ROUND', 'SUMIF', 'SUMIFS', 'COUNTIF',
  'COUNTIFS', 'AVERAGEIF', 'XLOOKUP', 'VLOOKUP', 'INDEX', 'MATCH', 'TODAY', 'NOW', 'DATE', 'EDATE', 'EOMONTH', 'TEXT',
  'CONCAT', 'TEXTJOIN', 'LEFT', 'RIGHT', 'MID', 'LEN', 'UPPER', 'LOWER', 'TRIM', 'ABS', 'AND', 'OR', 'NOT', 'PMT',
  'NETWORKDAYS', 'WORKDAY', 'UNIQUE', 'FILTER', 'SORT', 'SUMPRODUCT', 'MEDIAN', 'PERCENTAGE', 'ROUNDUP', 'ROUNDDOWN'];

function rankFunctions(all: string[], token: string): string[] {
  const rank = (f: string) => { const i = COMMON.indexOf(f); return i === -1 ? 1000 + f.length : i; };
  return all.filter((f) => f.startsWith(token) && f !== token).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, 6);
}
