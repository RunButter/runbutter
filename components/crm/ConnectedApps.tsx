'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plug, ShieldOff } from 'lucide-react';
import { rpc } from '@/lib/rpc';
import { getWorkspace } from '@/lib/crm/data';
import { useDialog } from '@/components/ui/Dialog';

/**
 * Apps that hold a live OAuth token for this workspace, and a way to take it
 * away.
 *
 * ── A GRANT NOBODY CAN SEE IS A GRANT NOBODY REVOKES ────────────────────────
 * 0099 built the whole OAuth server so claude.ai's connector flow could reach
 * /api/mcp: dynamic registration, PKCE, exact redirect matching, rotating
 * refresh tokens. `oauth_list_grants` and `oauth_revoke_grant` shipped with it
 * and were called by nothing, so a workspace could authorise an app and then
 * had no way to find out it had, or to stop it.
 *
 * Registration is deliberately OPEN — claude.ai has never heard of a given
 * self-hosted deployment and never will — which makes the authorise screen the
 * security boundary. This panel is the other half of that boundary: consent you
 * cannot withdraw is not consent.
 *
 * ── REVOKING IS IMMEDIATE AND FINAL ─────────────────────────────────────────
 * The token dies server-side; the app finds out on its next call. There is no
 * "pause" because there is no honest way to implement one — a token is valid or
 * it is not, and a paused grant that still worked would be the worst possible
 * outcome of pressing this button.
 */

interface Grant {
  id: string; client_id: string; client_name: string; client_uri: string | null;
  scope: string | null; created_at: string; last_used_at: string | null; expires_at: string;
}

const when = (s: string | null) => {
  if (!s) return 'never';
  const d = new Date(s);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return d.toLocaleDateString();
};

export default function ConnectedApps({ privy }: { privy: string | null }) {
  const { confirm } = useDialog();
  // Resolves its own workspace rather than taking one as a prop: the page it
  // sits on never needed the id for anything else, and threading one through
  // just for this component is how a prop ends up passed as null forever.
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  useEffect(() => { if (privy) getWorkspace(privy).then((w) => setWorkspaceId(w?.id ?? null)); }, [privy]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!privy || !workspaceId) { setLoading(false); return; }
    const { data, error } = await rpc('oauth_list_grants', { p_privy: privy, p_workspace: workspaceId }, { quiet: true });
    if (error?.code === 'PGRST202' || /oauth_list_grants/.test(error?.message || '')) {
      setUnavailable(true); setLoading(false); return;
    }
    setGrants(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [privy, workspaceId]);

  useEffect(() => { load(); }, [load]);

  const revoke = async (g: Grant) => {
    if (!privy || !workspaceId) return;
    if (!(await confirm({
      title: `Disconnect ${g.client_name}?`,
      body: 'Its access ends immediately and it will need to be authorised again from scratch. Nothing it already read is recalled.',
      confirmLabel: 'Disconnect', danger: true,
    }))) return;
    setBusy(g.id);
    await rpc('oauth_revoke_grant', { p_privy: privy, p_workspace: workspaceId, p_id: g.id });
    setBusy(null);
    load();
  };

  if (unavailable) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-base font-medium text-primary">Connected apps</h2>
        <span className="text-2xs font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{grants.length}</span>
      </div>
      <div className="card-surface overflow-hidden">
        {loading ? (
          <div className="px-5 py-8 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-tertiary" /></div>
        ) : grants.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <Plug className="w-5 h-5 text-tertiary mx-auto" />
            <p className="mt-2 text-sm text-tertiary">Nothing is connected.</p>
            <p className="mt-1 text-2xs text-tertiary">
              Apps that sign in through the MCP connector — claude.ai, Claude Desktop, an editor —
              appear here once they are authorised, and can be disconnected from here.
            </p>
          </div>
        ) : grants.map((g) => (
          <div key={g.id} className="flex items-center gap-3 px-4 py-3 border-b border-subtle last:border-0">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-primary truncate">
                {g.client_uri ? (
                  <a href={g.client_uri} target="_blank" rel="noopener noreferrer" className="hover:text-accent">{g.client_name}</a>
                ) : g.client_name}
              </div>
              <div className="text-2xs text-tertiary">
                Authorised {when(g.created_at)} · last used {when(g.last_used_at)}
                {g.scope ? ` · ${g.scope}` : ''}
              </div>
            </div>
            <button onClick={() => revoke(g)} disabled={busy === g.id}
              className="h-7 px-2.5 shrink-0 inline-flex items-center gap-1.5 rounded-md text-2xs font-semibold text-secondary ring-1 ring-subtle hover:bg-danger/10 hover:text-danger disabled:opacity-40">
              {busy === g.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldOff className="w-3 h-3" />} Disconnect
            </button>
          </div>
        ))}
      </div>
      <p className="text-2xs text-tertiary mt-2">
        Anyone can register an app against this server — that is deliberate, because a self-hosted
        deployment cannot pre-approve every client. What stops it mattering is that a registered app
        can do nothing at all until somebody signs in and authorises it here, and this list is where
        that gets taken back.
      </p>
    </section>
  );
}
