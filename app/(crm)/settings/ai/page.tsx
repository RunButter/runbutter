'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Sparkles, Loader2, Plus, Trash2, Check, Star, ShieldCheck } from 'lucide-react';
import { loadAiProviders, saveAiKey, setAiProviderMeta, deleteAiProvider, type AiProviderRow } from '@/lib/crm/docs';
import { PROVIDERS, providerLabel } from '@/lib/ai/providers';
import { useDialog } from '@/components/ui/Dialog';

export default function AiKeysPage() {
  const { confirm: confirmDialog } = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const canEdit = !!privy;

  const [rows, setRows] = useState<AiProviderRow[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState('claude');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    setLoading(true);
    loadAiProviders(privy).then((r) => { setRows(r.rows); setLive(r.live); setLoading(false); });
  }, [privy]);
  useEffect(() => { if (ready) reload(); }, [ready, reload]);

  const def = PROVIDERS.find((p) => p.id === provider);

  const add = async () => {
    if (!privy) { setError('Sign in to add a key.'); return; }
    if (!key.trim()) { setError('Paste your API key.'); return; }
    if (provider === 'custom' && !/^https?:\/\/.+/i.test(baseUrl.trim())) { setError('Enter the base URL of your OpenAI-compatible API, e.g. https://api.groq.com/openai/v1'); return; }
    setSaving(true); setError('');
    const res = await saveAiKey(privy, provider, model || (def?.models[0] || ''), key.trim(), provider === 'custom' ? baseUrl.trim() : undefined);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    setKey(''); setModel(''); setBaseUrl(''); reload();
  };
  const makeDefault = async (r: AiProviderRow) => { if (privy) { await setAiProviderMeta(privy, r.id, { is_default: true }); reload(); } };
  const toggle = async (r: AiProviderRow) => { if (privy) { await setAiProviderMeta(privy, r.id, { enabled: !r.enabled }); reload(); } };
  const remove = async (r: AiProviderRow) => { if (privy && await confirmDialog(`Remove your ${providerLabel(r.provider)} key?`)) { await deleteAiProvider(privy, r.id); reload(); } };

  const inputCls = 'w-full h-9 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-primary-500 outline-none';

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-subtle">
        <h1 className="text-sm font-semibold text-primary flex items-center gap-2"><Sparkles className="w-4 h-4 text-accent" /> AI keys</h1>
        <span className={`text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{live ? 'Live' : 'Sample'}</span>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="flex items-start gap-2 text-[13px] text-secondary rounded-xl bg-surface-sunken ring-1 ring-subtle p-3">
            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <p>Bring your <b>own</b> AI key — you pay your provider directly, RunButter adds no token cost. Keys are <b>encrypted at rest</b> (AES-256-GCM) and never shown again after saving.</p>
          </div>

          {/* Add */}
          <div className="rounded-xl bg-surface ring-1 ring-subtle p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-tertiary mb-3">Add a provider key</div>
            <div className="grid sm:grid-cols-2 gap-2.5">
              <label className="block"><span className="block text-[12px] font-semibold text-secondary mb-1">Provider</span>
                <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(''); }} className={inputCls}>{PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
                {def && <span className="text-[11px] text-tertiary mt-1 block">{def.help}</span>}
              </label>
              <label className="block"><span className="block text-[12px] font-semibold text-secondary mb-1">Model</span>
                <input list="ai-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder={def?.models[0] || 'model id'} className={inputCls} />
                <datalist id="ai-models">{def?.models.map((m) => <option key={m} value={m} />)}</datalist>
              </label>
              {provider === 'custom' && (
                <label className="block sm:col-span-2"><span className="block text-[12px] font-semibold text-secondary mb-1">Base URL</span>
                  <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.groq.com/openai/v1" className={inputCls + ' font-mono text-[12px]'} />
                  <span className="text-[11px] text-tertiary mt-1 block">The OpenAI-compatible root, usually ending in /v1. Works with Groq, Mistral, DeepSeek, Together, xAI, a local Ollama, or a LiteLLM proxy.</span></label>
              )}
              <label className="block sm:col-span-2"><span className="block text-[12px] font-semibold text-secondary mb-1">API key</span>
                <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-… / paste your key" className={inputCls + ' font-mono'} autoComplete="off" /></label>
            </div>
            {error && <p className="text-[12px] text-rose-600 mt-2">{error}</p>}
            <button onClick={add} disabled={!canEdit || saving} className="mt-3 h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-semibold text-white bg-accent hover:bg-accent/90 shadow-sm disabled:opacity-40">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Save key</button>
          </div>

          {/* List */}
          <div className="rounded-xl bg-surface ring-1 ring-subtle overflow-hidden">
            {loading ? <div className="h-20 flex items-center justify-center text-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>
              : rows.length === 0 ? <div className="px-5 py-8 text-center text-[13px] text-tertiary">No AI keys yet. Add one above to use the Docs assistant.</div>
              : rows.map((r) => (
                <div key={r.id} className={`flex items-center gap-3 px-4 h-14 border-b border-subtle last:border-0 ${r.enabled ? '' : 'opacity-50'}`}>
                  <Sparkles className="w-4 h-4 text-tertiary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-primary flex items-center gap-1.5">{providerLabel(r.provider)}{r.is_default && <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-600 bg-amber-50 rounded px-1 py-0.5"><Star className="w-2.5 h-2.5" /> Default</span>}</div>
                    <div className="text-[11px] text-tertiary font-mono truncate">{r.model || '—'} · key {r.key_hint}{r.base_url ? ` · ${r.base_url}` : ''}</div>
                  </div>
                  {!r.is_default && <button onClick={() => makeDefault(r)} disabled={!canEdit} className="h-7 px-2.5 text-[12px] font-semibold rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-sunken disabled:opacity-40">Make default</button>}
                  <button onClick={() => toggle(r)} disabled={!canEdit} className="h-7 px-2.5 text-[12px] font-semibold rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-sunken disabled:opacity-40">{r.enabled ? 'Disable' : 'Enable'}</button>
                  <button onClick={() => remove(r)} disabled={!canEdit} className="p-1.5 rounded-md text-tertiary hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
          </div>
        </div>
      </div>
    </>
  );
}
