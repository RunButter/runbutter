// Formulas for Docs sheets — the browser side of public/sheetcalc.wasm.
//
// The engine is GridCraft's (MIT; wasm/sheetcalc/README.md): Excel's formula
// language, 501 functions, number formats, dynamic arrays. It is loaded only
// when a sheet actually contains a formula, so a page that never computes
// never downloads it (~620 KB compressed).
//
// The sheet's MARKDOWN stays the document: a cell holds what the person typed
// ("=B2*C2"), every editor and export can still open it, and the values are
// derived on every render. Same rule as the rest of Docs — one body, many
// views — and it means an agent reading the body sees the formulas.
import meta from './sheetcalc-meta.json';
import { bindEngine, hasFormulas, type Computed, type SheetEngine } from './engine';
import { parseSheet, serializeSheet } from '@/lib/crm/doc-formats';

export { isFormula, hasFormulas, colName, type Computed, type CellKind } from './engine';

let engine: Promise<SheetEngine> | null = null;

function load(): Promise<SheetEngine> {
  if (!engine) {
    engine = fetch(`/sheetcalc.wasm?v=${meta.sha256.slice(0, 12)}`)
      .then((r) => { if (!r.ok) throw new Error(`sheet engine unavailable (${r.status})`); return r.arrayBuffer(); })
      .then(bindEngine);
    engine.catch(() => { engine = null; });
  }
  return engine;
}

/**
 * Computes a grid of typed inputs. Row 0 is row 1 in A1 terms, so a sheet's
 * header row is row 1 exactly as it looks on screen.
 */
export async function computeSheet(rows: string[][]): Promise<Computed[][]> {
  const e = await load();
  try { return e.compute(rows); }
  catch (err) {
    // A trap (a pathological formula overflowing the stack) poisons the
    // instance; the next call gets a fresh one rather than broken memory.
    if (err instanceof WebAssembly.RuntimeError) engine = null;
    throw err;
  }
}

let fnNames: Promise<string[]> | null = null;
/** Every function the engine knows, for autocomplete. */
export function sheetFunctions(): Promise<string[]> {
  if (!fnNames) fnNames = load().then((e) => e.functions()).catch(() => { fnNames = null; return []; });
  return fnNames;
}

/**
 * The sheet as people see it: every formula replaced by its value. What every
 * export but Markdown writes — a PDF showing "=B2*C2" is useless, and a CSV
 * carrying live formulas into somebody else's Excel is the classic CSV
 * injection. The markdown export stays the source, formulas and all.
 */
export async function sheetWithValues(body: string): Promise<string> {
  const s = parseSheet(body);
  const grid = [s.headers, ...s.rows];
  if (!hasFormulas(grid)) return body;
  try {
    const out = await computeSheet(grid);
    const text = out.map((r) => r.map((c) => c.text));
    return serializeSheet({ headers: text[0], rows: text.slice(1) });
  } catch { return body; }
}
