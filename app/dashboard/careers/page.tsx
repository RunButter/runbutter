'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { Globe2, Loader2, Eye, EyeOff, ExternalLink, Palette, Briefcase } from 'lucide-react';
import { listPositions } from '@/lib/hr/positions';
import { getWorkspace } from '@/lib/crm/data';
import { rpc } from '@/lib/rpc';
import { supabase } from '@/lib/supabase';
import { revalidateCareersPage } from '@/lib/hr/company';
import CareersPageCard from '@/components/crm/CareersPageCard';
import HrCompanyNotice from '@/components/crm/HrCompanyNotice';
import EmptyState from '@/components/ui/EmptyState';

interface Role { id: string; title: string; department: string | null; is_active: boolean; is_published: boolean }

/**
 * Careers page management — an HR surface, not a settings screen.
 *
 * The address and copy live here next to the roles they publish; the LOOK comes
 * from Settings → Branding, so there is still exactly one place to define the
 * brand and this page just links to it.
 */
export default function CareersAdminPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [wsId, setWsId] = useState<string | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!privy) { setLoading(false); return; }
    const w = await getWorkspace(privy);
    setWsId(w?.id ?? null);
    if (w) {
      // workspace_id == company_id (0005), so the legacy ATS table keys off the
      // same uuid the platform side uses.
      // hr_list_positions (0094), not a direct read: 0077 revoked the grant on
      // `positions`, which is what surfaced here as
      // "permission denied for table positions". The RPC scopes rows to the
      // caller's company in SQL, so the company_id filter is no longer the
      // thing keeping tenants apart.
      try {
        setRoles(await listPositions(privy) as unknown as Role[]);
      } catch (err: any) {
        const msg = err?.message || 'Could not load your roles.';
        setError(/is_published/.test(msg) ? 'Run migration 0060 to manage the careers page.' : msg);
      }
    }
    setLoading(false);
  }, [privy]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  const togglePublished = async (r: Role) => {
    if (!privy) return;
    setBusyId(r.id); setError('');
    const { error: e } = await rpc('set_position_published', {
      p_privy: privy, p_position: r.id, p_published: !r.is_published,
    });
    setBusyId(null);
    if (e) { setError(e.message); return; }
    setRoles((prev) => prev.map((x) => (x.id === r.id ? { ...x, is_published: !x.is_published } : x)));
    // Purge the cached public page so the change is visible on the live link
    // straight away, not after the revalidate window expires.
    if (wsId) await revalidateCareersPage(wsId);
  };

  const activeRoles = roles.filter((r) => r.is_active);
  const publicCount = activeRoles.filter((r) => r.is_published).length;

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 px-5 lg:px-7">
        <h1 className="text-md font-medium text-primary">Careers page</h1>
        <span className="text-2xs font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">
          {publicCount} public
        </span>
        <Link href="/settings/branding"
          className="ml-auto h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-secondary ring-1 ring-subtle hover:bg-surface-sunken">
          <Palette className="w-3.5 h-3.5" /> Branding
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto p-4 2xl:p-6">
        <div className="max-w-5xl mx-auto space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-tertiary">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <HrCompanyNotice privyUserId={privy} />
              <CareersPageCard privyUserId={privy} workspaceId={wsId} />

              <div className="card-surface p-5">
                <div className="flex items-center gap-2 mb-1">
                  <Briefcase className="w-4 h-4 text-accent" />
                  <h2 className="text-base font-medium text-primary">Which roles are public</h2>
                </div>
                <p className="text-xs text-tertiary mb-3.5">
                  Hiding a role removes it from the careers page but keeps it open internally — its
                  apply link still works for anyone who already has it.
                </p>

                {error && <p className="mb-3 text-xs text-danger">{error}</p>}

                {activeRoles.length === 0 ? (
                  <EmptyState icon={Briefcase} title="No open positions"
                    description="Roles you open in Positions appear here, ready to publish."
                    action={<Link href="/dashboard/positions/new"
                      className="h-8 px-3 inline-flex items-center rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">
                      New position
                    </Link>} />
                ) : (
                  <ul className="divide-y divide-subtle">
                    {activeRoles.map((r) => (
                      <li key={r.id} className="flex items-center gap-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-primary truncate">{r.title}</p>
                          {r.department && <p className="text-2xs text-tertiary truncate">{r.department}</p>}
                        </div>
                        <a href={`/apply/${r.id}`} target="_blank" rel="noopener noreferrer"
                          className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover" title="Open apply page">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        <button onClick={() => togglePublished(r)} disabled={busyId === r.id}
                          className={`h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-xs font-semibold ring-1 disabled:opacity-50 ${
                            r.is_published
                              ? 'text-success ring-success/30 bg-success/10 hover:bg-success/20'
                              : 'text-secondary ring-subtle hover:bg-surface-sunken'
                          }`}>
                          {busyId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : r.is_published ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          {r.is_published ? 'Public' : 'Hidden'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
