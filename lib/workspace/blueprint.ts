/**
 * A blueprint: a set of objects and fields, described once and applied as a
 * unit.
 *
 * This is the shape both halves of the workspace builder produce — the
 * hand-written vertical templates and the AI that reads a description of a
 * business. Having one shape is the point: the templates are also the few-shot
 * examples the model is shown, so the two cannot drift apart, and a plan is
 * reviewable in exactly the same way whichever produced it.
 *
 * IT IS DATA, NOT ACTION. A blueprint describes what to create and never
 * creates anything. Applying it goes through `save_custom_object` and
 * `save_custom_field`, which re-check owner/admin in SQL and validate every
 * field type — so a model that hallucinates a "password" field type, or a
 * prompt injection that asks for an object called `people`, produces a plan
 * that is REJECTED rather than a database change nobody asked for.
 *
 * No import of the admin client here: this file is read by a client component.
 */

/**
 * The field vocabulary lives HERE, not in lib/crm/custom.ts, because that file
 * is `use client` and pulls in the browser Supabase client — importing it from
 * a route handler breaks the build at page-data collection. This is plain data
 * with no dependencies, so both halves can read it.
 *
 * It must stay in step with `custom_fields_type_check` in 0087; SQL is the
 * enforcement, this is the vocabulary everything else is written against.
 */
export const FIELD_TYPES = [
  'text', 'long_text', 'number', 'currency', 'date', 'checkbox',
  'select', 'email', 'url', 'phone', 'relation',
] as const;
export type CustomFieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABEL: Record<CustomFieldType, string> = {
  text: 'Text', long_text: 'Long text', number: 'Number', currency: 'Money',
  date: 'Date', checkbox: 'Checkbox', select: 'Choice', email: 'Email',
  url: 'Link', phone: 'Phone', relation: 'Link to a record',
};

export interface BlueprintField {
  label: string;
  key?: string;
  type: CustomFieldType;
  options?: string[];
  relation_to?: string;
  required?: boolean;
  primary?: boolean;
}

export interface BlueprintObject {
  singular: string;
  plural: string;
  slug?: string;
  group?: string;
  icon?: string;
  description?: string;
  fields: BlueprintField[];
}

export interface Blueprint {
  /** What this is for, in one line — shown above the plan. */
  summary: string;
  objects: BlueprintObject[];
}

/** Same rule as the SQL: lowercase, digits and underscores, starting a letter. */
export const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[0-9]+/, '').slice(0, 31);

export const pluralise = (s: string) => {
  const t = s.trim();
  if (!t) return '';
  if (/[^aeiou]y$/i.test(t)) return `${t.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(t)) return `${t}es`;
  return `${t}s`;
};

/**
 * The slugs the CRUD monolith already answers to.
 *
 * Duplicated from `reserved_object_slug` in 0087 on purpose: SQL is the
 * enforcement and this is the PREVIEW. Catching it here means the plan shown to
 * a person is the plan that will apply, instead of one object silently failing
 * at the end of an otherwise successful build.
 */
const RESERVED = new Set([
  'people', 'companies', 'organizations', 'invoices', 'offers', 'expenses', 'transactions',
  'products', 'campaigns', 'projects', 'issues', 'assets', 'candidates', 'positions',
  'documents', 'docs', 'files', 'posts', 'newsletters', 'forms', 'sites', 'agents', 'skills',
]);

export const isReservedSlug = (s: string) => RESERVED.has(s.toLowerCase());

export interface NormalizeResult { blueprint: Blueprint; warnings: string[] }

/**
 * Coerce anything blueprint-shaped into something that will actually apply.
 *
 * Written to be forgiving about SHAPE and strict about CONTENT: a model that
 * omits a plural or invents a field type should produce a usable plan minus the
 * bad part, not an error page. Everything dropped is reported, because a plan
 * that quietly loses half its fields is worse than one that says so.
 */
export function normalizeBlueprint(raw: any): NormalizeResult {
  const warnings: string[] = [];
  const objects: BlueprintObject[] = [];
  const seenSlugs = new Set<string>();

  const list = Array.isArray(raw?.objects) ? raw.objects : [];
  // A hard cap. An unbounded plan is a way to make one click create fifty
  // objects, and nobody reviews fifty objects.
  for (const o of list.slice(0, 8)) {
    const singular = String(o?.singular || '').trim();
    if (!singular) { warnings.push('Skipped an object with no name.'); continue; }

    const plural = String(o?.plural || '').trim() || pluralise(singular);
    const slug = slugify(String(o?.slug || '') || plural);
    if (!slug) { warnings.push(`Skipped “${singular}” — its name has no usable letters.`); continue; }
    if (isReservedSlug(slug)) {
      warnings.push(`Skipped “${plural}” — ${slug} is a built-in object.`);
      continue;
    }
    if (seenSlugs.has(slug)) { warnings.push(`Skipped a second “${plural}”.`); continue; }
    seenSlugs.add(slug);

    const fields: BlueprintField[] = [];
    const seenKeys = new Set<string>();
    for (const f of (Array.isArray(o?.fields) ? o.fields : []).slice(0, 20)) {
      const label = String(f?.label || '').trim();
      if (!label) continue;
      const key = slugify(String(f?.key || '') || label);
      // `id` and the timestamps are the row's own columns; SQL refuses them, so
      // the preview must too or the plan would show a field that never appears.
      if (!key || seenKeys.has(key) || ['id', 'created_at', 'updated_at'].includes(key)) continue;
      seenKeys.add(key);

      const type: CustomFieldType = (FIELD_TYPES as readonly string[]).includes(f?.type)
        ? f.type
        : (warnings.push(`“${label}” asked for an unknown type — using text.`), 'text');

      fields.push({
        label, key, type,
        options: type === 'select'
          ? (Array.isArray(f?.options) ? f.options.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 24) : [])
          : undefined,
        relation_to: type === 'relation' && f?.relation_to ? String(f.relation_to) : undefined,
        required: Boolean(f?.required),
        primary: Boolean(f?.primary),
      });
    }

    // Every object needs something to be called, or its table is a column of
    // "Untitled". If nothing is marked, the first text field is it; if there
    // are no fields at all, one is added.
    if (!fields.some((f) => f.primary)) {
      const first = fields.find((f) => f.type === 'text') ?? fields[0];
      if (first) first.primary = true;
      else fields.unshift({ label: 'Name', key: 'name', type: 'text', primary: true, required: true });
    }

    objects.push({
      singular, plural, slug,
      group: String(o?.group || '').trim() || 'Workspace',
      icon: String(o?.icon || '').trim() || 'Table2',
      description: String(o?.description || '').trim(),
      fields,
    });
  }

  return {
    blueprint: { summary: String(raw?.summary || '').trim() || 'A starting point for your workspace.', objects },
    warnings,
  };
}

/** Human-readable one-liner for a field, used in the review list. */
export function describeField(f: BlueprintField): string {
  const bits = [f.type.replace('_', ' ')];
  if (f.options?.length) bits.push(f.options.join(' · '));
  if (f.relation_to) bits.push(`→ ${f.relation_to}`);
  if (f.required) bits.push('required');
  return bits.join(' · ');
}
