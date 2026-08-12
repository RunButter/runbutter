'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Table2, Plus, Loader2 } from 'lucide-react';
import { getWorkspace } from '@/lib/crm/data';
import { CUSTOM_OBJECT_GROUPS } from '@/lib/crm/nav';
import {
  loadCustomObjects, saveCustomObject, deleteCustomObject, saveCustomField,
  type CustomObject,
} from '@/lib/crm/custom';
import {
  loadObjectSettings, EDITABLE_BUILTINS, EMPTY_SETTINGS, type ObjectSettings,
} from '@/lib/crm/objects';
import PageHeader from '@/components/dashboard/PageHeader';
import Button from '@/components/ui/Button';
import { useDialog } from '@/components/ui/Dialog';
import AppLoading from '@/components/ui/AppLoading';
import WorkspaceBuilder from '@/components/crm/WorkspaceBuilder';
import { Section, IconPicker, BuiltinObjectCard, CustomObjectCard } from '@/components/crm/ObjectCards';

/**
 * Settings → Objects. Where a workspace shapes its own data model.
 *
 * Two lists, one screen. The built-in objects can be renamed, hidden, re-filed
 * and extended (0097); the workspace's own can be anything at all (0087). They
 * look the same because they behave the same everywhere downstream, and the
 * only real difference — a built-in's shipped columns cannot be deleted,
 * because real code reads them — is shown rather than explained.
 *
 * EVERYTHING IS COLLAPSED BY DEFAULT. Twenty objects fully expanded is a page
 * you scroll past rather than read; the row is the index, and opening one is
 * how you say which one you meant.
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
  const [settings, setSettings] = useState<ObjectSettings>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ singular: '', plural: '', slug: '', group: 'Workspace', icon: 'Table2' });
  const [busy, setBusy] = useState<string | null>(null);
  // Exactly one card open at a time. Two half-read editors side by side is how
  // you edit the wrong object.
  const [open, setOpen] = useState<string | null>(null);

  const reload = useCallback(async (w: string, p: string) => {
    const [custom, setts] = await Promise.all([loadCustomObjects(p, w), loadObjectSettings(p, w)]);
    setRows(custom.rows);
    setSettings(setts.settings);
    // The custom-objects error wins: without 0087 nothing on this screen works,
    // whereas without 0097 the custom half still does.
    setError(custom.error || setts.error || '');
    setLoading(false);
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
      icon: draft.icon,
    });
    if (error) { setBusy(null); return notify(error); }
    // Every object needs something to be called. Creating the headline field
    // here means the object is usable the moment it exists, instead of showing
    // an empty table until someone works out that fields come next.
    if (id) await saveCustomField(privy, ws, id, { key: 'name', label: 'Name', type: 'text', is_primary: true, required: true });
    setBusy(null); setCreating(false);
    setDraft({ singular: '', plural: '', slug: '', group: 'Workspace', icon: 'Table2' });
    refresh();
    if (id) setOpen(`custom:${id}`);
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

  const hiddenCount = useMemo(
    () => Object.values(settings.overrides).filter((o) => o.hidden).length, [settings]);

  if (!ready || loading) return <AppLoading />;

  return (
    <>
      <PageHeader title="Objects" subtitle="Every record type in this workspace — the ones that ship, and your own">
        <Button size="sm" variant="primary" onClick={() => setCreating((c) => !c)} disabled={!privy}>
          <Plus className="w-3.5 h-3.5" /> New object
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-auto p-5 lg:p-6 2xl:p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {error && <div className="rounded-lg bg-warning/10 text-warning px-3 py-2 text-xs">{error}</div>}

          <WorkspaceBuilder privy={privy} ws={ws} onApplied={refresh} />

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
                  <span className="block text-2xs text-tertiary mb-1">
                    Sidebar section <span className="text-3xs">— where it appears in the nav</span>
                  </span>
                  <select value={draft.group}
                    onChange={(e) => setDraft((d) => ({ ...d, group: e.target.value }))}
                    className="input-field w-full">
                    {CUSTOM_OBJECT_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
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
              <IconPicker value={draft.icon} onChange={(icon) => setDraft((d) => ({ ...d, icon }))} />
              <div className="flex items-center gap-2">
                <Button variant="primary" onClick={create} disabled={!draft.singular.trim() || busy === 'new'}>
                  {busy === 'new' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Create
                </Button>
                <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              </div>
            </section>
          )}

          <Section
            title="Your objects"
            note="Anything your business tracks. They get a table, a form, search, import, export and agent access straight away."
          >
            {rows.length === 0 ? (
              <div className="rounded-xl ring-1 ring-subtle bg-surface px-6 py-10 text-center">
                <Table2 className="w-8 h-8 text-tertiary mx-auto mb-2.5" />
                <p className="text-sm text-secondary mb-1">Nothing of your own yet.</p>
                <p className="text-xs text-tertiary max-w-md mx-auto">
                  Describe your business above, or add one by hand.
                </p>
              </div>
            ) : rows.map((o) => (
              <CustomObjectCard key={o.id} object={o} privy={privy} ws={ws}
                expanded={open === `custom:${o.id}`}
                onToggle={() => setOpen((k) => (k === `custom:${o.id}` ? null : `custom:${o.id}`))}
                busy={busy === o.id} onChange={refresh} onDelete={() => removeObject(o)}
                onOpen={() => router.push(`/objects/${o.slug}`)} />
            ))}
          </Section>

          <Section
            title="Built-in objects"
            note={`Rename them, hide the ones you do not use, move them between sidebar sections and add your own fields.${
              hiddenCount ? ` ${hiddenCount} hidden.` : ''}`}
          >
            {EDITABLE_BUILTINS.map((def) => (
              <BuiltinObjectCard key={def.slug} def={def} privy={privy} ws={ws} settings={settings}
                expanded={open === `builtin:${def.slug}`}
                onToggle={() => setOpen((k) => (k === `builtin:${def.slug}` ? null : `builtin:${def.slug}`))}
                onChange={refresh} onOpen={() => router.push(`/objects/${def.slug}`)} />
            ))}
          </Section>
        </div>
      </div>
    </>
  );
}
