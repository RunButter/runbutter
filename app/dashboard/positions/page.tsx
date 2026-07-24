'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import { Plus, Search, Edit2, Trash2, Eye, Loader2 } from 'lucide-react';
import Link from 'next/link';
import PageHeader from '@/components/dashboard/PageHeader';
import { useDialog } from '@/components/ui/Dialog';

export default function PositionsPage() {
  const { confirm: confirmDialog, notify } = useDialog();
    const router = useRouter();
    const { ready, authenticated, user } = usePrivy();
    const [loading, setLoading] = useState(true);
    const [positions, setPositions] = useState<any[]>([]);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        if (ready) {
            if (!authenticated) {
                router.push('/auth/login');
            } else if (user) {
                loadPositions(user.id);
            }
        }
    }, [ready, authenticated, user, router]);

    const loadPositions = async (privyUserId: string) => {
        try {

            const { data: companyUser } = await supabase
                .from('company_users')
                .select('company_id')
                .eq('privy_user_id', privyUserId)
                .single();

            if (!companyUser) return;

            const { data, error } = await supabase
                .from('positions')
                .select(`
          *,
          candidates:candidates(count)
        `)
                .eq('company_id', companyUser.company_id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setPositions(data || []);
        } catch (error) {
            console.error('Error loading positions:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDeletePosition = async (id: string) => {
        if (!await confirmDialog('Are you sure you want to delete this position? All associated candidates and assessments will be removed.')) return;

        try {
            const { error } = await supabase
                .from('positions')
                .delete()
                .eq('id', id);

            if (error) throw error;
            setPositions(positions.filter(p => p.id !== id));
        } catch (error) {
            console.error('Error deleting position:', error);
            notify('Failed to delete position');
        }
    };

    const filteredPositions = positions.filter(p =>
        p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.department?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (!ready || loading) {
        return <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 text-tertiary animate-spin" /></div>;
    }

    return (
        <>
            <PageHeader title="Positions" count={filteredPositions.length}>
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-tertiary" />
                    <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search positions…"
                        className="h-8 w-56 pl-8 pr-2 text-[13px] rounded-lg bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none" />
                </div>
                <Link href="/dashboard/positions/new" className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm transition-colors">
                    <Plus className="w-3.5 h-3.5" /> Create
                </Link>
            </PageHeader>

            <div className="p-6">
                <div className="max-w-6xl rounded-xl bg-surface ring-1 ring-subtle shadow-card overflow-hidden">
                    <table className="w-full text-[13px] border-separate border-spacing-0">
                        <thead>
                            <tr>
                                {['Position', 'Department', 'Candidates', 'Status', ''].map((h, i) => (
                                    <th key={i} className={`bg-surface-sunken/60 px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-tertiary border-b border-subtle ${i === 4 ? 'text-right' : 'text-left'}`}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredPositions.map((pos) => (
                                <tr key={pos.id} className="group hover:bg-surface-sunken/70 transition-colors">
                                    <td className="px-4 h-[52px] border-b border-subtle">
                                        <div className="font-semibold text-primary">{pos.title}</div>
                                        <div className="text-[11px] text-tertiary">{pos.location}{pos.employment_type ? ` · ${pos.employment_type}` : ''}</div>
                                    </td>
                                    <td className="px-4 h-[52px] border-b border-subtle text-secondary">{pos.department || '—'}</td>
                                    <td className="px-4 h-[52px] border-b border-subtle text-secondary tabular-nums">{pos.candidates?.[0]?.count || 0}</td>
                                    <td className="px-4 h-[52px] border-b border-subtle">
                                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold ring-1 ${pos.is_active ? 'bg-success/10 text-success ring-success/30' : 'bg-surface-hover text-secondary ring-subtle'}`}>
                                            {pos.is_active ? 'Active' : 'Draft'}
                                        </span>
                                    </td>
                                    <td className="px-4 h-[52px] border-b border-subtle text-right">
                                        <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                                            <Link href={`/apply/${pos.id}`} target="_blank" title="View portal" className="p-1.5 rounded-md text-tertiary hover:text-accent hover:bg-surface-hover"><Eye className="w-4 h-4" /></Link>
                                            <button onClick={() => router.push(`/dashboard/positions/${pos.id}/edit`)} title="Edit" className="p-1.5 rounded-md text-tertiary hover:text-accent hover:bg-surface-hover"><Edit2 className="w-4 h-4" /></button>
                                            <button onClick={() => handleDeletePosition(pos.id)} title="Delete" className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10"><Trash2 className="w-4 h-4" /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredPositions.length === 0 && (
                                <tr><td colSpan={5} className="px-4 py-16 text-center text-tertiary">No positions found. Create one to start hiring.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    );
}
