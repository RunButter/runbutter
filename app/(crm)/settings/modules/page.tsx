'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Check, Loader2 } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import { NAV } from '@/lib/crm/registry';
import { iconFor } from '@/lib/crm/object-icons';
import { getWorkspace } from '@/lib/crm/data';
import {
  loadNavPrefs, saveNavPrefs, groupKey, itemKey, LOCKED_GROUPS, LOCKED_ITEMS, type NavPrefs,
} from '@/lib/crm/nav';

/**
 * Settings → Modules: turn off what this company does not use.
 *
 * Two scopes on one screen, because they answer different questions: "we do
 * not hire" is a company decision an admin makes once for everyone; "I never
 * open Forecast" is one person tidying their own sidebar. A module switched
 * off for the company is off for everyone and shows as such in "Just me".
 *
 * Nothing here deletes data or changes who can do what — it is the sidebar.
 */

type Scope = 'workspace' | 'mine';

function Toggle({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-accent' : 'bg-strong'}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-sm transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

export default function ModulesPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const [ws, setWs] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<NavPrefs | null>(null);
  const [scope, setScope] = useState<Scope>('workspace');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ready || !privy) return;
    getWorkspace(privy).then(async (w) => {
      if (!w?.id) return;
      setWs(w.id);
      const p = await loadNavPrefs(privy, w.id);
      setPrefs(p ?? { workspace: [], mine: [], can_edit_workspace: false });
      if (p && !p.can_edit_workspace) setScope('mine');
    });
  }, [ready, privy]);

  const groups = useMemo(() => NAV.filter((g) => !LOCKED_GROUPS.has(groupKey(g.group))), []);
  const companyOff = new Set(prefs?.workspace ?? []);
  const list = scope === 'workspace' ? prefs?.workspace ?? [] : prefs?.mine ?? [];
  const off = new Set(list);
  const canEdit = scope === 'mine' || !!prefs?.can_edit_workspace;

  const write = async (next: Set<string>) => {
    if (!privy || !ws || !prefs) return;
    const keys = [...next];
    setPrefs({ ...prefs, [scope]: keys });
    setSaving(true); setSaved(false); setError('');
    const r = await saveNavPrefs(privy, ws, scope, keys);
    setSaving(false);
    if (r.error) { setError(r.error); return; }
    setSaved(true);
  };
  const toggle = (key: string, visible: boolean) => {
    const next = new Set(off);
    if (visible) next.delete(key); else next.add(key);
    write(next);
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Modules" subtitle="Switch off what you don't use. Nothing is deleted.">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin text-tertiary" />
          : saved ? <span className="inline-flex items-center gap-1 text-xs text-success"><Check className="w-3.5 h-3.5" /> Saved</span> : null}
      </PageHeader>

      <div className="flex-1 overflow-auto page-pad space-y-5">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5">
            {(['workspace', 'mine'] as Scope[]).map((s) => (
              <button key={s} onClick={() => { setScope(s); setSaved(false); }}
                className={`h-8 px-3 rounded-md text-sm transition-colors ${scope === s ? 'bg-surface text-primary shadow-sm font-medium' : 'text-tertiary hover:text-secondary'}`}>
                {s === 'workspace' ? 'Whole company' : 'Just me'}
              </button>
            ))}
          </div>
          <p className="text-xs text-tertiary">
            {scope === 'workspace'
              ? prefs?.can_edit_workspace === false ? 'Only an owner or admin can change this.' : 'Hidden for everyone in the workspace.'
              : 'Only your own sidebar. Your colleagues see theirs.'}
          </p>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        {!privy && <p className="text-sm text-tertiary">Sign in to choose modules.</p>}

        <div className="grid md:grid-cols-2 gap-4">
          {groups.map((g) => {
            const gk = groupKey(g.group);
            const lockedByCompany = scope === 'mine' && companyOff.has(gk);
            const groupOn = !off.has(gk) && !lockedByCompany;
            return (
              <section key={g.group} className="card-surface overflow-hidden">
                <header className="flex items-center gap-3 px-5 h-14 border-b border-subtle">
                  <h2 className="text-sm font-medium text-primary">{g.group}</h2>
                  {lockedByCompany && <span className="text-2xs text-tertiary">Off for the company</span>}
                  <span className="ml-auto" />
                  <Toggle on={groupOn} disabled={!canEdit || !prefs || lockedByCompany}
                    onChange={(v) => toggle(gk, v)} label={`Show ${g.group}`} />
                </header>
                <ul className={`py-1.5 ${groupOn ? '' : 'opacity-45'}`}>
                  {g.items.map((it: any) => {
                    const ik = itemKey(it.slug);
                    const Icon = iconFor(it.icon);
                    const byCompany = scope === 'mine' && companyOff.has(ik);
                    const on = !off.has(ik) && !byCompany;
                    const locked = LOCKED_ITEMS.has(ik);
                    return (
                      <li key={it.slug} className="flex items-center gap-3 px-5 h-10">
                        <Icon className="w-4 h-4 text-tertiary shrink-0" />
                        <span className="text-sm text-secondary truncate">{it.label}</span>
                        {byCompany && <span className="text-2xs text-tertiary">company</span>}
                        <span className="ml-auto" />
                        {!locked && (
                          <Toggle on={on} disabled={!canEdit || !prefs || !groupOn || byCompany}
                            onChange={(v) => toggle(ik, v)} label={`Show ${it.label}`} />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
        <p className="text-xs text-tertiary">
          A hidden screen still works if you open its link, and the Copilot can still reach it. This tidies the sidebar — it does not change who can see what.
        </p>
      </div>
    </div>
  );
}
