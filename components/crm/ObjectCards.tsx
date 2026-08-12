'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, Star, ArrowRight, Loader2, Key, X, ChevronRight,
  Eye, EyeOff, RotateCcw, ChevronUp, ChevronDown, Lock,
} from 'lucide-react';
import { OBJECT_ICON_NAMES } from '@/lib/workspace/blueprint';
import { CUSTOM_OBJECT_GROUPS } from '@/lib/crm/nav';
import { iconFor } from '@/lib/crm/object-icons';
import { OBJECTS } from '@/lib/crm/registry';
import {
  saveCustomObject, saveCustomField, deleteCustomField,
  FIELD_TYPES, FIELD_TYPE_LABEL,
  type CustomObject, type CustomField, type CustomFieldType,
} from '@/lib/crm/custom';
import {
  saveObjectOverride, resetObjectOverride, saveBuiltinField,
  fieldSlug, viewSlug, type ObjectSettings, type BuiltinField,
} from '@/lib/crm/objects';
import Button from '@/components/ui/Button';
import { useDialog } from '@/components/ui/Dialog';

/**
 * The cards on Settings → Objects: one per record type, collapsed until you
 * open it.
 *
 * Their own file rather than the page’s, because a page component cannot
 * export anything but a default — which means anything living in a page file
 * can only be rendered by signing in and navigating to it. These are the two
 * densest components on the screen and the ones most worth looking at in
 * isolation.
 */

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 31);

export const chipCls = (on: boolean) =>
  `h-7 px-2.5 rounded-md text-2xs font-medium transition-colors ${
    on ? 'bg-inverse text-inverse-fg' : 'text-secondary ring-1 ring-subtle hover:bg-surface-sunken'}`;

// ── Shared pieces ───────────────────────────────────────────────────────────

export function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-primary">{title}</h2>
      <p className="text-xs text-tertiary max-w-2xl leading-relaxed">{note}</p>
      <div className="space-y-2 pt-1">{children}</div>
    </section>
  );
}

export function ObjectIcon({ name }: { name: string }) {
  const Icon = iconFor(name);
  return <Icon className="w-4 h-4 text-accent shrink-0" />;
}

/**
 * The row you click to open an object.
 *
 * The chevron rotates rather than swapping glyphs — the same control in two
 * states reads as one thing that moved, where ▸/▾ reads as two controls.
 */
function CardHeader({ icon, title, meta, expanded, onToggle, children, dim }: {
  icon: string; title: string; meta?: React.ReactNode; expanded: boolean;
  onToggle: () => void; children?: React.ReactNode; dim?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 px-3 h-12 ${expanded ? 'border-b border-subtle' : ''}`}>
      <button onClick={onToggle} aria-expanded={expanded}
        className="flex items-center gap-2 min-w-0 flex-1 h-full text-left rounded-md -mx-1 px-1 hover:bg-surface-hover">
        <ChevronRight className={`w-3.5 h-3.5 text-tertiary shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <span className={dim ? 'opacity-45' : undefined}><ObjectIcon name={icon} /></span>
        <span className={`text-sm font-medium truncate ${dim ? 'text-tertiary line-through decoration-1' : 'text-primary'}`}>{title}</span>
        {meta}
      </button>
      {children}
    </div>
  );
}

export function IconPicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  return (
    <div>
      <span className="block text-2xs text-tertiary mb-1.5">Icon</span>
      {/* Scrolls rather than reflowing the card to six rows of glyphs — the
          picker is a detail and should not be the tallest thing on screen.
          Height is exactly three rows (3×28px + 2×4px gap): a clipped half-row
          reads as a rendering fault rather than as "there is more below". */}
      <div className="flex flex-wrap gap-1 h-[5.75rem] overflow-y-auto pr-1">
        {OBJECT_ICON_NAMES.map((name) => {
          const Icon = iconFor(name);
          const on = value === name;
          return (
            <button key={name} type="button" title={name} aria-label={name} aria-pressed={on}
              onClick={() => onChange(name)}
              className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors shrink-0 ${
                on ? 'bg-inverse text-inverse-fg' : 'text-secondary hover:bg-surface-hover hover:text-primary'}`}>
              <Icon className="w-3.5 h-3.5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The add-a-field row, shared by both kinds of object. */
function FieldAdder({ onAdd, saving, relationOptions, onCancel }: {
  onAdd: (f: { key: string; label: string; type: CustomFieldType; options: string[]; relation_to: string | null }) => void;
  saving: boolean; relationOptions: { slug: string; plural: string }[]; onCancel: () => void;
}) {
  const [f, setF] = useState<{ label: string; type: CustomFieldType; options: string; relation_to: string }>(
    { label: '', type: 'text', options: '', relation_to: relationOptions[0]?.slug ?? 'companies' });

  return (
    <div className="rounded-lg ring-1 ring-subtle bg-surface-sunken p-3 space-y-2 mt-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <input autoFocus value={f.label} onChange={(e) => setF((v) => ({ ...v, label: e.target.value }))}
          placeholder="Field name — e.g. Depot code" className="input-field !h-8 !text-xs flex-1 min-w-0" />
        <select value={f.type} onChange={(e) => setF((v) => ({ ...v, type: e.target.value as CustomFieldType }))}
          className="input-field !h-8 !text-xs sm:w-40">
          {FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}
        </select>
      </div>
      {f.type === 'select' && (
        <input value={f.options} onChange={(e) => setF((v) => ({ ...v, options: e.target.value }))}
          placeholder="Choices, comma separated — active, in service, sold"
          className="input-field !h-8 !text-xs w-full" />
      )}
      {f.type === 'relation' && (
        <select value={f.relation_to} onChange={(e) => setF((v) => ({ ...v, relation_to: e.target.value }))}
          className="input-field !h-8 !text-xs w-full">
          {relationOptions.map((o) => <option key={o.slug} value={o.slug}>{o.plural}</option>)}
        </select>
      )}
      {f.label.trim() && (
        <p className="text-3xs text-tertiary inline-flex items-center gap-1">
          <Key className="w-3 h-3" /> stored as <span className="font-mono">{slugify(f.label)}</span>
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={!f.label.trim() || saving}
          onClick={() => onAdd({
            key: slugify(f.label), label: f.label.trim(), type: f.type,
            options: f.type === 'select' ? f.options.split(',').map((s) => s.trim()).filter(Boolean) : [],
            relation_to: f.type === 'relation' ? f.relation_to : null,
          })}>
          {saving && <Loader2 className="w-3 h-3 animate-spin" />} Add field
        </Button>
        <button onClick={onCancel} aria-label="Cancel"
          className="h-7 px-2 rounded-md text-xs text-tertiary hover:text-primary inline-flex items-center gap-1">
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
      </div>
    </div>
  );
}

const RELATION_TARGETS = Object.values(OBJECTS).map((o) => ({ slug: o.slug, plural: o.plural }));

// ── A built-in object ───────────────────────────────────────────────────────

/**
 * A shipped object, as this workspace wants it.
 *
 * Its own columns can be renamed, reordered and hidden but NOT deleted — real
 * code reads `invoices.amount`, and a screen that offers to remove it is
 * offering something it cannot do. Hiding is the honest version of that
 * request, and it is reversible.
 */
export function BuiltinObjectCard({ def, privy, ws, settings, expanded, onToggle, onChange, onOpen }: {
  def: { slug: string; singular: string; plural: string; icon: string; fields: { key: string; label: string }[] };
  privy: string | null; ws: string | null; settings: ObjectSettings;
  expanded: boolean; onToggle: () => void; onChange: () => void; onOpen: () => void;
}) {
  const { notify, confirm: confirmDialog } = useDialog();
  const ov = settings.overrides[viewSlug(def.slug)];
  const extras = settings.fields[fieldSlug(def.slug)] ?? [];
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(ov?.plural ?? '');
  const [singular, setSingular] = useState(ov?.singular ?? '');

  useEffect(() => { setName(ov?.plural ?? ''); setSingular(ov?.singular ?? ''); }, [ov?.plural, ov?.singular]);

  const label = ov?.plural?.trim() || def.plural;
  const icon = ov?.icon?.trim() || def.icon;
  const hidden = !!ov?.hidden;

  const save = async (data: any) => {
    if (!privy || !ws) return;
    setSaving(true);
    const { error } = await saveObjectOverride(privy, ws, def.slug, data);
    setSaving(false);
    if (error) return notify(error);
    onChange();
  };

  /**
   * The column list, in the order it will render.
   *
   * Shipped columns the override does not mention keep their place AFTER the
   * ones it does — the same rule as `applySettings`, so what this screen shows
   * is what the table will do. Writing the full list on every change is what
   * keeps the two from drifting: a partial list would mean "these three first,
   * the rest wherever", which is not what dragging a row looks like it did.
   */
  const columns = useMemo(() => {
    const byKey = new Map(def.fields.map((f) => [f.key, f]));
    const named = (ov?.columns ?? [])
      .filter((c) => c && byKey.has(c.key))
      .map((c) => { const base = byKey.get(c.key)!; byKey.delete(c.key); return { ...base, label: c.label?.trim() || base.label, hidden: !!c.hidden }; });
    return [...named, ...def.fields.filter((f) => byKey.has(f.key)).map((f) => ({ ...f, hidden: false }))];
  }, [def.fields, ov?.columns]);

  const writeColumns = (next: { key: string; label: string; hidden: boolean }[]) =>
    save({ columns: next.map((c) => ({ key: c.key, label: c.label, hidden: c.hidden })) });

  const move = (i: number, by: number) => {
    const next = [...columns];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    writeColumns(next);
  };

  const addField = async (f: { key: string; label: string; type: CustomFieldType; options: string[]; relation_to: string | null }) => {
    if (!privy || !ws) return;
    setSaving(true);
    const { error } = await saveBuiltinField(privy, ws, def.slug, f);
    setSaving(false);
    if (error) return notify(error);
    setAdding(false); onChange();
  };

  const removeField = async (f: BuiltinField) => {
    if (!privy || !ws) return;
    const ok = await confirmDialog({
      title: `Remove “${f.label}”?`,
      body: 'It disappears from the table and the form. The values already saved are kept — re-adding a field with the same name brings them back.',
    });
    if (!ok) return;
    await deleteCustomField(privy, ws, f.id);
    onChange();
  };

  const edited = !!ov;

  return (
    <section className={`card-surface overflow-hidden ${hidden ? 'opacity-70' : ''}`}>
      <CardHeader icon={icon} title={label} expanded={expanded} onToggle={onToggle} dim={hidden}
        meta={<>
          {ov?.plural && <span className="text-2xs text-tertiary truncate hidden md:inline">was {def.plural}</span>}
          {extras.length > 0 && (
            <span className="text-2xs text-accent tabular-nums shrink-0">
              +{extras.length} field{extras.length === 1 ? '' : 's'}
            </span>
          )}
        </>}>
        <button onClick={() => save({ hidden: !hidden })} disabled={saving || !privy}
          title={hidden ? 'Show in the sidebar' : 'Hide from the sidebar'}
          className="h-7 px-2 rounded-md text-tertiary hover:text-primary hover:bg-surface-hover disabled:opacity-40">
          {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
        <button onClick={onOpen} title={`Open ${label}`}
          className="h-7 px-2 rounded-md text-xs font-semibold text-secondary hover:bg-surface-hover inline-flex items-center gap-1">
          Open <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </CardHeader>

      {expanded && (
        <div className="p-4 space-y-5">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block min-w-0">
              <span className="block text-2xs text-tertiary mb-1">Call it</span>
              <input value={name} onChange={(e) => setName(e.target.value)}
                onBlur={() => (name.trim() || ov?.plural) && name.trim() !== (ov?.plural ?? '') && save({ plural: name.trim() })}
                placeholder={def.plural} className="input-field w-full" />
            </label>
            <label className="block min-w-0">
              <span className="block text-2xs text-tertiary mb-1">One of them is a…</span>
              <input value={singular} onChange={(e) => setSingular(e.target.value)}
                onBlur={() => (singular.trim() || ov?.singular) && singular.trim() !== (ov?.singular ?? '') && save({ singular: singular.trim() })}
                placeholder={def.singular} className="input-field w-full" />
            </label>
          </div>

          <div>
            <span className="block text-2xs text-tertiary mb-1.5">Sidebar section</span>
            <div className="flex flex-wrap gap-1.5">
              {CUSTOM_OBJECT_GROUPS.map((g) => (
                <button key={g} onClick={() => save({ group_key: g })} disabled={saving}
                  className={chipCls((ov?.group_key || '') === g)}>{g}</button>
              ))}
              {ov?.group_key && (
                <button onClick={() => save({ group_key: null })} className={chipCls(false)}>Where it shipped</button>
              )}
            </div>
          </div>

          <IconPicker value={icon} onChange={(i) => save({ icon: i })} />

          <div>
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="text-2xs text-tertiary">Columns</span>
              <span className="text-3xs text-tertiary">— rename, reorder, or hide. Shipped columns can’t be deleted.</span>
            </div>
            <div className="space-y-1">
              {columns.map((c, i) => (
                <div key={c.key} className="group flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-surface-hover">
                  <div className="flex flex-col shrink-0">
                    <button onClick={() => move(i, -1)} disabled={i === 0 || saving} aria-label={`Move ${c.label} up`}
                      className="h-3.5 text-tertiary hover:text-primary disabled:opacity-25"><ChevronUp className="w-3 h-3" /></button>
                    <button onClick={() => move(i, 1)} disabled={i === columns.length - 1 || saving} aria-label={`Move ${c.label} down`}
                      className="h-3.5 text-tertiary hover:text-primary disabled:opacity-25"><ChevronDown className="w-3 h-3" /></button>
                  </div>
                  <input defaultValue={c.label} key={`${c.key}:${c.label}`}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== c.label) writeColumns(columns.map((x) => (x.key === c.key ? { ...x, label: v } : x)));
                    }}
                    // Looks like text until you approach it. A column label that
                    // renders as a plain span is a rename nobody discovers, and
                    // one that renders as a form field makes five stacked rows
                    // look like a form to fill in.
                    className={`flex-1 min-w-0 h-7 px-1.5 rounded-md bg-transparent text-sm outline-none transition-colors hover:bg-surface-sunken focus:bg-surface-sunken focus:ring-1 focus:ring-accent ${
                      c.hidden ? 'text-tertiary line-through decoration-1' : 'text-primary'}`} />
                  <span className="text-2xs font-mono text-tertiary hidden sm:inline truncate max-w-[9rem]">{c.key}</span>
                  <button onClick={() => writeColumns(columns.map((x) => (x.key === c.key ? { ...x, hidden: !x.hidden } : x)))}
                    disabled={saving} title={c.hidden ? 'Show this column' : 'Hide this column'}
                    className="p-1 rounded text-tertiary hover:text-primary shrink-0">
                    {c.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <Lock className="w-3 h-3 text-tertiary/50 shrink-0" aria-label="Built in" />
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="text-2xs text-tertiary">Your fields</span>
              <span className="text-3xs text-tertiary">— stored with the record and visible to agents, exports and the API.</span>
            </div>
            <div className="space-y-1">
              {extras.length === 0 && !adding && (
                <p className="text-xs text-tertiary px-2 py-1">Nothing added yet.</p>
              )}
              {extras.map((f) => (
                <div key={f.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-hover">
                  <span className="text-sm text-primary min-w-0 flex-1 truncate">{f.label}</span>
                  <span className="text-2xs font-mono text-tertiary hidden sm:inline truncate max-w-[9rem]">{f.key}</span>
                  <span className="text-2xs text-tertiary shrink-0">{FIELD_TYPE_LABEL[f.type]}</span>
                  {f.required && <span className="text-3xs text-warning shrink-0">required</span>}
                  <button onClick={() => removeField(f)} aria-label={`Remove ${f.label}`}
                    className="p-1 rounded text-tertiary hover:text-danger opacity-0 group-hover:opacity-100 shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            {adding ? (
              <FieldAdder onAdd={addField} saving={saving} relationOptions={RELATION_TARGETS} onCancel={() => setAdding(false)} />
            ) : (
              <button onClick={() => setAdding(true)}
                className="mt-1 h-8 px-2 inline-flex items-center gap-1.5 rounded-md text-sm text-tertiary hover:text-primary hover:bg-surface-hover">
                <Plus className="w-3.5 h-3.5" /> Add field
              </button>
            )}
          </div>

          {edited && (
            <div className="pt-1 border-t border-subtle">
              <button
                onClick={async () => {
                  if (!privy || !ws) return;
                  const ok = await confirmDialog({
                    title: `Reset ${label}?`,
                    body: 'The name, icon, sidebar section and column layout go back to what ships. Fields you added are kept.',
                  });
                  if (!ok) return;
                  const { error } = await resetObjectOverride(privy, ws, def.slug);
                  if (error) return notify(error);
                  onChange();
                }}
                className="mt-3 h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-xs text-tertiary hover:text-primary hover:bg-surface-hover">
                <RotateCcw className="w-3.5 h-3.5" /> Reset to defaults
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── A custom object ─────────────────────────────────────────────────────────

export function CustomObjectCard({ object, privy, ws, expanded, onToggle, busy, onChange, onDelete, onOpen }: {
  object: CustomObject; privy: string | null; ws: string | null;
  expanded: boolean; onToggle: () => void;
  busy: boolean; onChange: () => void; onDelete: () => void; onOpen: () => void;
}) {
  const { notify, confirm: confirmDialog } = useDialog();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [singular, setSingular] = useState(object.singular);
  const [plural, setPlural] = useState(object.plural);

  useEffect(() => { setSingular(object.singular); setPlural(object.plural); }, [object.singular, object.plural]);

  const patch = async (o: Partial<CustomObject>) => {
    if (!privy || !ws) return;
    setSaving(true);
    const { error } = await saveCustomObject(privy, ws, {
      id: object.id, slug: object.slug, singular: object.singular, plural: object.plural,
      icon: object.icon, group_key: object.group_key, description: object.description, ...o,
    });
    setSaving(false);
    if (error) return notify(error);
    onChange();
  };

  const addField = async (f: { key: string; label: string; type: CustomFieldType; options: string[]; relation_to: string | null }) => {
    if (!privy || !ws) return;
    setSaving(true);
    const { error } = await saveCustomField(privy, ws, object.id, f);
    setSaving(false);
    if (error) return notify(error);
    setAdding(false); onChange();
  };

  const setPrimary = async (field: CustomField) => {
    if (!privy || !ws) return;
    await saveCustomField(privy, ws, object.id, { ...field, is_primary: true });
    onChange();
  };

  const removeField = async (field: CustomField) => {
    if (!privy || !ws) return;
    // Said plainly, because it is genuinely reversible and people expect the
    // opposite: the values stay in the row, so re-adding the field brings them
    // back. That is worth knowing before deciding.
    const ok = await confirmDialog({
      title: `Remove “${field.label}”?`,
      body: 'It disappears from the table and the form. The values already saved are kept — re-adding a field with the same key brings them back.',
    });
    if (!ok) return;
    await deleteCustomField(privy, ws, field.id);
    onChange();
  };

  // A value saved before the section was a picker (free text, any spelling) has
  // to stay selectable, or opening this screen would silently move the object.
  const current = object.group_key || 'Workspace';
  const groups = CUSTOM_OBJECT_GROUPS.includes(current) ? CUSTOM_OBJECT_GROUPS : [current, ...CUSTOM_OBJECT_GROUPS];

  return (
    <section className="card-surface overflow-hidden">
      <CardHeader icon={object.icon} title={object.plural} expanded={expanded} onToggle={onToggle}
        meta={<>
          <span className="text-2xs font-mono text-tertiary truncate hidden md:inline">/{object.slug}</span>
          <span className="text-2xs text-tertiary tabular-nums shrink-0 hidden sm:inline">
            {object.record_count} {object.record_count === 1 ? 'record' : 'records'}
          </span>
        </>}>
        <button onClick={onOpen} title={`Open ${object.plural}`}
          className="h-7 px-2 rounded-md text-xs font-semibold text-secondary hover:bg-surface-hover inline-flex items-center gap-1">
          Open <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button onClick={onDelete} disabled={busy} aria-label={`Delete ${object.plural}`}
          className="h-7 px-2 rounded-md text-tertiary hover:text-danger hover:bg-danger/10 disabled:opacity-40">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </CardHeader>

      {expanded && (
        <div className="p-4 space-y-5">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block min-w-0">
              <span className="block text-2xs text-tertiary mb-1">Call it</span>
              <input value={plural} onChange={(e) => setPlural(e.target.value)}
                onBlur={() => plural.trim() && plural.trim() !== object.plural && patch({ plural: plural.trim() })}
                className="input-field w-full" />
            </label>
            <label className="block min-w-0">
              <span className="block text-2xs text-tertiary mb-1">One of them is a…</span>
              <input value={singular} onChange={(e) => setSingular(e.target.value)}
                onBlur={() => singular.trim() && singular.trim() !== object.singular && patch({ singular: singular.trim() })}
                className="input-field w-full" />
            </label>
          </div>

          <div>
            <span className="block text-2xs text-tertiary mb-1.5">Sidebar section</span>
            <div className="flex flex-wrap gap-1.5">
              {groups.map((g) => (
                <button key={g} onClick={() => g !== current && patch({ group_key: g })} disabled={saving}
                  className={chipCls(current === g)}>{g}</button>
              ))}
            </div>
          </div>

          <IconPicker value={object.icon} onChange={(icon) => icon !== object.icon && patch({ icon })} />

          <div>
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="text-2xs text-tertiary">Fields</span>
              <span className="text-3xs text-tertiary">— the star marks what a record is called.</span>
            </div>
            <div className="space-y-1">
              {object.fields.length === 0 && !adding && (
                <p className="text-xs text-tertiary px-2 py-1">No fields yet — add one below.</p>
              )}
              {object.fields.map((field) => (
                <div key={field.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-hover">
                  <span className="text-sm text-primary min-w-0 flex-1 truncate">{field.label}</span>
                  <span className="text-2xs font-mono text-tertiary hidden sm:inline truncate max-w-[9rem]">{field.key}</span>
                  <span className="text-2xs text-tertiary shrink-0">{FIELD_TYPE_LABEL[field.type]}</span>
                  {field.required && <span className="text-3xs text-warning shrink-0">required</span>}
                  {/* The headline field is what a row is CALLED, everywhere — the
                      table's linked column, the detail title, and what an agent
                      gets back as `name`. Worth one obvious control. */}
                  <button onClick={() => setPrimary(field)} disabled={field.is_primary}
                    title={field.is_primary ? 'This is the headline field' : 'Use as the headline field'}
                    className={`p-1 rounded shrink-0 ${field.is_primary ? 'text-accent' : 'text-tertiary opacity-0 group-hover:opacity-100 hover:text-secondary'}`}>
                    <Star className={`w-3.5 h-3.5 ${field.is_primary ? 'fill-current' : ''}`} />
                  </button>
                  <button onClick={() => removeField(field)} aria-label={`Remove ${field.label}`}
                    className="p-1 rounded text-tertiary hover:text-danger opacity-0 group-hover:opacity-100 shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            {adding ? (
              <FieldAdder onAdd={addField} saving={saving} relationOptions={RELATION_TARGETS} onCancel={() => setAdding(false)} />
            ) : (
              <button onClick={() => setAdding(true)}
                className="mt-1 h-8 px-2 inline-flex items-center gap-1.5 rounded-md text-sm text-tertiary hover:text-primary hover:bg-surface-hover">
                <Plus className="w-3.5 h-3.5" /> Add field
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
