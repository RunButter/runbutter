'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import {
  Table2, Plus, Trash2, GripVertical, Star, ArrowRight, Loader2, Key, X,
} from 'lucide-react';
import { getWorkspace } from '@/lib/crm/data';
import { OBJECTS } from '@/lib/crm/registry';
import {
  loadCustomObjects, saveCustomObject, deleteCustomObject,
  saveCustomField, deleteCustomField,
  FIELD_TYPES, FIELD_TYPE_LABEL,
  type CustomObject, type CustomField, type CustomFieldType,
} from '@/lib/crm/custom';
import PageHeader from '@/components/dashboard/PageHeader';
import Button from '@/components/ui/Button';
import { useDialog } from '@/components/ui/Dialog';
import AppLoading from '@/components/ui/AppLoading';

/**
 * Settings → Objects. Where a workspace defines its own record types.
 *
 * This is the screen that makes the product general rather than five hardcoded
 * verticals. A transport company adds a Vehicle here; a clinic adds a Patient.
 * Everything downstream — the table, the form, import, export, agents, MCP —
 * picks it up with no further work, because a custom object is turned into the
 * same ObjectDef the built-ins already are.
 *
 * Deliberately NOT a modal. Defining an object is a considered act with a lot
 * of small decisions in it, and a dialog you can dismiss by clicking outside is
 * the wrong container for that.
 */

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 31);

/** A rough plural, so nobody has to type "Vehicles" after typing "Vehicle". */
const pluralise = (s: string) => {
  const t = s.trim();
  if (!t) return '';
  if (/[^aeiou]y$/i.test(t)) return t.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(t)) return t + 'es';
  return t + 's';
};

export default function ObjectsPage() {
  const { confirm: confirmDialog, notify } = useDialog();
  const router = useRouter();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [ws, setWs] = useState<string | null>(null);
  const [rows, setRows] = useState<CustomObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ singular: '', plural: '', slug: '', group: 'Workspace' });
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async (w: string, p: string) => {
    const { rows, error } = await loadCustomObjects(p, w);
    setRows(rows); setError(error || ''); setLoading(false);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!privy) { setLoading(false); return; }
    getWorkspace(privy).then((w) => {
      if (!w?.id) { setLoading(false); return; }
      setWs(w.id); reload(w.id, privy);
    });
  }, [ready, privy, reload]);

  const refresh = () => { if (ws && privy) reload(ws, privy); };

  const create = async () => {
    if (!ws || !privy) return;
    const singular = draft.singular.trim();
    if (!singular) return;
    setBusy('new');
    const { id, error } = await saveCustomObject(privy, ws, {
      singular,
      plural: draft.plural.trim() || pluralise(singular),
      slug: draft.slug || slugify(pluralise(singular)),
      group_key: draft.group.trim() || 'Workspace',
    });
    if (error) { setBusy(null); return notify(error); }
    // Every object needs something to be called. Creating the headline field
    // here means the object is usable the moment it exists, instead of showing
    // an empty table until someone works out that fields come next.
    if (id) await saveCustomField(privy, ws, id, { key: 'name', label: 'Name', type: 'text', is_primary: true, required: true });
    setBusy(null); setCreating(false);
    setDraft({ singular: '', plural: '', slug: '', group: 'Workspace' });
    refresh();
  };

  const removeObject = async (o: CustomObject) => {
    if (!ws || !privy) return;
    // The count is in the sentence because it is the fact that decides it. A
    // generic "are you sure" hides the only thing worth knowing.
    const ok = await confirmDialog({
      title: `Delete ${o.plural}?`,
      body: o.record_count > 0
        ? `This permanently deletes the object, its ${o.fields.length} field(s) and all ${o.record_count} record(s). It cannot be undone.`
        : 'This deletes the object and its fields. There are no records in it.',
    });
    if (!ok) return;
    setBusy(o.id);
    await deleteCustomObject(privy, ws, o.id);
    setBusy(null); refresh();
  };

  if (!ready || loading) return <AppLoading />;

  return (
    <>
      <PageHeader title="Objects" subtitle="Your own record types, alongside the built-in ones">
        <Button size="sm" variant="primary" onClick={() => setCreating((c) => !c)} disabled={!privy}>
          <Plus className="w-3.5 h-3.5" /> New object
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-auto p-5 lg:p-6 2xl:p-8">
        <div className="max-w-4xl mx-auto space-y-5">
          <p className="text-sm text-secondary max-w-2xl">
            Add the things your business actually tracks — vehicles, machines, patients, shipments.
            They get a table, a form, search, import and export, and your agents can read and write
            them straight away.
          </p>

          {error && <div className="rounded-lg bg-warning/10 text-warning px-3 py-2 text-xs">{error}</div>}

          {creating && (
            <section className="card-surface p-4 space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block min-w-0">
                  <span className="block text-2xs text-tertiary mb-1">One of them is called…</span>
                  <input autoFocus value={draft.singular}
                    onChange={(e) => setDraft((d) => ({ ...d, singular: e.target.value }))}
                    placeholder="Vehicle" className="input-field w-full" />
                </label>
                <label className="block min-w-0">
                  <span className="block text-2xs text-tertiary mb-1">Several of them are…</span>
                  <input value={draft.plural}
                    onChange={(e) => setDraft((d) => ({ ...d, plural: e.target.value }))}
                    placeholder={pluralise(draft.singular) || 'Vehicles'} className="input-field w-full" />
                </label>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block min-w-0">
                  <span className="block text-2xs text-tertiary mb-1">Nav group</span>
                  <input value={draft.group}
                    onChange={(e) => setDraft((d) => ({ ...d, group: e.target.value }))}
                    placeholder="Fleet" className="input-field w-full" />
                </label>
                <label className="block min-w-0">
                  <span className="block text-2xs text-tertiary mb-1">
                    Address <span className="text-3xs">— appears in the URL</span>
                  </span>
                  <input value={draft.slug}
                    onChange={(e) => setDraft((d) => ({ ...d, slug: slugify(e.target.value) }))}
                    placeholder={slugify(pluralise(draft.singular)) || 'vehicles'}
                    className="input-field w-full font-mono !text-xs" />
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="primary" onClick={create} disabled={!draft.singular.trim() || busy === 'new'}>
                  {busy === 'new' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Create
                </Button>
                <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              </div>
            </section>
          )}

          {rows.length === 0 && !creating && (
            <div className="rounded-xl ring-1 ring-subtle bg-surface px-6 py-12 text-center">
              <Table2 className="w-9 h-9 text-tertiary mx-auto mb-3" />
              <p className="text-sm text-secondary mb-1">No custom objects yet.</p>
              <p className="text-xs text-tertiary max-w-md mx-auto">
                The built-in ones — {Object.values(OBJECTS).slice(0, 4).map((o) => o.plural).join(', ')} and
                the rest — are always there. This is for everything else.
              </p>
            </div>
          )}

          {rows.map((o) => (
            <ObjectEditor key={o.id} object={o} privy={privy} ws={ws}
              busy={busy === o.id} onChange={refresh} onDelete={() => removeObject(o)}
              onOpen={() => router.push(`/objects/${o.slug}`)} />
          ))}
        </div>
      </div>
    </>
  );
}

// ── One object and its fields ───────────────────────────────────────────────

function ObjectEditor({ object, privy, ws, busy, onChange, onDelete, onOpen }: {
  object: CustomObject; privy: string | null; ws: string | null;
  busy: boolean; onChange: () => void; onDelete: () => void; onOpen: () => void;
}) {
  const { notify, confirm: confirmDialog } = useDialog();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<{ label: string; type: CustomFieldType; options: string; relation_to: string }>(
    { label: '', type: 'text', options: '', relation_to: 'companies' });
  const [saving, setSaving] = useState(false);

  const addField = async () => {
    if (!privy || !ws || !f.label.trim()) return;
    setSaving(true);
    const { error } = await saveCustomField(privy, ws, object.id, {
      key: slugify(f.label),
      label: f.label.trim(),
      type: f.type,
      options: f.type === 'select' ? f.options.split(',').map((s) => s.trim()).filter(Boolean) : [],
      relation_to: f.type === 'relation' ? f.relation_to : null,
    });
    setSaving(false);
    if (error) return notify(error);
    setF({ label: '', type: 'text', options: '', relation_to: 'companies' });
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

  return (
    <section className="card-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 h-12 border-b border-subtle">
        <Table2 className="w-4 h-4 text-accent shrink-0" />
        <h3 className="text-sm font-medium text-primary truncate">{object.plural}</h3>
        <span className="text-2xs font-mono text-tertiary truncate hidden sm:inline">/{object.slug}</span>
        <span className="text-2xs text-tertiary tabular-nums ml-auto shrink-0">
          {object.record_count} {object.record_count === 1 ? 'record' : 'records'}
        </span>
        <button onClick={onOpen} title={`Open ${object.plural}`}
          className="h-7 px-2 rounded-md text-xs font-semibold text-secondary hover:bg-surface-hover inline-flex items-center gap-1">
          Open <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button onClick={onDelete} disabled={busy} aria-label={`Delete ${object.plural}`}
          className="h-7 px-2 rounded-md text-tertiary hover:text-danger hover:bg-danger/10 disabled:opacity-40">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      <div className="p-4 space-y-1.5">
        {object.fields.length === 0 && (
          <p className="text-xs text-tertiary">No fields yet — add one below.</p>
        )}
        {object.fields.map((field) => (
          <div key={field.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-hover">
            <GripVertical className="w-3.5 h-3.5 text-tertiary shrink-0 opacity-0 group-hover:opacity-100" />
            <span className="text-sm text-primary min-w-0 flex-1 truncate">{field.label}</span>
            <span className="text-2xs font-mono text-tertiary hidden sm:inline truncate max-w-[10rem]">{field.key}</span>
            <span className="text-2xs text-tertiary shrink-0">{FIELD_TYPE_LABEL[field.type]}</span>
            {field.required && <span className="text-3xs text-warning shrink-0">required</span>}
            {/* The headline field is what a row is CALLED, everywhere — the
                table's linked column, the detail title, and what an agent gets
                back as `name`. Worth one obvious control. */}
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

        {adding ? (
          <div className="rounded-lg ring-1 ring-subtle bg-surface-sunken p-3 space-y-2 mt-2">
            <div className="flex flex-col sm:flex-row gap-2">
              <input autoFocus value={f.label} onChange={(e) => setF((v) => ({ ...v, label: e.target.value }))}
                placeholder="Field name — e.g. MOT due" className="input-field !h-8 !text-xs flex-1 min-w-0" />
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
                {Object.values(OBJECTS).map((o) => <option key={o.slug} value={o.slug}>{o.plural}</option>)}
              </select>
            )}
            {f.label.trim() && (
              <p className="text-3xs text-tertiary inline-flex items-center gap-1">
                <Key className="w-3 h-3" /> stored as <span className="font-mono">{slugify(f.label)}</span>
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="primary" onClick={addField} disabled={!f.label.trim() || saving}>
                {saving && <Loader2 className="w-3 h-3 animate-spin" />} Add field
              </Button>
              <button onClick={() => setAdding(false)} aria-label="Cancel"
                className="h-7 px-2 rounded-md text-xs text-tertiary hover:text-primary inline-flex items-center gap-1">
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)}
            className="mt-1 h-8 px-2 inline-flex items-center gap-1.5 rounded-md text-sm text-tertiary hover:text-primary hover:bg-surface-hover">
            <Plus className="w-3.5 h-3.5" /> Add field
          </button>
        )}
      </div>
    </section>
  );
}
