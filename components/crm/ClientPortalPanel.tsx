'use client';

import { useEffect, useState } from 'react';
import { Loader2, Copy, Check, Ban, Eye, ExternalLink } from 'lucide-react';
import { rpc } from '@/lib/rpc';
import { useDialog } from '@/components/ui/Dialog';

/**
 * The client's own link, on the client's own record — which is where somebody
 * looks for it, rather than in a settings screen three clicks away.
 *
 * ONE LIVE PORTAL PER CLIENT, enforced in SQL: re-issuing revokes the previous
 * link. That is also how you rotate one sent to the wrong address, and it means
 * "send them the link" is never a choice between three of them.
 *
 * The open count is here because "have they looked at it" is the question this
 * answers that an emailed PDF cannot.
 */
interface Portal {
  id: string; token: string; title: string; organization_id: string;
  opens: number; last_open: string | null; revoked_at: string | null;
}

export default function ClientPortalPanel({ privy, workspaceId, organizationId, name }: {
  privy: string | null; workspaceId: string | null; organizationId: string; name: string;
}) {
  const { confirm } = useDialog();
  const [portal, setPortal] = useState<Portal | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const reload = async () => {
    if (!privy || !workspaceId) return;
    const { data } = await rpc('get_client_portals', { p_privy: privy, p_workspace: workspaceId });
    const list = Array.isArray(data) ? (data as Portal[]) : [];
    setPortal(list.find((x) => x.organization_id === organizationId) ?? null);
  };
  useEffect(() => { reload(); }, [privy, workspaceId, organizationId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const url = portal ? `${window.location.origin}/c/${portal.token}` : '';

  async function issue() {
    if (!privy || !workspaceId) return;
    if (portal) {
      const ok = await confirm({
        title: 'Replace this link?',
        body: 'The current link stops working immediately. Anyone who has it will need the new one.',
      });
      if (!ok) return;
    }
    setBusy(true); setError('');
    const { data, error: err } = await rpc('create_client_portal', {
      p_privy: privy, p_workspace: workspaceId, p_organization: organizationId,
      p_title: 'Your account', p_note: '', p_show_invoices: true, p_files: [], p_days: null,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    if ((data as any)?.token) reload();
  }

  async function revoke() {
    if (!portal || !privy || !workspaceId) return;
    const ok = await confirm({
      title: `Revoke ${name}’s link?`,
      body: 'It stops working immediately for anyone who has it.',
    });
    if (!ok) return;
    await rpc('revoke_client_portal', { p_privy: privy, p_workspace: workspaceId, p_id: portal.id });
    setPortal(null);
  }

  return (
    <div className="mt-5">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-primary">Client portal</h3>
        <span className="text-2xs text-tertiary">their invoices and documents, under your brand</span>
      </div>

      {portal ? (
        <>
          <div className="mt-2 flex items-center gap-2 p-2 rounded-lg bg-surface-sunken">
            <input readOnly value={url} onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 bg-transparent text-2xs text-secondary outline-none" />
            <button onClick={() => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="h-6 px-2 inline-flex items-center gap-1 rounded text-2xs font-semibold text-accent hover:bg-accent/10 shrink-0">
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied ? 'Copied' : 'Copy'}
            </button>
            <a href={url} target="_blank" rel="noreferrer" aria-label="Open"
              className="h-6 w-6 inline-flex items-center justify-center rounded text-tertiary hover:text-primary shrink-0">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-2xs text-tertiary tabular-nums">
              <Eye className="w-3 h-3 inline -mt-0.5" /> {portal.opens} open{portal.opens === 1 ? '' : 's'}
              {portal.last_open ? ` · last ${new Date(portal.last_open).toLocaleDateString('en-GB')}` : ' · not opened yet'}
            </span>
            <button onClick={issue} disabled={busy}
              className="ml-auto h-6 px-2 rounded text-2xs font-semibold text-secondary hover:text-primary hover:bg-surface-sunken disabled:opacity-40">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Replace'}
            </button>
            <button onClick={revoke}
              className="h-6 px-2 inline-flex items-center gap-1 rounded text-2xs font-semibold text-tertiary hover:text-danger hover:bg-danger/10">
              <Ban className="w-3 h-3" /> Revoke
            </button>
          </div>
        </>
      ) : (
        <button onClick={issue} disabled={busy || !privy}
          className="mt-2 h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-2xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-40">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Create a link for {name}
        </button>
      )}
      {error && <p className="mt-1 text-2xs text-danger">{error}</p>}
    </div>
  );
}
