'use client';

import { rpc } from '@/lib/rpc';
import type { ObjectDef, FieldDef, FormField, FieldType } from './types';

/**
 * Custom objects (0087) — a workspace's own record types.
 *
 * THE KEY IDEA: a custom object is converted into the SAME `ObjectDef` the
 * hardcoded registry produces, so `RecordTable`, `RecordForm`, `RecordDetail`,
 * the filter bar, import and export all render it with no bespoke code. The
 * generic views were built against one shape; this is that shape, assembled at
 * runtime instead of at compile time.
 *
 * Nothing here talks to `custom_records` directly. Reads and writes go through
 * `list/get/create/update/delete_record` exactly as a built-in does — which is
 * also why agents, /api/mcp, the CSV feed and Excel sync pick these up for
 * free.
 */

// One list, defined in lib/workspace/blueprint.ts — which has no imports and
// is therefore safe for a route handler to read. Re-exported so call sites can
// keep importing it from here.
export { FIELD_TYPES, FIELD_TYPE_LABEL, type CustomFieldType } from '@/lib/workspace/blueprint';
import type { CustomFieldType } from '@/lib/workspace/blueprint';

export interface CustomField {
  id: string; key: string; label: string; type: CustomFieldType;
  options: string[]; relation_to: string | null;
  required: boolean; is_primary: boolean; position: number;
}

export interface CustomObject {
  id: string; slug: string; singular: string; plural: string;
  icon: string; group_key: string; description: string;
  position: number; enabled: boolean; record_count: number;
  fields: CustomField[];
}

const NOT_SET_UP = /schema cache|does not exist|Could not find the function/i;
export const needsMigration = (m?: string) => !!m && NOT_SET_UP.test(m);

export async function loadCustomObjects(privy: string, ws: string): Promise<{ rows: CustomObject[]; error?: string }> {
  const { data, error } = await rpc('get_custom_objects', { p_privy: privy, p_workspace: ws });
  if (error) {
    return { rows: [], error: needsMigration(error.message)
      ? 'Custom objects need migration 0087 — run it in Supabase.'
      : error.message };
  }
  return { rows: Array.isArray(data) ? (data as CustomObject[]) : [] };
}

export async function saveCustomObject(
  privy: string, ws: string, o: Partial<CustomObject> & { id?: string | null },
): Promise<{ id?: string; error?: string }> {
  const { data, error } = await rpc('save_custom_object', {
    p_privy: privy, p_workspace: ws, p_id: o.id ?? null,
    p_slug: o.slug ?? '', p_singular: o.singular ?? '', p_plural: o.plural ?? '',
    p_icon: o.icon ?? 'Table2', p_group: o.group_key ?? 'Workspace',
    p_description: o.description ?? '',
  });
  if (error) return { error: friendly(error.message) };
  return { id: data as string };
}

export async function saveCustomField(
  privy: string, ws: string, objectId: string, f: Partial<CustomField> & { id?: string | null },
): Promise<{ id?: string; error?: string }> {
  const { data, error } = await rpc('save_custom_field', {
    p_privy: privy, p_workspace: ws, p_object: objectId, p_id: f.id ?? null,
    p_key: f.key ?? '', p_label: f.label ?? '', p_type: f.type ?? 'text',
    p_options: f.options ?? [], p_relation_to: f.relation_to ?? null,
    p_required: f.required ?? false, p_primary: f.is_primary ?? false,
    p_position: f.position ?? null,
  });
  if (error) return { error: friendly(error.message) };
  return { id: data as string };
}

export const deleteCustomField = (privy: string, ws: string, id: string) =>
  rpc('delete_custom_field', { p_privy: privy, p_workspace: ws, p_id: id });

export const deleteCustomObject = (privy: string, ws: string, id: string) =>
  rpc('delete_custom_object', { p_privy: privy, p_workspace: ws, p_id: id });

/**
 * SQL error codes → something a person can act on.
 *
 * These are deliberately terse in the database (they are also read by agents
 * and by /api/mcp); the sentence belongs here, next to the form that caused it.
 */
function friendly(msg: string): string {
  if (/RESERVED_SLUG/.test(msg)) return 'That name is already a built-in object. Pick another.';
  if (/BAD_SLUG/.test(msg)) return 'Use lowercase letters, numbers and underscores — e.g. service_calls.';
  if (/BAD_FIELD_KEY/.test(msg)) return 'Field keys use lowercase letters, numbers and underscores.';
  if (/RESERVED_FIELD_KEY/.test(msg)) return '“id”, “created_at” and “updated_at” are reserved.';
  if (/FORBIDDEN/.test(msg)) return 'Only an owner or admin can change objects and fields.';
  if (/duplicate key|unique/i.test(msg)) return 'Something with that name already exists here.';
  if (needsMigration(msg)) return 'Custom objects need migration 0087 — run it in Supabase.';
  return msg;
}

// ── Turning a custom object into the shape the generic views already read ────

/** Custom field type → how the table renders the column. */
const TABLE_TYPE: Record<CustomFieldType, FieldType> = {
  text: 'text', long_text: 'text', number: 'number', currency: 'currency',
  date: 'date', checkbox: 'boolean', select: 'tags', email: 'text',
  url: 'text', phone: 'text', relation: 'relation',
};

/** Custom field type → which editor the form uses. */
const FORM_INPUT: Record<CustomFieldType, FormField['input']> = {
  text: 'text', long_text: 'textarea', number: 'number', currency: 'number',
  date: 'date', checkbox: 'select', select: 'select', email: 'text',
  url: 'text', phone: 'text', relation: 'relation',
};

export function toObjectDef(o: CustomObject): ObjectDef {
  const fields = [...o.fields].sort((a, b) => a.position - b.position);
  // The headline column, which the table links from and the detail view titles
  // with. Falls back to the first field — an object with no primary marked
  // still has to have a name, and `custom_record_label` in SQL picks the same
  // one, so the two never disagree.
  const primary = fields.find((f) => f.is_primary) ?? fields[0];

  const table: FieldDef[] = fields.length
    ? fields.slice(0, 8).map((f) => ({
        key: f.key,
        label: f.label || f.key,
        type: TABLE_TYPE[f.type],
        primary: f.key === primary?.key,
        align: f.type === 'number' || f.type === 'currency' ? 'right' : undefined,
        width: f.type === 'long_text' ? 260 : undefined,
      }))
    // An object with no fields yet still renders — as its name alone, which
    // `list_records` always supplies. A blank screen after creating an object
    // reads as a broken save.
    : [{ key: 'name', label: 'Name', type: 'text', primary: true }];

  const form: FormField[] = fields.map((f) => ({
    key: f.key,
    label: f.label || f.key,
    input: FORM_INPUT[f.type],
    // A checkbox has no boolean input in the shared form, so it becomes a
    // two-option select — the SQL coerces "yes"/"true" to a real boolean.
    options: f.type === 'checkbox' ? ['yes', 'no'] : f.options,
    optionsObject: f.type === 'relation' ? (f.relation_to ?? undefined) : undefined,
    required: f.required,
  }));

  return {
    slug: o.slug,
    singular: o.singular,
    plural: o.plural,
    icon: o.icon || 'Table2',
    type: 'custom',
    fields: table,
    // Always editable. A custom object with no form is a table nobody can add
    // a row to, which is not a thing anyone would define on purpose.
    form,
  };
}

/** Slug → ObjectDef, for the pages that resolve an object from the URL. */
export function customObjectMap(rows: CustomObject[]): Record<string, ObjectDef> {
  const out: Record<string, ObjectDef> = {};
  for (const o of rows) if (o.enabled) out[o.slug] = toObjectDef(o);
  return out;
}
