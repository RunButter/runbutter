'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy, getAccessToken } from '@privy-io/react-auth';
import { Plug, Plus, Loader2, X, Trash2, Webhook, KeyRound, Copy, Check, Ban, Send, Calendar, CheckCircle, CalendarClock } from 'lucide-react';
import {
  loadConnections, saveConnection, deleteConnection, loadApiKeys, createApiKey, revokeApiKey, loadWebhookDeliveries,
  type Connection, type ApiKey, type WebhookDelivery,
} from '@/lib/crm/automations';
import ExcelConnect from '@/components/crm/ExcelConnect';
import { apisByGroup, type PublicApi } from '@/lib/crm/api-directory';
import ExcelSync from '@/components/crm/ExcelSync';
import SocialAccounts from '@/components/crm/SocialAccounts';
import { rpc } from '@/lib/rpc';
import { getWorkspace } from '@/lib/crm/data';
import { useDialog } from '@/components/ui/Dialog';
import DataBadge from '@/components/ui/DataBadge';
import AppLoading from '@/components/ui/AppLoading';

const KINDS = ['generic', 'slack', 'discord', 'zapier', 'make', 'n8n'];
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export default function IntegrationsPage() {
  const { confirm: confirmDialog, notify } = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const canEdit = !!privy;

  const [connections, setConnections] = useState<Connection[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editConn, setEditConn] = useState<Partial<Connection> | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState('');
  const [testing, setTesting] = useState('');
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [origin, setOrigin] = useState('https://runbutter.app');
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleMsg, setGoogleMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);

  // Revoke the grant at Google and drop our stored tokens.
  const disconnectGoogle = async () => {
    if (!await confirmDialog({
      title: 'Disconnect Google Calendar?',
      body: 'RunButter will stop creating Meet links and calendar invites for new interviews. Existing events stay in your calendar. You can reconnect at any time.',
      danger: true, confirmLabel: 'Disconnect',
    })) return;
    setGoogleBusy(true);
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch('/api/auth/google/disconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setGoogleMsg({ ok: false, text: j?.error || 'Could not disconnect. Try again.' }); return; }
      setGoogleConnected(false);
      setGoogleMsg({ ok: true, text: 'Google Calendar disconnected. RunButter no longer has access to your calendar.' });
    } finally {
      setGoogleBusy(false);
    }
  };

  useEffect(() => { setOrigin(window.location.origin); }, []);

  // Native Google Calendar connection status + the post-OAuth banner.
  useEffect(() => {
    if (!privy) return;
    rpc('hr_google_connected', { p_privy: privy }).then(({ data }) => setGoogleConnected(data === true));
    const p = new URLSearchParams(window.location.search).get('google');
    if (p === 'connected') { setGoogleConnected(true); setGoogleMsg({ ok: true, text: 'Google Calendar connected — scheduling an interview now creates a Meet link and emails it to the candidate.' }); }
    else if (p === 'nocompany') setGoogleMsg({ ok: false, text: 'No HR workspace is linked to your account, so the calendar can’t be connected here.' });
    else if (p === 'error') setGoogleMsg({ ok: false, text: 'Couldn’t connect Google Calendar. Check the Google API keys on the server and try again.' });
    if (p) window.history.replaceState({}, '', '/settings/integrations');
  }, [privy]);

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
    if (res.error) { notify(res.error); return; }
    setEditConn(null); reload();
  };
  /**
   * Add a directory entry as an ordinary connection.
   *
   * It goes through the SAME saveConnection every hand-typed webhook uses —
   * there is no second write path and no special kind. All this removes is the
   * step where somebody types a URL from memory and gets it slightly wrong.
   */
  const addFromDirectory = async (a: PublicApi) => {
    if (!privy) return;
    const res = await saveConnection(privy, null, { label: a.name, kind: 'generic', url: a.url, is_active: true });
    if (res.error) { notify(res.error); return; }
    setBrowsing(false);
    reload();
  };

  const delConn = async (c: Connection) => { if (!privy || !await confirmDialog('Delete this connection?')) return; await deleteConnection(privy, c.id); reload(); };

  // Fire a signed sample payload — what Zapier/Make/n8n wait for during setup.
  const testConn = async (c: Connection) => {
    if (!privy) return;
    setTesting(c.id);
    try {
      const res = await fetch('/api/integrations/test-webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ privyUserId: privy, connectionId: c.id }) });
      const data = await res.json();
      setTestResult((m) => ({ ...m, [c.id]: { ok: !!data.ok, text: data.detail || data.error || 'No response' } }));
    } catch (e: any) {
      setTestResult((m) => ({ ...m, [c.id]: { ok: false, text: e?.message || 'Request failed' } }));
    }
    setTesting('');
  };

  const makeKey = async () => {
    if (!privy) return;
    const res = await createApiKey(privy, newKeyName || 'API key');
    if (res.error) { notify(res.error); return; }
    setFreshKey(res.key || null); setNewKeyName(''); reload();
  };
  const revoke = async (k: ApiKey) => { if (!privy || !await confirmDialog('Revoke this key? Apps using it will stop working.')) return; await revokeApiKey(privy, k.id); reload(); };

  const inputCls = 'w-full h-9 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none';

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 px-5 lg:px-7">
        <h1 className="text-md font-medium text-primary">Integrations</h1>
        <DataBadge live={live} />
      </header>

      <div className="flex-1 overflow-auto p-6 2xl:p-8">
        <div className="max-w-5xl mx-auto space-y-8">
          <p className="text-sm text-secondary -mt-1">Connect RunButter to the tools you already use — no per-call cost. Bring your own webhook URL or API key.</p>

          {/* Native integrations (built-in, OAuth) */}
          <section>
            <h2 className="text-base font-medium text-primary mb-3">Native integrations</h2>
            {googleMsg && (
              <div className={`mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ring-1 ${googleMsg.ok ? 'bg-success/10 text-success ring-success/30' : 'bg-danger/10 text-danger ring-danger/30'}`}>
                {googleMsg.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <X className="w-4 h-4 shrink-0" />}
                <span>{googleMsg.text}</span>
              </div>
            )}
            <div className="card-surface p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0"><Calendar className="w-5 h-5" /></div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-medium text-primary">Google Calendar</h3>
                <p className="text-xs text-secondary leading-relaxed">Scheduling an interview creates a Google Meet link + calendar invite and emails it to the candidate. Connect the recruiter’s Google account.</p>
              </div>
              {googleConnected ? (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success"><CheckCircle className="w-4 h-4" /> Connected</span>
                  <button onClick={disconnectGoogle} disabled={googleBusy}
                    className="h-8 px-2.5 text-xs font-semibold rounded-md ring-1 ring-subtle text-secondary hover:text-danger hover:bg-danger/10 inline-flex items-center gap-1.5 disabled:opacity-40">
                    {googleBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />} Disconnect
                  </button>
                </div>
              ) : (
                <a href="/api/auth/google" className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm shrink-0 disabled:opacity-40" aria-disabled={!canEdit}>
                  <Calendar className="w-3.5 h-3.5" /> Connect
                </a>
              )}
            </div>

            <CalConnect privy={privy} canEdit={canEdit} origin={origin} />
          </section>

          {/* Connect cards */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { name: 'Zapier', body: 'Trigger Zaps from RunButter (paste a Catch Hook URL below), or let Zapier create records via the API.', tone: 'text-warning bg-warning/10' },
              { name: 'Make', body: 'Use a Custom webhook as a connection, and the HTTP module to push data back in with your API key.', tone: 'text-accent bg-accent/10' },
              { name: 'n8n', body: 'Self-hosted automation. Webhook node in, HTTP Request node out — same URL + key.', tone: 'text-danger bg-danger/10' },
              { name: 'Slack / Discord', body: 'Paste an Incoming Webhook URL as a connection; automations post updates to your channel.', tone: 'text-success bg-success/10' },
              { name: 'REST API', body: 'Any script or backend: create + read records with a bearer API key. See endpoints below.', tone: 'text-accent bg-accent/10' },
              { name: 'MCP', body: 'Claude & AI agents read + write your workspace over Model Context Protocol — endpoint + config below.', tone: 'text-warning bg-warning/10' },
            ].map((c) => (
              <div key={c.name} className="card-surface p-4">
                <div className={`inline-flex text-2xs font-medium uppercase tracking-wide px-2 py-0.5 rounded-md mb-2 ${c.tone}`}>{c.name}</div>
                <p className="text-xs text-secondary leading-relaxed">{c.body}</p>
              </div>
            ))}
          </div>

          {/* Outgoing webhooks / connections */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-base font-medium text-primary">Outgoing webhooks</h2>
              <span className="text-2xs font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{connections.length}</span>
              <button onClick={() => setBrowsing((b) => !b)} disabled={!canEdit}
                className="ml-auto h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-secondary ring-1 ring-subtle hover:bg-surface-sunken disabled:opacity-40">
                Public APIs
              </button>
              <button onClick={() => setEditConn({ kind: 'generic', is_active: true })} disabled={!canEdit} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm disabled:opacity-40"><Plus className="w-3.5 h-3.5" /> Add</button>
            </div>
            {browsing && (
              <div className="card-surface p-4 mb-3">
                <h3 className="text-sm font-medium text-primary">Public APIs that need no key</h3>
                <p className="mt-0.5 text-2xs text-tertiary">
                  A short vetted list, not a mirror of the 1,400-entry public-apis directory: no signup,
                  https only, useful to a business, and run by somebody who will still exist next year.
                  Adding one creates an ordinary connection — your agents call it by id, never by URL.
                </p>
                <div className="mt-3 flex flex-col gap-3">
                  {apisByGroup().map((g) => (
                    <div key={g.group}>
                      <p className="text-3xs font-semibold uppercase tracking-wide text-tertiary">{g.group}</p>
                      <div className="mt-1 grid sm:grid-cols-2 gap-1.5">
                        {g.items.map((a) => (
                          <div key={a.id} className="rounded-lg bg-surface-sunken ring-1 ring-subtle p-2.5 flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-primary">{a.name}</p>
                              <p className="text-3xs text-tertiary">{a.blurb}</p>
                              <p className="text-3xs text-tertiary/80 mt-0.5">{a.operator}</p>
                            </div>
                            <button onClick={() => addFromDirectory(a)} disabled={!canEdit}
                              className="h-6 px-2 shrink-0 rounded-md text-3xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-hover disabled:opacity-40">
                              Add
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="card-surface overflow-hidden">
              {loading ? <AppLoading />
                : connections.length === 0 ? <div className="px-5 py-8 text-center text-sm text-tertiary">No connections yet. Add a Slack / Zapier / Make webhook URL, or browse the public APIs above.</div>
                : connections.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 px-4 h-12 border-b border-subtle last:border-0">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-3xs font-semibold ring-1 capitalize ${c.is_active ? 'bg-success/10 text-success ring-success/30' : 'bg-surface-hover text-tertiary ring-subtle'}`}>{c.kind}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-primary truncate">{c.label || 'Webhook'}</div>
                      <div className="text-2xs text-tertiary font-mono truncate">{c.url}</div>
                    </div>
                    {testResult[c.id] && (
                      <span className={`text-2xs font-semibold shrink-0 ${testResult[c.id].ok ? 'text-success' : 'text-danger'}`}>{testResult[c.id].text}</span>
                    )}
                    <button onClick={() => testConn(c)} disabled={!canEdit || testing === c.id} title="Send a signed sample payload"
                      className="h-7 px-2 text-2xs font-semibold rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-sunken inline-flex items-center gap-1 disabled:opacity-40">
                      {testing === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Test
                    </button>
                    {c.secret && <button onClick={() => copy(c.secret!, 'sec' + c.id)} title="Copy signing secret" className="h-7 px-2 text-2xs font-semibold rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-sunken inline-flex items-center gap-1">{copied === 'sec' + c.id ? <Check className="w-3 h-3" /> : <KeyRound className="w-3 h-3" />} Secret</button>}
                    <button onClick={() => setEditConn(c)} disabled={!canEdit} className="h-7 px-2.5 text-xs font-semibold rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-sunken disabled:opacity-40">Edit</button>
                    <button onClick={() => delConn(c)} disabled={!canEdit} className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10 disabled:opacity-40"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
            </div>
            <p className="text-2xs text-tertiary mt-2">Each POST is signed — verify with the connection secret via the <code className="bg-surface-hover rounded px-1">X-RunButter-Signature</code> header (<code className="bg-surface-hover rounded px-1">t=…,v1=…</code>).</p>
          </section>

          {/* Recent webhook deliveries */}
          {deliveries.length > 0 && (
            <section>
              <h2 className="text-base font-medium text-primary mb-3">Recent deliveries</h2>
              <div className="card-surface overflow-hidden">
                {deliveries.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 px-4 h-10 border-b border-subtle last:border-0 text-xs">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${d.status === 'ok' ? 'bg-success' : 'bg-danger'}`} />
                    <span className="font-mono text-secondary truncate flex-1">{d.url}</span>
                    <span className="text-tertiary shrink-0">{d.detail}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Excel / Sheets feed — above the raw keys, because this is the
              version of "API key" most people actually want. */}
          <ExcelConnect privy={privy} />

          {/* …and the version for teams whose spreadsheet is the working
              surface, not just a report. */}
          <ExcelSync privy={privy} />

          {/* Social publishing — the OAuth callback redirects back to this
              page, so the panel that reads ?social= has to live here. */}
          <SocialAccounts privy={privy} />

          {/* API keys */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-base font-medium text-primary">API keys</h2>
              <span className="text-2xs font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{keys.length}</span>
            </div>

            {freshKey && (
              <div className="rounded-xl ring-1 ring-success/30 bg-success/10 p-4 mb-3">
                <div className="text-xs font-semibold text-success mb-1.5">Copy your key now — it won’t be shown again.</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono text-primary bg-surface ring-1 ring-subtle rounded-md px-2.5 py-1.5 truncate">{freshKey}</code>
                  <button onClick={() => copy(freshKey, 'fresh')} className="h-8 px-2.5 rounded-md text-xs font-semibold text-inverse-fg bg-inverse hover:bg-inverse inline-flex items-center gap-1.5">{copied === 'fresh' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} Copy</button>
                  <button onClick={() => setFreshKey(null)} className="p-1.5 rounded-md text-tertiary hover:bg-surface"><X className="w-4 h-4" /></button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 mb-3">
              <input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="Key name (e.g. Zapier)" className={inputCls + ' max-w-xs'} disabled={!canEdit} />
              <button onClick={makeKey} disabled={!canEdit} className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm disabled:opacity-40"><Plus className="w-3.5 h-3.5" /> Create key</button>
            </div>

            <div className="card-surface overflow-hidden">
              {keys.length === 0 ? <div className="px-5 py-8 text-center text-sm text-tertiary">No API keys yet.</div>
                : keys.map((k) => (
                  <div key={k.id} className={`flex items-center gap-3 px-4 h-12 border-b border-subtle last:border-0 ${k.revoked ? 'opacity-50' : ''}`}>
                    <KeyRound className="w-4 h-4 text-tertiary shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-primary truncate">
                        {k.name}
                        {/* A read key can be pasted into a spreadsheet URL; a full one
                            can create records. Worth telling apart at a glance. */}
                        {k.scope === 'read' && <span className="ml-1.5 text-2xs font-medium text-tertiary">· read-only</span>}
                        {k.revoked && <span className="text-2xs text-danger font-medium"> · revoked</span>}
                      </div>
                      <div className="text-2xs text-tertiary font-mono">{k.prefix}••••••••</div>
                    </div>
                    <span className="text-2xs text-tertiary tabular-nums hidden sm:block">last used {fmtDate(k.last_used_at)}</span>
                    {!k.revoked && <button onClick={() => revoke(k)} disabled={!canEdit} className="h-7 px-2.5 text-xs font-semibold rounded-md ring-1 ring-subtle text-secondary hover:text-danger hover:bg-danger/10 inline-flex items-center gap-1.5 disabled:opacity-40"><Ban className="w-3.5 h-3.5" /> Revoke</button>}
                  </div>
                ))}
            </div>

            {/* API reference */}
            <div className="mt-3 rounded-xl bg-inverse text-inverse-fg p-4 font-mono text-xs overflow-x-auto">
              <div className="text-tertiary mb-2"># Create a record</div>
              <div className="whitespace-pre">{`curl -X POST ${origin}/api/v1/records \\
  -H "Authorization: Bearer hb_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"object":"people","data":{"first_name":"Ada","email":"ada@x.io"}}'`}</div>
              <div className="text-tertiary mt-3 mb-2"># List records</div>
              <div className="whitespace-pre">{`curl ${origin}/api/v1/records?object=companies \\
  -H "Authorization: Bearer hb_your_key"`}</div>
              <div className="text-tertiary mt-3 mb-2"># MCP — let Claude / AI agents work in this workspace (.mcp.json)</div>
              <div className="whitespace-pre">{`{
  "mcpServers": {
    "runbutter": {
      "type": "http",
      "url": "${origin}/api/mcp",
      "headers": { "Authorization": "Bearer hb_your_key" }
    }
  }
}`}</div>
            </div>
          </section>
        </div>
      </div>

      {/* Connection editor */}
      {editConn && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={() => setEditConn(null)}>
          <div className="w-full max-w-md bg-surface rounded-xl ring-1 ring-subtle shadow-popover animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
            <div className="h-12 flex items-center justify-between px-4 border-b border-subtle">
              <h3 className="text-base font-medium text-primary">{editConn.id ? 'Edit connection' : 'New connection'}</h3>
              <button onClick={() => setEditConn(null)} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="block text-xs font-semibold text-secondary mb-1">Label</span>
                  <input value={editConn.label || ''} onChange={(e) => setEditConn({ ...editConn, label: e.target.value })} placeholder="Slack #finance" className={inputCls} /></label>
                <label className="block"><span className="block text-xs font-semibold text-secondary mb-1">Type</span>
                  <select value={editConn.kind || 'generic'} onChange={(e) => setEditConn({ ...editConn, kind: e.target.value })} className={inputCls + ' capitalize'}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
              </div>
              <label className="block"><span className="block text-xs font-semibold text-secondary mb-1">Webhook URL *</span>
                <input value={editConn.url || ''} onChange={(e) => setEditConn({ ...editConn, url: e.target.value })} placeholder="https://hooks.slack.com/…" className={inputCls + ' font-mono text-xs'} /></label>
              <label className="flex items-center gap-2 text-xs font-medium text-secondary"><input type="checkbox" checked={editConn.is_active ?? true} onChange={(e) => setEditConn({ ...editConn, is_active: e.target.checked })} className="rounded border-subtle accent-accent" /> Active</label>
            </div>
            <div className="flex items-center justify-end gap-2 p-3 border-t border-subtle">
              <button onClick={() => setEditConn(null)} className="h-8 px-3 rounded-md text-sm font-medium text-secondary hover:bg-surface-hover">Cancel</button>
              <button onClick={saveConn} disabled={!editConn.url} className="h-8 px-3 rounded-md text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Cal.com connector: store the booking link + a signed webhook URL. Cal.com is
// AGPL — we integrate over its webhook API, never copy its code. Bookings whose
// attendee matches a candidate also land on the Interviews page (migration 0056).
function CalConnect({ privy, canEdit, origin }: { privy: string | null; canEdit: boolean; origin: string }) {
  const [wsId, setWsId] = useState<string | null>(null);
  const [conn, setConn] = useState<{ booking_url: string | null; webhook_token: string; has_secret: boolean; enabled: boolean } | null>(null);
  const [bookingUrl, setBookingUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!privy) return;
    (async () => {
      const w = await getWorkspace(privy);
      if (!w) return;
      setWsId(w.id);
      const { data } = await rpc('get_cal_connection', { p_privy: privy, p_workspace: w.id });
      if (data) { setConn(data); setBookingUrl(data.booking_url || ''); }
    })();
  }, [privy]);

  const webhookUrl = conn ? `${origin}/api/integrations/cal/${conn.webhook_token}` : '';

  const save = async () => {
    if (!privy || !wsId) return;
    setBusy(true); setMsg('');
    const { data, error } = await rpc('save_cal_connection', {
      p_privy: privy, p_workspace: wsId, p_booking_url: bookingUrl, p_secret: secret, p_enabled: true,
    });
    setBusy(false);
    if (error) { setMsg(error.message.replace(/_/g, ' ').toLowerCase()); return; }
    setSecret('');
    setConn((c) => (c ? { ...c, booking_url: bookingUrl || null, has_secret: c.has_secret || !!secret } : c));
    setMsg('Saved.');
  };

  return (
    <div className="mt-3 card-surface p-4">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0"><CalendarClock className="w-5 h-5" /></div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-medium text-primary">Cal.com scheduling</h3>
          <p className="text-xs text-secondary leading-relaxed">Share your Cal.com booking link, and have new bookings logged automatically. If the attendee matches a candidate, it also appears on the Interviews page.</p>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="block text-xs font-semibold text-secondary mb-1">Your Cal.com booking link</span>
          <input value={bookingUrl} onChange={(e) => setBookingUrl(e.target.value)} disabled={!canEdit}
            placeholder="https://cal.com/you/intro" className="w-full h-9 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none font-mono" />
        </label>

        <div>
          <span className="block text-xs font-semibold text-secondary mb-1">Webhook URL <span className="text-tertiary">— paste into Cal.com → Settings → Webhooks</span></span>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-2xs font-mono text-secondary bg-surface-sunken ring-1 ring-subtle rounded-md px-2.5 py-2 truncate">{webhookUrl || '…'}</code>
            <button onClick={() => { navigator.clipboard?.writeText(webhookUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              disabled={!webhookUrl} className="h-8 px-2.5 rounded-md text-xs font-semibold ring-1 ring-subtle text-secondary hover:bg-surface-sunken inline-flex items-center gap-1.5">
              {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />} Copy
            </button>
          </div>
        </div>

        <label className="block">
          <span className="block text-xs font-semibold text-secondary mb-1">Webhook signing secret {conn?.has_secret && <span className="text-success">— set</span>}</span>
          <input value={secret} onChange={(e) => setSecret(e.target.value)} disabled={!canEdit} type="password"
            placeholder={conn?.has_secret ? 'Leave blank to keep current' : 'Paste the secret from Cal.com'}
            className="w-full h-9 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none font-mono" />
          <span className="block mt-1 text-2xs text-tertiary">Cal.com signs each webhook with this; we verify it before recording anything.</span>
        </label>

        {msg && <div className="text-xs text-secondary">{msg}</div>}
        {canEdit && (
          <button onClick={save} disabled={busy} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-50">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save Cal.com settings
          </button>
        )}
      </div>
    </div>
  );
}
