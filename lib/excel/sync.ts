import { ensureTable, readRows, writeRows, getToken } from '@/lib/excel/graph';

/**
 * The sync itself (0079). Pure-ish on purpose: everything that talks to Graph
 * or Postgres arrives through `io`, so the conflict rules below are testable
 * without a Microsoft account or a network.
 *
 * THE RULES, in the order they run:
 *
 *   1. INBOUND FIRST. A person editing a cell is the most recent intent, so
 *      the sheet is read before anything is written back to it.
 *   2. A sheet row whose id is blank is a NEW record.
 *   3. A row that disappeared from the sheet does NOT delete the record.
 *   4. OUTBOUND LAST, rewriting the sheet from the database, so what the user
 *      sees after a sync is exactly what the workspace holds.
 *
 * Rule 3 is the one that protects people. A filter, a sort that pushed rows out
 * of the table range, or a stray "clear rows" all look identical to deletion
 * over the API, and honouring them would destroy records with no undo. Deleting
 * is done in the app, deliberately.
 */

/**
 * A `<field>_label` column, only when `<field>` is really on the record — so a
 * user's own column that happens to end in _label is still their column.
 */
const isRelationLabel = (h: string, rows: any[]) =>
  h.endsWith('_label') && rows.some((r) => h.slice(0, -6) in (r || {}));

/** Fields we never let a spreadsheet write back — they are not the user's to set. */
const READ_ONLY_FIELDS = new Set([
  'id', 'workspace_id', 'company_id', 'created_at', 'updated_at', 'created_by',
  'created_by_privy', 'search_vector', 'kind',
]);

export interface SyncIO {
  /** Current records for the object, as list_records returns them. */
  listRecords(object: string): Promise<any[]>;
  createRecord(object: string, data: Record<string, any>): Promise<string>;
  updateRecord(object: string, id: string, data: Record<string, any>): Promise<void>;
  /** Table plumbing — the Graph calls, injected so tests can stand in for them. */
  ensureTable(headers: string[], known?: string | null): Promise<{ name: string; headers: string[] }>;
  readRows(table: string): Promise<any[][]>;
  writeRows(table: string, rows: any[][]): Promise<void>;
  rememberTable(name: string): Promise<void>;
}

export interface SyncResult { rowsOut: number; rowsIn: number; created: number; updated: number; table: string }

/** A cell as Excel gives it back: everything is a string, a number or a bool. */
function toCell(v: any): string | number | boolean {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * Compare a database value with what came back from a cell.
 *
 * Excel round-trips are lossy in ways that matter here: 12 comes back as the
 * number 12 while the column holds "12", and an empty cell is '' where the
 * column holds null. Comparing raw would mark every unchanged row as edited and
 * write the whole sheet back into the database on every single sync.
 */
function sameValue(dbValue: any, cellValue: any): boolean {
  const a = toCell(dbValue);
  const b = cellValue === null || cellValue === undefined ? '' : cellValue;
  if (a === b) return true;
  return String(a).trim() === String(b).trim();
}

/** Columns worth showing in a sheet: stable order, noise dropped. */
export function headersFor(rows: any[]): string[] {
  const cols: string[] = [];
  for (const r of rows) {
    for (const k of Object.keys(r || {})) {
      if (k === 'search_vector') continue;
      if (!cols.includes(k)) cols.push(k);
    }
  }
  // id first — it is what the inbound pass matches on, so it should be the
  // column a user notices and leaves alone.
  return ['id', ...cols.filter((c) => c !== 'id')];
}

export async function syncLink(
  io: SyncIO,
  link: { object: string; direction: 'out' | 'in' | 'both'; table_name?: string | null },
): Promise<SyncResult> {
  const records = await io.listRecords(link.object);
  const headers = headersFor(records);

  const table = await io.ensureTable(headers, link.table_name);
  if (table.name !== link.table_name) await io.rememberTable(table.name);

  // The workbook's own header row wins for reading: a user may have added,
  // removed or reordered columns, and positions have to follow THEIR sheet.
  const sheetHeaders = table.headers?.length ? table.headers : headers;

  let created = 0, updated = 0, rowsIn = 0;

  if (link.direction === 'in' || link.direction === 'both') {
    const byId = new Map(records.map((r) => [String(r.id), r]));
    const idCol = sheetHeaders.indexOf('id');
    const rows = await io.readRows(table.name);

    for (const row of rows) {
      // Blank line inside the table range — Excel keeps these around after a
      // user clears a row's contents. Nothing to create from nothing.
      if (!row.some((c: any) => c !== '' && c !== null && c !== undefined)) continue;

      const patch: Record<string, any> = {};
      sheetHeaders.forEach((h, i) => {
        if (READ_ONLY_FIELDS.has(h)) return;
        // `<field>_label` is the resolved name of a link (0089), sent so the
        // sheet reads as words instead of uuids. It is derived, so editing that
        // cell cannot mean anything — update_record drops the key and the next
        // outbound pass writes the old name back. Skipping it keeps that a
        // no-op instead of a pointless write.
        if (isRelationLabel(h, records)) return;
        // A column the object doesn't have is the user's own working column
        // (a formula, a note). Sending it would fail validation; ignore it.
        if (records.length && !records.some((r) => h in r)) return;
        patch[h] = row[i] === '' ? null : row[i];
      });

      const id = idCol >= 0 ? String(row[idCol] ?? '').trim() : '';
      if (!id) {
        // Rule 2: a row the user typed in without an id is a new record.
        if (Object.values(patch).every((v) => v === null || v === '')) continue;
        await io.createRecord(link.object, patch);
        created++; rowsIn++;
        continue;
      }

      const current = byId.get(id);
      // An id in the sheet that no longer exists in the workspace: the record
      // was deleted in the app. Re-creating it from a stale sheet would make
      // deletion impossible, so the row is left to be cleared by the outbound
      // pass below.
      if (!current) continue;

      const changed: Record<string, any> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (!sameValue(current[k], v)) changed[k] = v;
      }
      if (Object.keys(changed).length) {
        await io.updateRecord(link.object, id, changed);
        updated++; rowsIn++;
      }
    }
  }

  let rowsOut = 0;
  if (link.direction === 'out' || link.direction === 'both') {
    // Re-read after an inbound pass, so the sheet ends up showing what was
    // actually stored — including anything the RPCs normalised on the way in.
    const fresh = rowsIn ? await io.listRecords(link.object) : records;
    const out = fresh.map((r) => sheetHeaders.map((h) => toCell(r[h])));
    await io.writeRows(table.name, out);
    rowsOut = out.length;
  }

  return { rowsOut, rowsIn, created, updated, table: table.name };
}

/**
 * Wire the pure engine to the real Graph + Postgres.
 *
 * `admin` is a service-role Supabase client; `privy` is the workspace member
 * the RPCs run as, so writes coming out of a spreadsheet are subject to exactly
 * the same validation and tenancy as writes made in the app.
 */
export function liveIO(opts: {
  admin: any; workspace: string; privy: string; linkId: string;
  token: string; driveId: string; itemId: string; sheet: string;
}): SyncIO {
  const { admin, workspace, privy, linkId, token, driveId, itemId, sheet } = opts;
  const rpc = async (fn: string, args: Record<string, any>) => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(error.message);   // .rpc() resolves on failure
    return data;
  };
  return {
    async listRecords(object) {
      const rpcObject = object === 'offers' ? 'invoices' : object;
      const rows = (await rpc('list_records', { p_privy: privy, p_workspace: workspace, p_object: rpcObject })) || [];
      if (object === 'offers') return rows.filter((r: any) => r.kind === 'offer');
      if (object === 'invoices') return rows.filter((r: any) => r.kind !== 'offer');
      return rows;
    },
    async createRecord(object, data) {
      const rpcObject = object === 'offers' ? 'invoices' : object;
      const payload = object === 'offers' ? { ...data, kind: 'offer' } : data;
      return rpc('create_record', { p_privy: privy, p_workspace: workspace, p_object: rpcObject, p_data: payload });
    },
    async updateRecord(object, id, data) {
      const rpcObject = object === 'offers' ? 'invoices' : object;
      // No p_workspace here — update_record derives it from the record's own
      // row, which is what makes it safe: the id cannot be pointed at another
      // tenant's data by passing a different workspace.
      await rpc('update_record', { p_privy: privy, p_object: rpcObject, p_id: id, p_data: data });
    },
    ensureTable: (headers, known) => ensureTable(token, driveId, itemId, sheet, headers, known),
    readRows: (table) => readRows(token, driveId, itemId, table),
    writeRows: (table, rows) => writeRows(token, driveId, itemId, table, rows),
    rememberTable: async (name) => { await rpc('set_excel_table_name', { p_id: linkId, p_table: name }); },
  };
}

export { getToken };
