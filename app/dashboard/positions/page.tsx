'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import { Briefcase, Plus, Search, Filter, MoreVertical, Edit2, Trash2, Eye, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function PositionsPage() {
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
            await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });

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

    const filteredPositions = positions.filter(p =>
        p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.department?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (!ready || loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-primary-600 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white border-b">
                <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <Link href="/dashboard" className="text-gray-500 hover:text-gray-700">Dashboard</Link>
                        <span className="text-gray-400">/</span>
                        <h1 className="text-xl font-bold text-gray-800">Positions</h1>
                    </div>
                    <Link href="/dashboard/positions/new" className="btn-primary flex items-center gap-2">
                        <Plus className="w-4 h-4" />
                        Create Position
                    </Link>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-8">
                <div className="mb-6 flex flex-col md:flex-row gap-4 items-center justify-between">
                    <div className="relative w-full md:w-96">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search positions..."
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="flex gap-2 w-full md:w-auto">
                        <button className="btn-secondary flex items-center gap-2 text-sm">
                            <Filter className="w-4 h-4" />
                            Filter
                        </button>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className="px-6 py-4 text-sm font-semibold text-gray-600">Position Details</th>
                                <th className="px-6 py-4 text-sm font-semibold text-gray-600">Department</th>
                                <th className="px-6 py-4 text-sm font-semibold text-gray-600">Candidates</th>
                                <th className="px-6 py-4 text-sm font-semibold text-gray-600">Status</th>
                                <th className="px-6 py-4 text-sm font-semibold text-gray-600 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {filteredPositions.map((pos) => (
                                <tr key={pos.id} className="hover:bg-gray-50 transition">
                                    <td className="px-6 py-4">
                                        <div className="font-semibold text-gray-800">{pos.title}</div>
                                        <div className="text-xs text-gray-500">{pos.location} • {pos.employment_type}</div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-600">{pos.department || '—'}</td>
                                    <td className="px-6 py-4 text-sm text-gray-600">{pos.candidates?.[0]?.count || 0} applications</td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${pos.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                            {pos.is_active ? 'Active' : 'Draft'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <Link href={`/apply/${pos.id}`} target="_blank" className="p-2 text-gray-400 hover:text-primary-600 title='View Portal'">
                                                <Eye className="w-5 h-5" />
                                            </Link>
                                            <button className="p-2 text-gray-400 hover:text-primary-600">
                                                <Edit2 className="w-5 h-5" />
                                            </button>
                                            <button className="p-2 text-gray-400 hover:text-red-600">
                                                <Trash2 className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredPositions.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                                        No positions found. Create one to start hiring!
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </main>
        </div>
    );
}
