'use client';

import { useEffect, useState } from 'react';
import { rpc } from '@/lib/rpc';
import { OBJECTS } from './registry';
import { needsMigration, FIELD_TYPE_LABEL, type CustomFieldType } from './custom';
import type { ObjectDef, FieldDef, FormField } from './types';

/**
 * A workspace's edits to the BUILT-IN objects (0097).
 *
 * 0087 let a workspace define its own objects. This is the other half: the
 * eleven objects that ship can be renamed, hidden, moved between sidebar
 * sections, have their columns relabelled and reordered, and carry extra
 * fields. A recruitment agency calls Companies "Clients"; a clinic does not
 * want Campaigns at all; a haulier needs a depot code on Companies and should
 * not have to abandon Companies — and everything attached to it — to get one.
 *
 * TWO KINDS OF EDIT, KEPT APART. An override is PRESENTATION and resetting it
 * is free. A field is DATA and deleting it leaves the values behind, exactly as
 * it does for a custom object. The screen says so; so does the SQL.
 *
 * The merge lives here rather than in the registry because the registry is a
 * module constant read by server code, and this needs a signed-in workspace.
 */

export interface ObjectOverride {
  slug: string;
  singular: string | null;
  plural: string | null;
  icon: string | null;
  group_key: string | null;
  hidden: boolean;
  columns: { key: string; label?: string; hidden?: boolean }[];
  position: number | null;
}

export interface BuiltinField {
  id: string;
  object: string;
  key: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  relation_to: string | null;
  required: boolean;
  position: number;
}

export interface ObjectSettings {
  overrides: Record<string, ObjectOverride>;
  fields: Record<string, BuiltinField[]>;
}

export const EMPTY_SETTINGS: ObjectSettings = { overrides: {}, fields: {} };

/**
 * Two slug rules, because they answer different questions — mirroring
 * `builtin_object_slug` and `builtin_view_slug` in 0097.
 *
 * FIELDS follow the table: `offers` and `invoices` write the same physical
 * jsonb column, so one declaration of a key has to serve both or one of them
 * becomes silently unreadable.
 *
 * PRESENTATION follows the screen: Offers has its own nav entry and its own
 * page, so renaming it to "Quotes" must not rename Invoices. `organizations`
 * is a pure alias of `companies` and collapses under both rules.
 */
export const fieldSlug = (slug: string) =>
  slug === 'organizations' ? 'companies' : slug === 'offers' ? 'invoices' : slug;
export const viewSlug = (slug: string) => (slug === 'organizations' ? 'companies' : slug);

/** Objects a workspace may edit: the built-ins, minus the pure alias. */
export const EDITABLE_BUILTINS = Object.values(OBJECTS).filter((o) => o.slug !== 'organizations');

export async function loadObjectSettings(privy: string, ws: string): Promise<{ settings: ObjectSettings; error?: string }> {
  const { data, error } = await rpc('get_object_settings', { p_privy: privy, p_workspace: ws });
  if (error) {
    return { settings: EMPTY_SETTINGS, error: needsMigration(error.message)
      ? 'Editing the built-in objects needs migration 0097 — run it in Supabase.'
      : error.message };
  }
  const d = (data ?? {}) as any;
  const overrides: Record<string, ObjectOverride> = {};
  for (const o of Array.isArray(d.overrides) ? d.overrides : []) {
    overrides[o.slug] = { ...o, columns: Array.isArray(o.columns) ? o.columns : [] };
  }
  const fields: Record<string, BuiltinField[]> = {};
  for (const f of Array.isArray(d.fields) ? d.fields : []) {
    (fields[f.object] ||= []).push({ ...f, options: Array.isArray(f.options) ? f.options : [] });
  }
  return { settings: { overrides, fields } };
}

export const saveObjectOverride = async (privy: string, ws: string, slug: string, data: Partial<Omit<ObjectOverride, 'slug'>>) => {
  const { error } = await rpc('save_object_override', { p_privy: privy, p_workspace: ws, p_slug: slug, p_data: data });
  return { error: error ? friendly(error.message) : undefined };
};

export const resetObjectOverride = async (privy: string, ws: string, slug: string) => {
  const { error } = await rpc('reset_object_override', { p_privy: privy, p_workspace: ws, p_slug: slug });
  return { error: error ? friendly(error.message) : undefined };
};

export const saveBuiltinField = async (
  privy: string, ws: string, slug: string, f: Partial<BuiltinField> & { id?: string | null },
) => {
  const { data, error } = await rpc('save_builtin_field', {
    p_privy: privy, p_workspace: ws, p_slug: slug, p_id: f.id ?? null,
    p_key: f.key ?? '', p_label: f.label ?? '', p_type: f.type ?? 'text',
    p_options: f.options ?? [], p_relation_to: f.relation_to ?? null,
    p_required: f.required ?? false, p_position: f.position ?? null,
  });
  return { id: data as string | undefined, error: error ? friendly(error.message) : undefined };
};

function friendly(msg: string): string {
  if (/RESERVED_FIELD_KEY/.test(msg)) return 'That name is already a column on this object. Pick another.';
  if (/BAD_FIELD_KEY/.test(msg)) return 'Field keys use lowercase letters, numbers and underscores.';
  if (/UNKNOWN_OBJECT/.test(msg)) return 'That object cannot carry extra fields.';
  if (/FORBIDDEN/.test(msg)) return 'Only an owner or admin can change objects and fields.';
  if (/duplicate key|unique/i.test(msg)) return 'This object already has a field with that name.';
  if (needsMigration(msg)) return 'Editing the built-in objects needs migration 0097 — run it in Supabase.';
  return msg;
}

// ── Applying it ─────────────────────────────────────────────────────────────

/** Custom field type → how the table renders the column. Mirrors lib/crm/custom.ts. */
const TABLE_TYPE: Record<CustomFieldType, FieldDef['type']> = {
  text: 'text', long_text: 'text', number: 'number', currency: 'currency',
  date: 'date', checkbox: 'boolean', select: 'tags', email: 'text',
  url: 'text', phone: 'text', relation: 'relation',
};
const FORM_INPUT: Record<CustomFieldType, FormField['input']> = {
  text: 'text', long_text: 'textarea', number: 'number', currency: 'number',
  date: 'date', checkbox: 'select', select: 'select', email: 'text',
  url: 'text', phone: 'text', relation: 'relation',
};

export const fieldTypeLabel = (t: CustomFieldType) => FIELD_TYPE_LABEL[t];

/**
 * The shipped definition plus this workspace's edits.
 *
 * COLUMN ORDER IS THE OVERRIDE'S ORDER, and any shipped column the override
 * does not mention keeps its place AFTER the ones that do. That rule is what
 * makes this survive a release: when a column is added to Companies next year,
 * a workspace that reordered three columns gets the new one appended rather
 * than losing it — the alternative silently hides every future column from
 * anyone who ever touched this screen.
 *
 * Extra fields go LAST and are never `primary`. The headline column is a real
 * column on a real table, and pointing it at a jsonb key would break every
 * join that resolves a record to a name.
 */
export function applySettings(def: ObjectDef, settings: ObjectSettings): ObjectDef {
  const ov = settings.overrides[viewSlug(def.slug)];
  const extras = settings.fields[fieldSlug(def.slug)] ?? [];
  if (!ov && extras.length === 0) return def;

  let fields = def.fields;
  if (ov?.columns?.length) {
    const wanted = ov.columns.filter((c) => c && typeof c.key === 'string');
    const byKey = new Map(def.fields.map((f) => [f.key, f]));
    const named = wanted
      .map((c) => {
        const base = byKey.get(c.key);
        if (!base) return null;                       // a column that no longer ships
        byKey.delete(c.key);
        return c.hidden ? null : { ...base, label: c.label?.trim() || base.label };
      })
      .filter(Boolean) as FieldDef[];
    fields = [...named, ...def.fields.filter((f) => byKey.has(f.key))];
  }

  if (extras.length) {
    const sorted = [...extras].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
    fields = [
      ...fields,
      ...sorted.map((f): FieldDef => ({
        key: f.key,
        label: f.label || f.key,
        type: TABLE_TYPE[f.type],
        align: f.type === 'number' || f.type === 'currency' ? 'right' : undefined,
      })),
    ];
  }

  // A read-only object stays read-only: adding a field must not conjure a form
  // for something that never had one.
  const form = def.form && extras.length
    ? [
        ...def.form,
        ...[...extras].sort((a, b) => a.position - b.position).map((f): FormField => ({
          key: f.key,
          label: f.label || f.key,
          input: FORM_INPUT[f.type],
          options: f.type === 'checkbox' ? ['yes', 'no'] : f.options,
          optionsObject: f.type === 'relation' ? (f.relation_to ?? undefined) : undefined,
          required: f.required,
        })),
      ]
    : def.form;

  return {
    ...def,
    singular: ov?.singular?.trim() || def.singular,
    plural: ov?.plural?.trim() || def.plural,
    icon: ov?.icon?.trim() || def.icon,
    fields,
    form,
  };
}

/**
 * This workspace's settings, fetched once per mount.
 *
 * Returns `EMPTY_SETTINGS` until they arrive and on any failure, so every
 * caller renders the shipped definitions rather than nothing — a workspace that
 * has not run 0097 sees exactly what it saw before, which is the whole point of
 * degrading instead of erroring.
 */
export function useObjectSettings(privy: string | null, ws: string | null): ObjectSettings {
  const [settings, setSettings] = useState<ObjectSettings>(EMPTY_SETTINGS);
  useEffect(() => {
    if (!privy || !ws) return;
    let cancelled = false;
    loadObjectSettings(privy, ws).then(
      (r) => { if (!cancelled) setSettings(r.settings); },
      () => {},
    );
    return () => { cancelled = true; };
  }, [privy, ws]);
  return settings;
}
