'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Power, AlertTriangle, Loader2 } from 'lucide-react';
import { Linkedin } from '@/components/ui/BrandIcons';
import { useDialog } from '@/components/ui/Dialog';
import { getWorkspace } from '@/lib/crm/data';
import {
  loadSocialAccounts, connectSocial, setSocialAccountEnabled, disconnectSocialAccount,
  PROVIDER_LABEL, type SocialAccount, type SocialProvider,
} from '@/lib/crm/social';

/**
 * Settings → Integrations → Social publishing.
 *
 * Connecting is a full-page navigation to the platform and back, so this panel
 * also reads the ?social= result the callback redirects with — otherwise
 * someone who denies consent lands back here with no idea what happened.
 */
export default function SocialAccounts({ privy }: { privy: string | null }) {
  const { confirm: confirmDialog, notify } = useDialog();
  // Resolved here rather than passed in, matching ExcelSync — the settings page
  // does not otherwise need it.
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [rows, setRows] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!privy || !workspaceId) { setLoading(false); return; }
    const { rows, error } = await loadSocialAccounts(privy, workspaceId);
    setRows(rows); setError(error || ''); setLoading(false);
  }, [privy, workspaceId]);

  useEffect(() => {
    if (!privy) { setLoading(false); return; }
    getWorkspace(privy).then((w) => setWorkspaceId(w?.id ?? null));
  }, [privy]);

  useEffect(() => { reload(); }, [reload]);

  // The OAuth callback comes back as a redirect, so its outcome arrives in the
  // URL. Read it once, tell the person, then strip it — a refresh should not
  // repeat a stale "connected".
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const result = q.get('social');
    if (!result) return;
    if (result === 'error') notify(q.get('reason') || 'The connection did not complete.');
    q.delete('social'); q.delete('reason');
    const rest = q.toString();
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
    if (result === 'connected') reload();
  }, [notify, reload]);

  const connect = async (p: SocialProvider) => {
    setBusy(p);
    const { error } = await connectSocial(p);
    setBusy(null);
    if (error) notify(error);
  };

  const toggle = async (a: SocialAccount) => {
    if (!privy || !workspaceId) return;
    setBusy(a.id);
    await setSocialAccountEnabled(privy, workspaceId, a.id, !a.enabled);
    setBusy(null); reload();
  };

  const remove = async (a: SocialAccount) => {
    if (!privy || !workspaceId) return;
    if (!await confirmDialog(
      `Disconnect ${a.display_name}? Scheduled posts to this account will be skipped. Anything already published stays published.`,
    )) return;
    setBusy(a.id);
    await disconnectSocialAccount(privy, workspaceId, a.id);
    setBusy(null); reload();
  };

  return (
    <section className="card-surface overflow-hidden">
      <div className="px-5 py-4 border-b border-subtle">
        <h3 className="text-sm font-medium text-primary">Social publishing</h3>
        <p className="text-xs text-secondary mt-1">
          Connect an account and Post studio can publish to it, on a schedule or on demand.
          Tokens are encrypted at rest and never reach the browser.
        </p>
      </div>

      <div className="p-5 space-y-3">
        {loading ? (
          <span className="text-sm text-tertiary inline-flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</span>
        ) : error ? (
          <p className="text-xs text-warning">{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-tertiary">No accounts connected yet.</p>
        ) : (
          <div className="rounded-lg ring-1 ring-subtle divide-y divide-subtle">
            {rows.map((a) => (
              <div key={a.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-3 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className="w-7 h-7 rounded-lg bg-surface-hover shrink-0 inline-flex items-center justify-center text-2xs font-semibold text-secondary">
                    {a.provider === 'linkedin' ? <Linkedin className="w-3.5 h-3.5" /> : 'X'}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm text-primary truncate">{a.display_name || PROVIDER_LABEL[a.provider]}</div>
                    <div className="text-2xs text-tertiary">
                      {PROVIDER_LABEL[a.provider]}
                      {!a.enabled && ' · paused'}
                    </div>
                  </div>
                </div>

                {/* An expired or rejected grant is the one thing worth
                    interrupting for: every scheduled post to this account will
                    fail until someone reconnects it. */}
                {(a.expired || a.last_error) && (
                  <span className="inline-flex items-center gap-1.5 text-2xs text-warning shrink-0">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {a.last_error ? 'Reconnect needed' : 'Expiring'}
                  </span>
                )}

                <div className="flex items-center gap-2 shrink-0 pl-9 sm:pl-0">
                  <button onClick={() => toggle(a)} disabled={busy === a.id}
                    title={a.enabled ? 'Pause posting to this account' : 'Resume'}
                    className="h-7 px-2 rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-hover disabled:opacity-40">
                    <Power className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => remove(a)} disabled={busy === a.id}
                    title="Disconnect"
                    className="h-7 px-2 rounded-md ring-1 ring-subtle text-secondary hover:text-danger hover:bg-danger/10 disabled:opacity-40">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {(['linkedin', 'x'] as SocialProvider[]).map((p) => (
            <button key={p} onClick={() => connect(p)} disabled={!privy || busy === p}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-secondary ring-1 ring-subtle bg-surface hover:bg-surface-sunken shadow-sm disabled:opacity-40">
              {busy === p ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Connect {PROVIDER_LABEL[p]}
            </button>
          ))}
        </div>
        <p className="text-2xs text-tertiary">
          Needs the platform&apos;s client id and secret in the server environment
          (<span className="font-mono">LINKEDIN_CLIENT_ID</span>, <span className="font-mono">X_CLIENT_ID</span> and their secrets),
          plus <span className="font-mono">NEXT_PUBLIC_SITE_URL</span> so the redirect comes back to the right host.
        </p>
      </div>
    </section>
  );
}
