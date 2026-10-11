// Server only (node:fs).
// The same engine on the server, for agents: get_doc on a sheet returns the
// VALUES beside the formulas, so "what is the total?" is answered from the
// engine rather than by a model doing arithmetic over a markdown table.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bindEngine, hasFormulas, type SheetEngine } from './engine';
import { parseSheet } from '@/lib/crm/doc-formats';

let engine: Promise<SheetEngine> | null = null;
const load = () => (engine ??= readFile(join(process.cwd(), 'public', 'sheetcalc.wasm')).then(bindEngine).catch((e) => { engine = null; throw e; }));

/** Displayed values of a sheet body (header row first), or null when it has no formulas or the engine is missing. */
export async function sheetValues(body: string): Promise<string[][] | null> {
  const s = parseSheet(body);
  const grid = [s.headers, ...s.rows];
  if (!hasFormulas(grid)) return null;
  try {
    const out = (await load()).compute(grid);
    return out.map((r) => r.map((c) => c.text));
  } catch { engine = null; return null; }
}
