/**
 * Board and calendar views for ANY object.
 *
 * WHY THIS EXISTS. Every object in this product — all eleven built-ins and
 * every object a workspace defines for itself (0087) — rendered as exactly one
 * thing: a table. Kanban existed, but only for `pipeline_records` on the deals
 * board; a calendar existed, but only for social posts; a timeline existed, but
 * only for the projects roadmap. None of the three could be pointed at
 * Invoices, or Issues, or a workspace's own Job Sites.
 *
 * That is the gap against Notion, ClickUp and Monday, whose whole product is
 * one set of records looked at several ways. It is not a small cosmetic gap:
 * "which invoices are stuck in review" and "what is due next week" are table
 * questions only in the sense that you can answer them by reading every row.
 *
 * The fix belongs HERE rather than in a per-object screen, for the same reason
 * the CRUD monolith has one branch per object instead of five parallel paths:
 * everything downstream reads `ObjectDef`, so a view built on `ObjectDef` works
 * for a custom object the day it is created, with no registration step. If a
 * board works for `invoices` and not for `job_sites`, that is a bug in this
 * file rather than a missing feature.
 *
 * PURE ON PURPOSE — no React, no Supabase. The components decide how a column
 * looks; this decides what the columns ARE, which is the part that has to agree
 * between the board, the calendar and the URL.
 */

import type { ObjectDef, FieldDef } from '@/lib/crm/types';

export type ViewKind = 'table' | 'board' | 'calendar';
export const VIEW_KINDS: ViewKind[] = ['table', 'board', 'calendar'];
export const isViewKind = (v: string): v is ViewKind => (VIEW_KINDS as string[]).includes(v);

/** The column a record falls into when its group field is empty. */
export const UNSET = '__unset__';
export const UNSET_LABEL = 'No value';

/**
 * A board with ninety columns is a spreadsheet turned on its side. Above this
 * many distinct values the field is not describing a state, it is describing an
 * identity (an invoice number, a person's name) and grouping by it is noise.
 */
const MAX_GROUPS = 24;

/**
 * Which fields could group a board.
 *
 * `tags` is how this codebase declares a small closed set — status, stage,
 * direction, category, priority — and `lib/crm/custom.ts` maps a custom
 * `select` field to the same type, which is what makes a workspace's own
 * objects work here for free.
 *
 * A `relation` is deliberately NOT offered. Grouping deals by company looks
 * useful right up until a workspace has four hundred companies, and the value
 * stored is a uuid whose label is resolved elsewhere — so the columns would be
 * both too many and unreadable.
 */
export function boardFields(object: ObjectDef, rows: any[]): FieldDef[] {
  return object.fields
    .filter((f) => f.type === 'tags')
    .filter((f) => {
      const distinct = new Set(rows.map((r) => norm(r[f.key])).filter((v) => v !== UNSET));
      // Zero distinct values means the column is empty everywhere and a board
      // would be one "No value" pile. One is a board with a single column,
      // which is still a legitimate thing to look at while a workspace fills
      // it in, so the floor is 1 rather than 2.
      return distinct.size >= 1 && distinct.size <= MAX_GROUPS;
    })
    // A field actually called status/stage/state is what someone means by "the
    // board", so it wins the default even when another tags column comes first
    // in the table.
    .sort((a, b) => rank(a) - rank(b));
}

const rank = (f: FieldDef) => (/^(status|stage|state)$/i.test(f.key) ? 0 : /^(priority|kind|type)$/i.test(f.key) ? 1 : 2);

/** The field a calendar lays out on: the first date column the object declares. */
export function calendarField(object: ObjectDef): FieldDef | undefined {
  return object.fields.find((f) => f.type === 'date');
}

/** A value as a group key. Null, undefined and '' are all one column, not three. */
export function norm(v: any): string {
  const s = v === null || v === undefined ? '' : String(v);
  return s.trim() === '' ? UNSET : s;
}

export interface BoardColumn { key: string; label: string; rows: any[] }

/**
 * Split rows into board columns.
 *
 * The column set is the DECLARED options for the field, then any value present
 * in the data that was never declared, then "No value" if anything is empty.
 *
 * Both halves are load-bearing. Declared-only would silently drop records
 * holding a legacy or externally-imported value — a card that exists, is
 * counted in the header, and appears in no column is the worst possible bug in
 * a board. Present-only would collapse an empty column the moment its last card
 * moved out, so a workspace could never drag anything back into "Won".
 */
export function groupRows(object: ObjectDef, rows: any[], key: string): BoardColumn[] {
  const declared = (object.form || []).find((f) => f.key === key)?.options || [];
  const present = Array.from(new Set(rows.map((r) => norm(r[key])))).filter((v) => v !== UNSET);
  const undeclared = present.filter((v) => !declared.includes(v)).sort();

  const keys = [...declared.filter((d) => d !== ''), ...undeclared];
  const cols: BoardColumn[] = keys.map((k) => ({ key: k, label: prettify(k), rows: [] }));

  // "No value" is appended only when something is actually in it. An empty
  // trailing column on every board would be permanent visual debt.
  const unset: BoardColumn = { key: UNSET, label: UNSET_LABEL, rows: [] };
  const byKey = new Map(cols.map((c) => [c.key, c]));

  for (const r of rows) {
    const g = norm(r[key]);
    (byKey.get(g) ?? unset).rows.push(r);
  }
  return unset.rows.length ? [...cols, unset] : cols;
}

export const prettify = (s: string) => s.replace(/_/g, ' ');

/** The date part of a stored value, or null. Never throws on junk. */
export function dayOf(v: any): string | null {
  if (!v) return null;
  const s = String(v);
  // Stored dates are ISO (`2026-08-14` or a full timestamptz). Slicing beats
  // `new Date()` here: parsing a bare date string treats it as UTC midnight and
  // then renders it as the PREVIOUS day for anyone west of Greenwich, which is
  // exactly the class of bug that makes a calendar untrustworthy.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Every day cell for the month grid containing `anchor`, Monday-first. */
export function monthGrid(anchor: Date): { days: string[]; month: number } {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const first = new Date(Date.UTC(y, m, 1));
  // getUTCDay: 0 = Sunday. Monday-first means Sunday sits at the END of a week.
  const lead = (first.getUTCDay() + 6) % 7;
  const start = new Date(first);
  start.setUTCDate(1 - lead);

  const days: string[] = [];
  // Six rows always. A month that fits in five would otherwise change the
  // page's height as you page through the year, which reads as a layout jump.
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return { days, month: m };
}

export const todayKey = () => {
  const n = new Date();
  // Local, not UTC: "today" on a calendar means the user's today.
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

/** The headline text for a card — the object's primary column, else its first. */
export function cardTitle(object: ObjectDef, row: any): string {
  const primary = object.fields.find((f) => f.primary) || object.fields[0];
  const v = primary ? row[primary.key] : null;
  return v === null || v === undefined || String(v).trim() === '' ? 'Untitled' : String(v);
}
