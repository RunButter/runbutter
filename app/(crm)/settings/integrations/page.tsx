'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Plug, Plus, Loader2, X, Trash2, Webhook, KeyRound, Copy, Check, Ban } from 'lucide-react';
import {
  loadConnections, saveConnection, deleteConnection, loadApiKeys, createApiKey, revokeApiKey, loadWebhookDeliveries,
  type Connection, type ApiKey, type WebhookDelivery,
} from '@/lib/crm/automations';

const KINDS = ['generic', 'slack', 'discord', 'zapier', 'make', 'n8n'];
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export default function IntegrationsPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const canEdit = !!privy;

  const [connections, setConnections] = useState<Connection[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editConn, setEditConn] = useState<Partial<Connection> | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState('');
  const [origin, setOrigin] = useState('https://hirebtr.com');

  useEffect(() => { setOrigin(window.location.origin); }, []);

  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([loadConnections(privy), loadApiKeys(privy), loadWebhookDeliveries(privy)]).then(([c, k, d]) => {
      setConnections(c.rows); setKeys(k.rows); setDeliveries(d.rows); setLive(c.live); setLoading(false);
    });
  }, [privy]);
  useEffect(() => { if (ready) reload(); }, [ready, reload]);

  const copy = (text: string, tag: string) => { navigator.clipboard?.writeText(text); setCopied(tag); setTimeout(() => setCopied(''), 1500); };

  const saveConn = async () => {
    if (!privy || !editConn?.url) return;
    const res = await saveConnection(privy, editConn.id || null, { label: editConn.label || '', kind: editConn.kind || 'generic', url: editConn.url, is_active: editConn.is_active ?? true });
    if (res.error) { alert(res.error); return; }
    setEditConn(null); reload();
  };
  const delConn = async (c: Connection) => { if (!privy || !confirm('Delete this connection?')) return; await deleteConnection(privy, c.id); reload(); };

  const makeKey = async () => {
    if (!privy) return;
    const res = await createApiKey(privy, newKeyName || 'API key');
    if (res.error) { alert(res.error); return; }
    setFreshKey(res.key || null); setNewKeyName(''); reload();
  };
  const revoke = async (k: ApiKey) => { if (!privy || !confirm('Revoke this key? Apps using it will stop working.')) return; await revokeApiKey(privy, k.id); reload(); };

  const inputCls = 'w-full h-9 px-2.5 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none';

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200/70">
        <h1 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Plug className="w-4 h-4 text-primary-600" /> Integrations</h1>
        <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{live ? 'Live' : 'Sample'}</span>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-8">
          <p className="text-[13px] text-slate-500 -mt-1">Connect HireBTR to the tools you already use — no per-call cost. Bring your own webhook URL or API key.</p>

          {/* Connect cards */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { name: 'Zapier', body: 'Trigger Zaps from HireBTR (paste a Catch Hook URL below), or let Zapier create records via the API.', tone: 'text-orange-600 bg-orange-50' },
              { name: 'Make', body: 'Use a Custom webhook as a connection, and the HTTP module to push data back in with your API key.', tone: 'text-violet-600 bg-violet-50' },
              { name: 'n8n', body: 'Self-hosted automation. Webhook node in, HTTP Request node out — same URL + key.', tone: 'text-rose-600 bg-rose-50' },
              { name: 'Slack / Discord', body: 'Paste an Incoming Webhook URL as a connection; automations post updates to your channel.', tone: 'text-emerald-600 bg-emerald-50' },
              { name: 'REST API', body: 'Any script or backend: create + read records with a bearer API key. See endpoints below.', tone: 'text-indigo-600 bg-indigo-50' },
              { name: 'MCP (soon)', body: 'Let Claude / AI agents read + write your workspace over MCP, authed by an API key.', tone: 'text-slate-500 bg-slate-100' },
            ].map((c) => (
              <div key={c.name} className="rounded-xl bg-white ring-1 ring-slate-200/60 p-4">
                <div className={`inline-flex text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md mb-2 ${c.tone}`}>{c.name}</div>
                <p className="text-[12px] text-slate-500 leading-relaxed">{c.body}</p>
              </div>
            ))}
          </div>

          {/* Outgoing webhooks / connections */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Webhook className="w-4 h-4 text-slate-400" /> Outgoing webhooks</h2>
              <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 rounded-md px-1.5 py-0.5 tabular-nums">{connections.length}</span>
              <button onClick={() => setEditConn({ kind: 'generic', is_active: true })} disabled={!canEdit} className="ml-auto h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 shadow-sm disabled:opacity-40"><Plus className="w-3.5 h-3.5" /> Add</button>
            </div>
            <div className="rounded-xl bg-white ring-1 ring-slate-200/60 overflow-hidden">
              {loading ? <div className="h-20 flex items-center justify-center text-slate-300"><Loader2 className="w-5 h-5 animate-spin" /></div>
                : connections.length === 0 ? <div className="px-5 py-8 text-center text-[13px] text-slate-400">No connections yet. Add a Slack / Zapier / Make webhook URL.</div>
                : connections.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 px-4 h-12 border-b border-slate-100 last:border-0">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold ring-1 capitalize ${c.is_active ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/60' : 'bg-slate-100 text-slate-400 ring-slate-200/60'}`}>{c.kind}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-slate-800 truncate">{c.label || 'Webhook'}</div>
                      <div className="text-[11px] text-slate-400 font-mono truncate">{c.url}</div>
                    </div>
                    {c.secret && <button onClick={() => copy(c.secret!, 'sec' + c.id)} title="Copy signing secret" className="h-7 px-2 text-[11px] font-semibold rounded-md ring-1 ring-slate-200 text-slate-500 hover:bg-slate-50 inline-flex items-center gap-1">{copied === 'sec' + c.id ? <Check className="w-3 h-3" /> : <KeyRound className="w-3 h-3" />} Secret</button>}
                    <button onClick={() => setEditConn(c)} disabled={!canEdit} className="h-7 px-2.5 text-[12px] font-semibold rounded-md ring-1 ring-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40">Edit</button>
                    <button onClick={() => delConn(c)} disabled={!canEdit} className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Each POST is signed — verify with the connection secret via the <code className="bg-slate-100 rounded px-1">X-HireBTR-Signature</code> header (<code className="bg-slate-100 rounded px-1">t=…,v1=…</code>).</p>
          </section>

          {/* Recent webhook deliveries */}
          {deliveries.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2"><Webhook className="w-4 h-4 text-slate-400" /> Recent deliveries</h2>
              <div className="rounded-xl bg-white ring-1 ring-slate-200/60 overflow-hidden">
                {deliveries.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 px-4 h-10 border-b border-slate-100 last:border-0 text-[12px]">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${d.status === 'ok' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    <span className="font-mono text-slate-600 truncate flex-1">{d.url}</span>
                    <span className="text-slate-400 shrink-0">{d.detail}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* API keys */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2"><KeyRound className="w-4 h-4 text-slate-400" /> API keys</h2>
              <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 rounded-md px-1.5 py-0.5 tabular-nums">{keys.length}</span>
            </div>

            {freshKey && (
              <div className="rounded-xl ring-1 ring-emerald-200/70 bg-emerald-50/60 p-4 mb-3">
                <div className="text-[12px] font-bold text-emerald-800 mb-1.5">Copy your key now — it won’t be shown again.</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[12px] font-mono text-slate-800 bg-white ring-1 ring-slate-200 rounded-md px-2.5 py-1.5 truncate">{freshKey}</code>
                  <button onClick={() => copy(freshKey, 'fresh')} className="h-8 px-2.5 rounded-md text-[12px] font-semibold text-white bg-slate-900 hover:bg-slate-800 inline-flex items-center gap-1.5">{copied === 'fresh' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} Copy</button>
                  <button onClick={() => setFreshKey(null)} className="p-1.5 rounded-md text-slate-400 hover:bg-white"><X className="w-4 h-4" /></button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 mb-3">
              <input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="Key name (e.g. Zapier)" className={inputCls + ' max-w-xs'} disabled={!canEdit} />
              <button onClick={makeKey} disabled={!canEdit} className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 shadow-sm disabled:opacity-40"><Plus className="w-3.5 h-3.5" /> Create key</button>
            </div>

            <div className="rounded-xl bg-white ring-1 ring-slate-200/60 overflow-hidden">
              {keys.length === 0 ? <div className="px-5 py-8 text-center text-[13px] text-slate-400">No API keys yet.</div>
                : keys.map((k) => (
                  <div key={k.id} className={`flex items-center gap-3 px-4 h-12 border-b border-slate-100 last:border-0 ${k.revoked ? 'opacity-50' : ''}`}>
                    <KeyRound className="w-4 h-4 text-slate-300 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-slate-800 truncate">{k.name} {k.revoked && <span className="text-[11px] text-rose-500 font-medium">· revoked</span>}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{k.prefix}••••••••</div>
                    </div>
                    <span className="text-[11px] text-slate-400 tabular-nums hidden sm:block">last used {fmtDate(k.last_used_at)}</span>
                    {!k.revoked && <button onClick={() => revoke(k)} disabled={!canEdit} className="h-7 px-2.5 text-[12px] font-semibold rounded-md ring-1 ring-slate-200 text-slate-600 hover:text-rose-600 hover:bg-rose-50 inline-flex items-center gap-1.5 disabled:opacity-40"><Ban className="w-3.5 h-3.5" /> Revoke</button>}
                  </div>
                ))}
            </div>

            {/* API reference */}
            <div className="mt-3 rounded-xl bg-slate-950 text-slate-200 p-4 font-mono text-[12px] overflow-x-auto">
              <div className="text-slate-400 mb-2"># Create a record</div>
              <div className="whitespace-pre">{`curl -X POST ${origin}/api/v1/records \\
  -H "Authorization: Bearer hb_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"object":"people","data":{"first_name":"Ada","email":"ada@x.io"}}'`}</div>
              <div className="text-slate-400 mt-3 mb-2"># List records</div>
              <div className="whitespace-pre">{`curl ${origin}/api/v1/records?object=companies \\
  -H "Authorization: Bearer hb_your_key"`}</div>
            </div>
          </section>
        </div>
      </div>

      {/* Connection editor */}
      {editConn && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px] p-4" onClick={() => setEditConn(null)}>
          <div className="w-full max-w-md bg-white rounded-xl ring-1 ring-slate-200/70 shadow-2xl animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
            <div className="h-12 flex items-center justify-between px-4 border-b border-slate-200/70">
              <h3 className="text-sm font-bold text-slate-800">{editConn.id ? 'Edit connection' : 'New connection'}</h3>
              <button onClick={() => setEditConn(null)} className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="block text-[12px] font-semibold text-slate-600 mb-1">Label</span>
                  <input value={editConn.label || ''} onChange={(e) => setEditConn({ ...editConn, label: e.target.value })} placeholder="Slack #finance" className={inputCls} /></label>
                <label className="block"><span className="block text-[12px] font-semibold text-slate-600 mb-1">Type</span>
                  <select value={editConn.kind || 'generic'} onChange={(e) => setEditConn({ ...editConn, kind: e.target.value })} className={inputCls + ' capitalize'}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
              </div>
              <label className="block"><span className="block text-[12px] font-semibold text-slate-600 mb-1">Webhook URL *</span>
                <input value={editConn.url || ''} onChange={(e) => setEditConn({ ...editConn, url: e.target.value })} placeholder="https://hooks.slack.com/…" className={inputCls + ' font-mono text-[12px]'} /></label>
              <label className="flex items-center gap-2 text-[12px] font-medium text-slate-600"><input type="checkbox" checked={editConn.is_active ?? true} onChange={(e) => setEditConn({ ...editConn, is_active: e.target.checked })} className="rounded border-slate-300 accent-primary-600" /> Active</label>
            </div>
            <div className="flex items-center justify-end gap-2 p-3 border-t border-slate-200/70">
              <button onClick={() => setEditConn(null)} className="h-8 px-3 rounded-md text-[13px] font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
              <button onClick={saveConn} disabled={!editConn.url} className="h-8 px-3 rounded-md text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
