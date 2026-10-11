// The glue around public/sheetcalc.wasm (GridCraft's formula engine — see
// wasm/sheetcalc/README.md), shared by the browser (lib/sheets/calc.ts) and the
// server (lib/sheets/calc-server.ts). Pure: no fetch, no fs, no 'use client'.

export type CellKind = '' | 's' | 'n' | 'b' | 'e';
/** What a cell shows, what it is, its number (numeric cells only), and why a formula failed to parse. */
export interface Computed { text: string; kind: CellKind; num: number | null; why?: string }

export interface SheetEngine {
  compute(rows: string[][], now?: number): Computed[][];
  functions(): string[];
}

interface Exports {
  memory: WebAssembly.Memory;
  rb_alloc(len: number): number;
  rb_free(ptr: number, len: number): void;
  rb_compute(ptr: number, len: number): bigint;
  rb_functions(): bigint;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function bindEngine(bytes: ArrayBuffer | Uint8Array): Promise<SheetEngine> {
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(bytes as BufferSource), {});
  const x = instance.exports as unknown as Exports;
  const call = (fn: 'rb_compute' | 'rb_functions', input?: string): string => {
    let p = 0, n = 0;
    if (input !== undefined) {
      const b = enc.encode(input);
      n = b.length;
      p = x.rb_alloc(n);
      new Uint8Array(x.memory.buffer, p, n).set(b);
    }
    const packed = BigInt.asUintN(64, input === undefined ? x.rb_functions() : x.rb_compute(p, n));
    const ptr = Number(packed >> BigInt(32)), len = Number(packed & BigInt(0xffffffff));
    const out = dec.decode(new Uint8Array(x.memory.buffer, ptr, len).slice());
    x.rb_free(ptr, len);
    if (input !== undefined) x.rb_free(p, n);
    return out;
  };
  return {
    compute(rows, now = nowSerial()) {
      const res = JSON.parse(call('rb_compute', JSON.stringify({ cells: rows, now })));
      if (res.error) throw new Error(res.error);
      return (res.cells as any[][]).map((r) => r.map(([text, kind, num, why]) => ({ text, kind, num, ...(why ? { why } : {}) })));
    },
    functions: () => JSON.parse(call('rb_functions')) as string[],
  };
}

/** Excel's serial date for the local now — TODAY() is today where the reader is. */
export function nowSerial(): number {
  const d = new Date();
  return (d.getTime() - d.getTimezoneOffset() * 60_000) / 86_400_000 + 25569;
}

/** A cell the engine treats as a formula. A leading apostrophe forces text, as in Excel. */
export const isFormula = (s: string) => s.length > 1 && s.startsWith('=');
export const hasFormulas = (rows: string[][]) => rows.some((r) => r.some(isFormula));

/** "A", "B" … "Z", "AA" — column letters for a 0-based index. */
export function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
