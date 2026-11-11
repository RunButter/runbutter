'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Sparkles, Loader2, Plus, Trash2, Check, Star, ShieldCheck } from 'lucide-react';
import { loadAiProviders, saveAiKey, setAiProviderMeta, deleteAiProvider, type AiProviderRow } from '@/lib/crm/docs';
import { PROVIDERS, providerLabel } from '@/lib/ai/providers';
import { useDialog } from '@/components/ui/Dialog';
import DataBadge from '@/components/ui/DataBadge';
import AppLoading from '@/components/ui/AppLoading';
import AIUsagePanel from '@/components/crm/AIUsagePanel';
import { getWorkspace } from '@/lib/crm/data';

export default function AiKeysPage() {
  const { confirm: confirmDialog } = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  // The key is the WORKSPACE's — every agent, Copilot turn and writing-assistant
  // call reads it — so only an owner or admin may change it (0129). Before that
  // any member could point everyone's AI at a server of their choosing.
  const [role, setRole] = useState<string | null>(null);
  const canEdit = !!privy && (role === 'owner' || role === 'admin');

  const [rows, setRows] = useState<AiProviderRow[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState('claude');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ws, setWs] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    loadAiProviders(privy).then((r) => { setRows(r.rows); setLive(r.live); setLoading(false); });
  }, [privy]);
  useEffect(() => { if (ready) reload(); }, [ready, reload]);
  // Separate from `reload`: the key list and the spend answer different
  // questions, and a usage panel that reloads every time somebody toggles a key
  // is a round trip for nothing.
  useEffect(() => { if (privy) getWorkspace(privy).then((w) => { setWs(w?.id ?? null); setRole(w?.role ?? null); }); }, [privy]);

  const def = PROVIDERS.find((p) => p.id === provider);

  const add = async () => {
    if (!privy) { setError('Sign in to add a key.'); return; }
    if (!key.trim()) { setError('Paste your API key.'); return; }
    if (provider === 'custom' && !/^https?:\/\/.+/i.test(baseUrl.trim())) { setError('Enter the base URL of your OpenAI-compatible API, e.g. https://api.groq.com/openai/v1'); return; }
    setSaving(true); setError('');
    // Blank stays BLANK. It used to store `models[0]`, which pinned every
    // workspace that skipped this field to whatever happened to be first in a
    // hardcoded list — and that list was ordered best-first, so the answer was
    // the most expensive model the provider sells. An empty model now means
    // "let RunButter pick", which is what it looked like it meant, and lets
    // each feature ask for the tier it actually needs.
    const res = await saveAiKey(privy, provider, model.trim(), key.trim(), provider === 'custom' ? baseUrl.trim() : undefined);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    setKey(''); setModel(''); setBaseUrl(''); reload();
  };
  const after = (res: { error?: string }) => { setError(res.error ? res.error.replace(/^FORBIDDEN:\s*/, '') : ''); reload(); };
  const makeDefault = async (r: AiProviderRow) => { if (privy) after(await setAiProviderMeta(privy, r.id, { is_default: true })); };
  const toggle = async (r: AiProviderRow) => { if (privy) after(await setAiProviderMeta(privy, r.id, { enabled: !r.enabled })); };
  const remove = async (r: AiProviderRow) => {
    if (privy && await confirmDialog({ title: `Remove the ${providerLabel(r.provider)} key?`, body: 'Everyone in this workspace stops using it straight away.', danger: true, confirmLabel: 'Remove' })) after(await deleteAiProvider(privy, r.id));
  };

  const inputCls = 'w-full h-9 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none';

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 page-x">
        <h1 className="text-md font-medium text-primary">AI</h1>
        <DataBadge live={live} />
      </header>

      <div className="flex-1 overflow-auto page-pad">
        <div className="max-w-2xl space-y-6">
          <div className="flex items-start gap-2 text-sm text-secondary rounded-xl bg-surface-sunken ring-1 ring-subtle p-3">
            <ShieldCheck className="w-4 h-4 text-success shrink-0 mt-0.5" />
            <p>One key for the whole workspace — the Copilot, agents and the writing assistant all use it. You pay your provider directly; keys are encrypted and never shown again.</p>
          </div>

          <AIUsagePanel privy={privy} ws={ws} />

          {privy && role && !canEdit && (
            <p className="text-sm text-secondary">Only an owner or admin can add or change the workspace&rsquo;s AI key.</p>
          )}

          {/* Add */}
          <div className="card-surface p-4">
            <div className="text-2xs font-medium uppercase tracking-wider text-tertiary mb-3">Add a provider key</div>
            <div className="grid sm:grid-cols-2 gap-2.5">
              <label className="block"><span className="block text-xs font-semibold text-secondary mb-1">Provider</span>
                <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(''); }} className={inputCls}>{PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
                {def && <span className="text-2xs text-tertiary mt-1 block">{def.help}</span>}
              </label>
              <label className="block"><span className="block text-xs font-semibold text-secondary mb-1">Model <span className="font-normal text-tertiary">— optional</span></span>
                <input list="ai-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Let RunButter choose" className={inputCls} />
                <datalist id="ai-models">{def?.models.map((m) => <option key={m} value={m} />)}</datalist>
                {def && (
                  <span className="text-2xs text-tertiary mt-1 block">
                    Left blank, quick jobs use <span className="font-mono">{def.fast}</span> and
                    {' '}bigger ones use <span className="font-mono">{def.balanced}</span>. Naming a model here uses it for everything.
                  </span>
                )}
              </label>
              {provider === 'custom' && (
                <label className="block sm:col-span-2"><span className="block text-xs font-semibold text-secondary mb-1">Base URL</span>
                  <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.groq.com/openai/v1" className={inputCls + ' font-mono text-xs'} />
                  <span className="text-2xs text-tertiary mt-1 block">The OpenAI-compatible root, usually ending in /v1. Works with Groq, Mistral, DeepSeek, Together, xAI, a local Ollama, or a LiteLLM proxy.</span></label>
              )}
              <label className="block sm:col-span-2"><span className="block text-xs font-semibold text-secondary mb-1">API key</span>
                <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-… / paste your key" className={inputCls + ' font-mono'} autoComplete="off" /></label>
            </div>
            {error && <p className="text-xs text-danger mt-2">{error}</p>}
            <button onClick={add} disabled={!canEdit || saving} className="mt-3 h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm disabled:opacity-40">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Save key</button>
          </div>

          {/* List */}
          <div className="card-surface overflow-hidden">
            {loading ? <AppLoading />
              : rows.length === 0 ? <div className="px-5 py-8 text-center text-sm text-tertiary">No AI keys yet. Add one above to use the Docs assistant.</div>
              : rows.map((r) => (
                <div key={r.id} className={`flex items-center gap-3 px-4 h-14 border-b border-subtle last:border-0 ${r.enabled ? '' : 'opacity-50'}`}>
                  <Sparkles className="w-4 h-4 text-tertiary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-primary flex items-center gap-1.5">{providerLabel(r.provider)}{r.is_default && <span className="inline-flex items-center gap-0.5 text-3xs font-semibold text-warning bg-warning/10 rounded px-1 py-0.5"><Star className="w-2.5 h-2.5" /> Default</span>}</div>
                    <div className="text-2xs text-tertiary truncate">
                      <span className="font-mono">{r.model || 'automatic model'}</span>
                      <span className="font-mono"> · key {r.key_hint}{r.base_url ? ` · ${r.base_url}` : ''}</span>
                    </div>
                  </div>
                  {!r.is_default && <button onClick={() => makeDefault(r)} disabled={!canEdit} className="h-7 px-2.5 text-xs font-semibold rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-sunken disabled:opacity-40">Make default</button>}
                  <button onClick={() => toggle(r)} disabled={!canEdit} className="h-7 px-2.5 text-xs font-semibold rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-sunken disabled:opacity-40">{r.enabled ? 'Disable' : 'Enable'}</button>
                  <button onClick={() => remove(r)} disabled={!canEdit} className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10 disabled:opacity-40"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
          </div>
        </div>
      </div>
    </>
  );
}
