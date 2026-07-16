'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Loader2, ShieldCheck } from 'lucide-react';
import { getWorkspace, getMembers, setMemberRole, type WorkspaceContext } from '@/lib/crm/data';

const ROLES = ['owner', 'admin', 'member'];
const ROLE_TONE: Record<string, string> = {
  owner: 'bg-accent/10 text-accent ring-accent/20',
  admin: 'bg-violet-50 text-violet-700 ring-violet-200/60',
  member: 'bg-surface-hover text-secondary ring-subtle',
};

export default function MembersPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [ws, setWs] = useState<WorkspaceContext | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const canManage = ws?.role === 'owner' || ws?.role === 'admin';

  const load = useCallback(async () => {
    if (!privy) { setLoading(false); return; }
    setLoading(true);
    const w = await getWorkspace(privy);
    setWs(w);
    if (w) setMembers(await getMembers(privy, w.id));
    setLoading(false);
  }, [privy]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  const changeRole = async (accountId: string, role: string) => {
    if (!privy || !ws) return;
    setError('');
    const res = await setMemberRole(privy, ws.id, accountId, role);
    if (res.error) { setError(res.error.replace(/_/g, ' ').toLowerCase()); return; }
    setMembers(await getMembers(privy, ws.id));
  };

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-subtle">
        <h1 className="text-sm font-semibold text-primary">Members</h1>
        <span className="text-[11px] font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{members.length}</span>
        {ws && <span className={`text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ring-1 ${ROLE_TONE[ws.role] || ROLE_TONE.member}`}>you: {ws.role}</span>}
      </header>

      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="h-40 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : !privy ? (
          <p className="text-sm text-tertiary">Sign in to manage members.</p>
        ) : (
          <div className="max-w-2xl">
            {!canManage && <p className="mb-3 text-[12px] text-tertiary flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Only owners and admins can change roles.</p>}
            {error && <p className="mb-3 text-[12px] text-rose-600">{error}</p>}
            <div className="rounded-xl ring-1 ring-subtle bg-surface divide-y divide-subtle">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-fuchsia-400 text-white text-[11px] font-semibold flex items-center justify-center">
                    {(m.name || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-primary truncate">{m.name}{m.privy_user_id === privy && <span className="text-tertiary font-normal"> · you</span>}</div>
                    <div className="text-[12px] text-tertiary truncate">{m.email}</div>
                  </div>
                  <div className="ml-auto">
                    {canManage ? (
                      <select value={m.role} onChange={(e) => changeRole(m.id, e.target.value)}
                        className="h-8 px-2 text-[12px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-primary-500 outline-none capitalize">
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (
                      <span className={`text-[11px] font-semibold capitalize px-2 py-1 rounded-md ring-1 ${ROLE_TONE[m.role] || ROLE_TONE.member}`}>{m.role}</span>
                    )}
                  </div>
                </div>
              ))}
              {members.length === 0 && <div className="px-4 py-10 text-center text-tertiary text-sm">No members yet.</div>}
            </div>
            <p className="mt-3 text-[12px] text-tertiary">Invite teammates from the HR → <a href="/dashboard/team" className="text-accent hover:underline">Team</a> page; they appear here automatically.</p>
          </div>
        )}
      </div>
    </>
  );
}
