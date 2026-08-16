'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Plus, Trash2, Send, Loader2, KeyRound, Check, RefreshCw, Globe } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import AppLoading from '@/components/ui/AppLoading';
import { useDialog } from '@/components/ui/Dialog';
import { rpc } from '@/lib/rpc';
import { getWorkspace } from '@/lib/crm/data';
import {
  loadConnections, saveConnection, deleteConnection, saveAutomation, type Connection,
} from '@/lib/crm/automations';
import ConnectorPicker from '@/components/crm/ConnectorPicker';
import ConnectedApps from '@/components/crm/ConnectedApps';
import { NOTIFY_RECIPES, recipeAutomation } from '@/lib/crm/connectors';
import { apisByGroup, type PublicApi } from '@/lib/crm/api-directory';

/**
 * Connectors, on their own screen.
 *
 * ── WHY IT MOVED OUT OF INTEGRATIONS ────────────────────────────────────────
 * That page already owned API keys, the MCP config, Google Calendar, the Excel
 * feed, the two-way sync, webhook deliveries and the raw-key list. Connecting
 * Slack was the eighth section on a page somebody opens to do one thing, and
 * "scroll until you find it" is the version of hidden that nobody reports as a
 * bug. This is the one job, with nothing else on the page.
 *
 * Everything here writes through the SAME functions the old section used —
 * saveConnection, saveAutomation, /api/integrations/test-webhook. Moving a
 * screen must not fork a write path.
 */

export default function ConnectorsPage() {
  const { ready, authenticated, user } = usePrivy();
  const { confirm } = useDialog();
  const privy = authenticated && user ? user.id : null;

  const [conns, setConns] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [copied, setCopied] = useState('');
  const [err, setErr] = useState('');

  const reload = useCallback(async () => {
    if (!privy) { setLoading(false); return; }
    const res = await loadConnections(privy);
    setConns(Array.isArray(res) ? res : (res as any).rows ?? []);
    setLoading(false);
  }, [privy]);

  useEffect(() => { if (ready) reload(); }, [ready, reload]);

  const add = async (label: string, url: string): Promise<string | null> => {
    if (!privy) return null;
    const res = await saveConnection(privy, null, { label, kind: 'generic', url, is_active: true });
    if (res.error) { setErr(res.error); return null; }
    reload();
    return res.id ?? null;
  };

  const addRecipes = async (connectionId: string, appName: string, ids: string[]) => {
    if (!privy || !ids.length) return;
    const failed: string[] = [];
    for (const id of ids) {
      const r = NOTIFY_RECIPES.find((x) => x.id === id);
      if (!r) continue;
      const res = await saveAutomation(privy, null, recipeAutomation(r, connectionId, appName) as any);
      if (res.error) failed.push(r.label);
    }
    // Reported, never swallowed: switching on four alerts and silently getting
    // three is the kind of failure somebody discovers weeks later.
    if (failed.length) setErr(`Could not switch on: ${failed.join(', ')}`);
    reload();
  };

  const test = async (connectionId: string) => {
    if (!privy) return { ok: false, text: 'Not signed in' };
    try {
      const res = await fetch('/api/integrations/test-webhook', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privyUserId: privy, connectionId }),
      });
      const j = await res.json().catch(() => ({}));
      return { ok: !!j.ok, text: j.ok ? 'It arrived' : (j.error || j.detail || 'No response') };
    } catch { return { ok: false, text: 'Could not send' }; }
  };

  const testRow = async (c: Connection) => {
    setTesting(c.id);
    const r = await test(c.id);
    setResult((prev) => ({ ...prev, [c.id]: r }));
    setTesting(null);
  };

  const remove = async (c: Connection) => {
    if (!privy) return;
    if (!(await confirm({
      title: `Remove ${c.label || 'this connection'}?`,
      body: 'Any automation pointing at it stops delivering. The automations themselves stay.',
      confirmLabel: 'Remove', danger: true,
    }))) return;
    await deleteConnection(privy, c.id);
    reload();
  };

  const rotate = async (c: Connection) => {
    if (!privy) return;
    if (!(await confirm({
      title: 'Get a new signing secret?',
      body: 'Anything already verifying the old secret will start rejecting deliveries until you give it the new one. Right after a leak; wrong otherwise.',
      confirmLabel: 'Rotate', danger: true,
    }))) return;
    const w = await getWorkspace(privy);
    if (!w) return;
    const { error } = await rpc('rotate_connection_secret', { p_privy: privy, p_workspace: w.id, p_id: c.id });
    if (error) { setErr(error.message); return; }
    reload();
  };

  const copy = (text: string, tag: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(tag); setTimeout(() => setCopied(''), 1500);
  };

  const addApi = async (a: PublicApi) => {
    if (!privy) return;
    const res = await saveConnection(privy, null, { label: a.name, kind: 'generic', url: a.url, is_active: true });
    if (res.error) { setErr(res.error); return; }
    setBrowsing(false); reload();
  };

  if (!ready) return <AppLoading />;

  return (
    <>
      <PageHeader title="Connectors">
        <button onClick={() => { setBrowsing((b) => !b); setPicking(false); }}
          className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-secondary ring-1 ring-subtle hover:bg-surface-sunken">
          <Globe className="w-3.5 h-3.5" /> Public APIs
        </button>
        <button onClick={() => { setPicking((p) => !p); setBrowsing(false); }}
          className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm">
          <Plus className="w-3.5 h-3.5" /> Connect an app
        </button>
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="page-body p-6 2xl:p-8 flex flex-col gap-5">

          {err && <p className="text-2xs text-danger">{err}</p>}

          {picking && (
            <ConnectorPicker canEdit onSave={add} onRecipes={addRecipes}
              onTest={test} onClose={() => setPicking(false)} />
          )}

          {browsing && (
            <div className="card-surface p-4">
              <h3 className="text-sm font-medium text-primary">Public APIs that need no key</h3>
              <p className="mt-0.5 text-2xs text-tertiary">
                A short vetted list — no signup, https only, useful to a business, run by somebody who
                will still exist next year. Your agents call these by id, never by URL.
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
                          <button onClick={() => addApi(a)}
                            className="h-6 px-2 shrink-0 rounded-md text-3xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-hover">
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

          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-base font-medium text-primary">Your connections</h2>
              <span className="text-2xs font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{conns.length}</span>
            </div>
            <div className="card-surface overflow-hidden">
              {loading ? <AppLoading />
                : conns.length === 0 ? (
                  <div className="px-5 py-10 text-center">
                    <p className="text-sm text-tertiary">Nothing connected yet.</p>
                    <p className="mt-1 text-2xs text-tertiary">
                      <b>Connect an app</b> walks you through Zapier, Make, n8n, Slack and the rest —
                      and switches on the alerts in the same step.
                    </p>
                  </div>
                ) : conns.map((c) => (
                  <div key={c.id} className="px-4 py-3 border-b border-subtle last:border-0">
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${c.is_active ? 'bg-success' : 'bg-tertiary'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-primary truncate">{c.label || 'Webhook'}</div>
                        <div className="text-2xs text-tertiary font-mono truncate">{c.url}</div>
                      </div>
                      {result[c.id] && (
                        <span className={`text-2xs font-semibold shrink-0 ${result[c.id].ok ? 'text-success' : 'text-danger'}`}>
                          {result[c.id].text}
                        </span>
                      )}
                      <button onClick={() => testRow(c)} disabled={testing === c.id}
                        className="h-7 px-2 shrink-0 inline-flex items-center gap-1 rounded-md text-2xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-sunken disabled:opacity-40">
                        {testing === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Test
                      </button>
                      <button onClick={() => remove(c)} aria-label="Remove"
                        className="p-1.5 shrink-0 rounded-md text-tertiary hover:text-danger hover:bg-danger/10">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {/* The signing secret, on the row rather than behind a
                        conditional button nobody could find. Every connection
                        has one since 0123 — before that they silently did not,
                        and the button that would have revealed it was hidden by
                        the same absence. */}
                    {c.secret && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-3xs text-tertiary">Signing secret</span>
                        <code className="text-3xs text-secondary bg-surface-sunken rounded px-1.5 py-0.5 font-mono truncate max-w-[16rem]">
                          {c.secret.slice(0, 12)}…
                        </code>
                        <button onClick={() => copy(c.secret!, c.id)}
                          className="h-6 px-2 rounded-md text-3xs text-secondary ring-1 ring-subtle hover:bg-surface-hover inline-flex items-center gap-1">
                          {copied === c.id ? <Check className="w-3 h-3 text-success" /> : <KeyRound className="w-3 h-3" />} Copy
                        </button>
                        <button onClick={() => rotate(c)}
                          className="h-6 px-2 rounded-md text-3xs text-tertiary ring-1 ring-subtle hover:bg-surface-hover inline-flex items-center gap-1">
                          <RefreshCw className="w-3 h-3" /> Rotate
                        </button>
                      </div>
                    )}
                  </div>
                ))}
            </div>
            <p className="text-2xs text-tertiary mt-2">
              Every POST carries <code className="bg-surface-hover rounded px-1">X-RunButter-Signature</code>{' '}
              (<code className="bg-surface-hover rounded px-1">t=…,v1=…</code>), an HMAC of the body with the
              secret above. Check it on your side and a leaked URL alone is not enough to send you anything.
            </p>
          </section>

          <ConnectedApps privy={privy} />
        </div>
      </div>
    </>
  );
}
