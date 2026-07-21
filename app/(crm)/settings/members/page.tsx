'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Loader2, ShieldCheck, Trash2, Clock, UserPlus, X } from 'lucide-react';
import { getWorkspace, getMembers, setMemberRole, removeMember, inviteMember, type WorkspaceContext } from '@/lib/crm/data';
import { useDialog } from '@/components/ui/Dialog';

const ROLES = ['owner', 'admin', 'member', 'recruiter', 'viewer'];
const ROLE_TONE: Record<string, string> = {
  owner: 'bg-accent/10 text-accent ring-accent/20',
  admin: 'bg-accent/10 text-accent ring-accent/30',
  member: 'bg-surface-hover text-secondary ring-subtle',
};

export default function MembersPage() {
  const { confirm: confirmDialog } = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [ws, setWs] = useState<WorkspaceContext | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviting, setInviting] = useState(false);
  const [sent, setSent] = useState('');

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

  const remove = async (m: any) => {
    if (!privy || !ws) return;
    const ok = await confirmDialog(
      m.pending
        ? { title: `Cancel the invitation to ${m.email}?`, body: 'Their invite link stops working immediately. You can invite them again later.', danger: true, confirmLabel: 'Cancel invite' }
        : { title: `Remove ${m.name}?`, body: 'They lose access to this workspace straight away, including HR and candidate data. Records they created stay.', danger: true, confirmLabel: 'Remove' },
    );
    if (!ok) return;
    setError('');
    const res = await removeMember(privy, ws.id, m.id);
    if (res.error) { setError(res.error.replace(/_/g, ' ').toLowerCase()); return; }
    setMembers(await getMembers(privy, ws.id));
  };

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-subtle">
        <h1 className="text-sm font-semibold text-primary">Members &amp; roles</h1>
        <span className="text-[11px] font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{members.length}</span>
        {ws && <span className={`text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ring-1 ${ROLE_TONE[ws.role] || ROLE_TONE.member}`}>you: {ws.role}</span>}
        {canManage && (
          <button onClick={() => { setInviting(true); setError(''); setSent(''); }}
            className="ml-auto h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-semibold text-accent-fg bg-accent hover:bg-accent/90 shadow-sm">
            <UserPlus className="w-3.5 h-3.5" /> Invite
          </button>
        )}
      </header>

      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="h-40 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : !privy ? (
          <p className="text-sm text-tertiary">Sign in to manage members.</p>
        ) : (
          <div className="max-w-2xl">
            {!canManage && <p className="mb-3 text-[12px] text-tertiary flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Only owners and admins can change roles.</p>}
            {error && <p className="mb-3 text-[12px] text-danger">{error}</p>}
            <div className="rounded-xl ring-1 ring-subtle bg-surface divide-y divide-subtle">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={`w-8 h-8 rounded-full text-accent-fg text-[11px] font-semibold flex items-center justify-center ${m.pending ? 'bg-surface-hover text-tertiary ring-1 ring-subtle ring-dashed' : 'bg-accent'}`}>
                    {m.pending ? <Clock className="w-4 h-4" /> : (m.name || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-primary truncate flex items-center gap-1.5">
                      {m.name}
                      {m.privy_user_id === privy && <span className="text-tertiary font-normal"> · you</span>}
                      {m.pending && <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-warning/10 text-warning ring-1 ring-warning/30">Invited</span>}
                    </div>
                    <div className="text-[12px] text-tertiary truncate">{m.email}</div>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {canManage && !m.pending ? (
                      <select value={m.role} onChange={(e) => changeRole(m.id, e.target.value)}
                        className="h-8 px-2 text-[12px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none capitalize">
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (
                      <span className={`text-[11px] font-semibold capitalize px-2 py-1 rounded-md ring-1 ${ROLE_TONE[m.role] || ROLE_TONE.member}`}>{m.role}</span>
                    )}
                    {canManage && m.privy_user_id !== privy && (
                      <button onClick={() => remove(m)}
                        aria-label={m.pending ? 'Cancel invitation' : 'Remove member'}
                        title={m.pending ? 'Cancel invitation' : 'Remove from workspace'}
                        className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {members.length === 0 && <div className="px-4 py-10 text-center text-tertiary text-sm">No members yet.</div>}
            </div>
            <p className="mt-3 text-[12px] text-tertiary">
              Invited people get a single-use link. They appear above as <span className="text-secondary font-medium">Invited</span> until they accept, and you can cancel the invitation any time.
            </p>
          </div>
        )}
      </div>

      {inviting && ws && (
        <InviteModal
          onClose={() => setInviting(false)}
          canGrantOwner={ws.role === 'owner'}
          onSent={async (email) => {
            setInviting(false);
            setSent(`Invitation sent to ${email}.`);
            if (privy) setMembers(await getMembers(privy, ws.id));
          }}
        />
      )}
      {sent && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-success/10 ring-1 ring-success/30 px-3 py-2 text-[12px] text-success shadow-popover">
          {sent}
        </div>
      )}
    </>
  );
}

function InviteModal({
  onClose, onSent, canGrantOwner,
}: { onClose: () => void; onSent: (email: string) => void; canGrantOwner: boolean }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!name.trim() || !email.trim()) return;
    setBusy(true);
    setErr('');
    const res = await inviteMember(name, email, role);
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    onSent(email.trim());
  };

  const input = 'w-full h-9 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-surface rounded-xl ring-1 ring-subtle shadow-popover" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 flex items-center justify-between px-4 border-b border-subtle">
          <h3 className="text-sm font-semibold text-primary">Invite a teammate</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          {err && <div className="rounded-lg bg-danger/10 ring-1 ring-danger/30 px-3 py-2 text-[12px] text-danger">{err}</div>}
          <label className="block">
            <span className="block text-[12px] font-semibold text-secondary mb-1">Full name *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" className={input} />
          </label>
          <label className="block">
            <span className="block text-[12px] font-semibold text-secondary mb-1">Email *</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="ada@company.com" className={input} />
          </label>
          <label className="block">
            <span className="block text-[12px] font-semibold text-secondary mb-1">Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value)} className={input + ' capitalize'}>
              {ROLES.filter((r) => r !== 'owner' || canGrantOwner).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <p className="text-[11px] text-tertiary leading-relaxed">
            They get an email with a single-use link. Signing in through it joins them to this workspace at the role above.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 p-3 border-t border-subtle">
          <button onClick={onClose} className="h-8 px-3 rounded-md text-[13px] font-medium text-secondary hover:bg-surface-hover">Cancel</button>
          <button onClick={submit} disabled={busy || !name.trim() || !email.trim()}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-[13px] font-semibold text-accent-fg bg-accent hover:bg-accent/90 disabled:opacity-50">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Send invitation
          </button>
        </div>
      </div>
    </div>
  );
}
