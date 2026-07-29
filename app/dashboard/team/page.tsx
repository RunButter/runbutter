'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import { Users, UserPlus, Shield, Loader2, Mail, CheckCircle, AlertCircle, Trash2 } from 'lucide-react';
import Paywall from '@/components/Paywall';
import Link from 'next/link';
import { useDialog } from '@/components/ui/Dialog';
import { removeMember, inviteMember } from '@/lib/crm/data';

export default function TeamPage() {
  const { confirm: confirmDialog, notify } = useDialog();
    const router = useRouter();
    const { ready, authenticated, user } = usePrivy();
    const [loading, setLoading] = useState(true);
    const [team, setTeam] = useState<any[]>([]);
    const [company, setCompany] = useState<any>(null);
    const [currentUserRole, setCurrentUserRole] = useState<'owner' | 'admin' | 'recruiter' | 'viewer'>('viewer');

    const [showInviteModal, setShowInviteModal] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteName, setInviteName] = useState('');
    const [inviteRole, setInviteRole] = useState('recruiter');
    const [isInviting, setIsInviting] = useState(false);
    const [message, setMessage] = useState({ text: '', type: '' });

    const loadTeam = useCallback(async () => {
        if (!user) return;
        try {

            // Fetch current user and their company
            const { data: me } = await supabase
                .from('company_users')
                .select('role, company:companies(*)')
                .eq('privy_user_id', user.id)
                .order('created_at', { ascending: true })   // deterministic: no ORDER BY = arbitrary row
                .limit(1)
                .maybeSingle();

            if (me) {
                const comp: any = Array.isArray(me.company) ? me.company[0] : me.company;
                setCompany(comp);
                setCurrentUserRole(me.role);

                // Fetch all team members
                const { data: teamMembers } = await supabase
                    .from('company_users')
                    .select('*')
                    .eq('company_id', comp.id)
                    .order('created_at', { ascending: true });

                setTeam(teamMembers || []);
            }
        } catch (error) {
            console.error('Failed to load team:', error);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        if (ready) {
            if (!authenticated) router.push('/auth/login');
            else loadTeam();
        }
    }, [ready, authenticated, router, loadTeam]);

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage({ text: '', type: '' });
        setIsInviting(true);

        try {
            // Inviter + company come from the verified Privy session server-side;
            // passing them from here was spoofable.
            const { error: inviteErr } = await inviteMember(inviteName, inviteEmail, inviteRole);
            if (inviteErr) throw new Error(inviteErr);

            setMessage({ text: `Successfully invited ${inviteEmail}!`, type: 'success' });
            setShowInviteModal(false);
            setInviteEmail('');
            setInviteName('');
            loadTeam();
        } catch (err: any) {
            setMessage({ text: err.message, type: 'error' });
        } finally {
            setIsInviting(false);
        }
    };

    // Goes through remove_member (0049) rather than deleting company_users from
    // the browser. The RPC enforces owner/admin, blocks removing yourself or the
    // last owner, and drops the matching `accounts` row too — the direct delete
    // left that behind, so the person kept workspace access after being
    // "removed" from the team.
    const handleRemoveMember = async (memberId: string) => {
        if (!user?.id || !company?.id) return;
        if (!await confirmDialog({
            title: 'Remove this team member?',
            body: 'They lose access to this workspace straight away, including candidate and HR data. Records they created stay.',
            danger: true, confirmLabel: 'Remove',
        })) return;

        const res = await removeMember(user.id, company.id, memberId);
        if (res.error) { notify(res.error.replace(/_/g, ' ').toLowerCase()); return; }
        loadTeam();
    };

    if (!ready || loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin w-8 h-8 text-accent" /></div>;

    const isAdmin = currentUserRole === 'owner' || currentUserRole === 'admin';

    return (
        <div className="min-h-screen bg-surface-sunken pb-12">
            <header className="bg-surface border-b px-6 py-4 flex items-center justify-between sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <Users className="w-6 h-6 text-accent" />
                    <h1 className="text-xl font-semibold text-primary">Team Management</h1>
                </div>
                {isAdmin && (
                    <button 
                        className="btn-primary flex items-center gap-2 py-2 px-4 shadow-sm"
                        onClick={() => setShowInviteModal(true)}
                    >
                        <UserPlus className="w-4 h-4" /> Invite Member
                    </button>
                )}
            </header>

            <main className="max-w-5xl px-6 py-8">
                {message.text && (
                    <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 border ${message.type === 'error' ? 'bg-danger/10 text-danger border-danger/30' : 'bg-success/10 text-success border-success/30'}`}>
                        {message.type === 'error' ? <AlertCircle className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
                        {message.text}
                    </div>
                )}

                <Paywall isLocked={company?.plan === 'free'} featureName="Team Collaboration">
                    <div className="bg-surface rounded-2xl shadow-sm border border-subtle overflow-hidden">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-surface-sunken text-secondary text-xs uppercase tracking-wider">
                                    <th className="px-6 py-4 font-semibold">Team Member</th>
                                    <th className="px-6 py-4 font-semibold">Role</th>
                                    <th className="px-6 py-4 font-semibold">Status</th>
                                    <th className="px-6 py-4 font-semibold text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-subtle">
                                {team.map((member) => (
                                    <tr key={member.id} className="hover:bg-surface-sunken transition">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent font-semibold uppercase">
                                                    {member.full_name?.charAt(0) || '?'}
                                                </div>
                                                <div>
                                                    <div className="font-semibold text-primary">{member.full_name}</div>
                                                    <div className="text-sm text-secondary">{member.email}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                                                member.role === 'owner' ? 'bg-accent/10 text-accent border-accent/30' :
                                                member.role === 'admin' ? 'bg-accent/10 text-accent border-accent/20' :
                                                'bg-surface-hover text-secondary border-subtle'
                                            }`}>
                                                {member.role.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            {member.privy_user_id ? (
                                                <span className="flex items-center gap-1.5 text-sm text-success font-medium">
                                                    <CheckCircle className="w-4 h-4" /> Active
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-1.5 text-sm text-warning font-medium">
                                                    <Mail className="w-4 h-4" /> Invited
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            {isAdmin && member.role !== 'owner' && (
                                                <button 
                                                    onClick={() => handleRemoveMember(member.id)}
                                                    className="p-2 text-tertiary hover:text-danger hover:bg-danger/10 rounded-lg transition"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Paywall>
            </main>

            {/* Invite Modal */}
            {showInviteModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
                    <div className="bg-surface rounded-2xl shadow-popover w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
                        <h3 className="text-xl font-semibold text-primary mb-2 flex items-center gap-2">
                            <UserPlus className="w-5 h-5 text-accent" />
                            Invite Team Member
                        </h3>
                        <p className="text-secondary text-sm mb-6">Send an email invitation to collaborate on your recruitment pipeline.</p>
                        
                        <form onSubmit={handleInvite} className="space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-secondary mb-2">Full Name</label>
                                <input 
                                    type="text" 
                                    required
                                    className="input-field w-full rounded-xl"
                                    placeholder="Jane Doe"
                                    value={inviteName}
                                    onChange={(e) => setInviteName(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-secondary mb-2">Email Address</label>
                                <input 
                                    type="email" 
                                    required
                                    className="input-field w-full rounded-xl"
                                    placeholder="jane@company.com"
                                    value={inviteEmail}
                                    onChange={(e) => setInviteEmail(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-secondary mb-2">Role</label>
                                <select 
                                    className="input-field w-full rounded-xl bg-surface"
                                    value={inviteRole}
                                    onChange={(e) => setInviteRole(e.target.value)}
                                >
                                    <option value="recruiter">Recruiter (Can manage candidates and pipelines)</option>
                                    <option value="admin">Admin (Can manage settings and billing)</option>
                                    <option value="viewer">Viewer (Read-only access)</option>
                                </select>
                            </div>

                            <div className="flex justify-end gap-3 mt-8">
                                <button type="button" className="btn-secondary px-6" onClick={() => setShowInviteModal(false)}>Cancel</button>
                                <button 
                                    type="submit"
                                    className="btn-primary flex items-center gap-2 px-6"
                                    disabled={isInviting || !inviteEmail || !inviteName}
                                >
                                    {isInviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                                    Send Invite
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
