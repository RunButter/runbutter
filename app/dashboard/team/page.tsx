'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import { Users, UserPlus, Shield, Loader2, Mail, CheckCircle, AlertCircle, Trash2 } from 'lucide-react';
import Paywall from '@/components/Paywall';
import Link from 'next/link';
import { useDialog } from '@/components/ui/Dialog';

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
            await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: user.id, is_local: false });

            // Fetch current user and their company
            const { data: me } = await supabase
                .from('company_users')
                .select('role, company:companies(*)')
                .eq('privy_user_id', user.id)
                .single();

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
            const res = await fetch('/api/team/invite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: inviteEmail.toLowerCase().trim(),
                    fullName: inviteName.trim(),
                    role: inviteRole,
                    companyId: company?.id,
                    privyUserId: user?.id
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to send invite');

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

    const handleRemoveMember = async (memberId: string) => {
        if (!await confirmDialog('Are you sure you want to remove this team member?')) return;
        
        try {
            const { error } = await supabase
                .from('company_users')
                .delete()
                .eq('id', memberId)
                .eq('company_id', company.id);

            if (error) throw error;
            loadTeam();
        } catch (error: any) {
            notify(error.message);
        }
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

            <main className="max-w-5xl mx-auto px-6 py-8">
                {message.text && (
                    <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 border ${message.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
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
                                                <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-accent font-semibold uppercase">
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
                                                member.role === 'owner' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                                                member.role === 'admin' ? 'bg-accent/10 text-accent border-accent/20' :
                                                'bg-surface-hover text-secondary border-subtle'
                                            }`}>
                                                {member.role.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            {member.privy_user_id ? (
                                                <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
                                                    <CheckCircle className="w-4 h-4" /> Active
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-1.5 text-sm text-amber-500 font-medium">
                                                    <Mail className="w-4 h-4" /> Invited
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            {isAdmin && member.role !== 'owner' && (
                                                <button 
                                                    onClick={() => handleRemoveMember(member.id)}
                                                    className="p-2 text-tertiary hover:text-red-600 hover:bg-red-50 rounded-lg transition"
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
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
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
