// Mail merge — one document, filled in for every selected record.
//
// The idea is Word's (WordCraft carries it too), and it is more at home here
// than in either: the records ARE the data. A letter written once with
// {{first_name}} and {{company}} becomes forty offer letters, contracts or
// renewal notices, without a CSV export in between.
//
// Pure: no fetch, no React. The modal (components/docs/MailMerge.tsx) loads the
// records; this file only reads fields and fills text.
import { OBJECTS } from '@/lib/crm/registry';
import { fmtDay } from '@/lib/utils';

const FIELD = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

/** The fields a template uses, in order of first appearance. */
export function mergeFields(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(FIELD)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Keys that are plumbing, not something a letter would say. */
const HIDDEN = /^(id|workspace_id|company_id|organization_id|person_id|owner_privy|created_by|updated_at|custom_fields|search_vector|fts|.*_tsv)$/;

/** Fields a record set offers, with a label for each — read from the rows themselves, so custom fields come too. */
export function availableFields(object: string, rows: Record<string, any>[]): { key: string; label: string }[] {
  const keys = new Set<string>();
  for (const r of rows.slice(0, 50)) {
    for (const [k, v] of Object.entries(r)) {
      if (HIDDEN.test(k) || (v !== null && typeof v === 'object')) continue;
      keys.add(k);
    }
  }
  const def = OBJECTS[object];
  const labelOf = (k: string) =>
    def?.form?.find((f) => f.key === k)?.label || def?.fields.find((f) => f.key === k)?.label ||
    k.replace(/_label$/, '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const synthetic = [{ key: 'today', label: 'Today’s date' }];
  if (keys.has('first_name') && !keys.has('name')) synthetic.push({ key: 'name', label: 'Full name' });
  return [...[...keys].map((key) => ({ key, label: labelOf(key) })), ...synthetic];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T|$)/;

/** A value as a sentence wants it: dates as "30 Sep 2026", numbers grouped, booleans as words. */
export function present(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return Number.isFinite(v) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v) : '';
  const s = String(v);
  if (ISO_DATE.test(s)) return fmtDay(s);
  return s;
}

function lookup(record: Record<string, any>, key: string): unknown {
  if (key === 'today') return new Date().toISOString().slice(0, 10);
  if (key in record) return record[key];
  const lower = key.toLowerCase();
  const hit = Object.keys(record).find((k) => k.toLowerCase() === lower);
  if (hit) return record[hit];
  if (lower === 'name' && (record.first_name || record.last_name)) return [record.first_name, record.last_name].filter(Boolean).join(' ');
  return undefined;
}

/** The template with every {{field}} replaced from one record. Unknown fields become blank. */
export function fill(body: string, record: Record<string, any>): string {
  return body.replace(FIELD, (_, key: string) => present(lookup(record, key)));
}

/** Fields the template uses that this record set does not have — said before anything is generated. */
export function unknownFields(body: string, fields: { key: string }[]): string[] {
  const known = new Set(fields.map((f) => f.key.toLowerCase()));
  return mergeFields(body).filter((f) => !known.has(f.toLowerCase()));
}

/** What to call one record in a list and in a file name. */
export function recordName(r: Record<string, any>): string {
  const person = [r.first_name, r.last_name].filter(Boolean).join(' ');
  return String(r.name || person || r.title || r.number || r.email || r.full_name || r.id || 'Record');
}
