'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import { Mail, Plus, Trash2, Loader2, Save, X } from 'lucide-react';
import { TEMPLATE_VARS } from '@/lib/render-template';

const CATEGORIES = ['invite', 'decline', 'offer', 'reminder', 'custom'];
const CAT_STYLE: Record<string, string> = {
    invite: 'bg-cyan-100 text-cyan-700',
    decline: 'bg-rose-100 text-rose-700',
    offer: 'bg-green-100 text-green-700',
    reminder: 'bg-amber-100 text-amber-700',
    custom: 'bg-gray-100 text-gray-600',
};

const blank = { id: null as string | null, name: '', subject: '', body: '', category: 'custom' };

export default function TemplatesPage() {
    const router = useRouter();
    const { ready, authenticated, user } = usePrivy();
    const [loading, setLoading] = useState(true);
    const [templates, setTemplates] = useState<any[]>([]);
    const [editing, setEditing] = useState<typeof blank | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!ready) return;
        if (!authenticated) { router.push('/auth/login'); return; }
        if (user) load(user.id);
    }, [ready, authenticated, user, router]);

    const load = async (privyUserId: string) => {
        try {
            await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
            const { data, error } = await supabase.rpc('get_message_templates', { p_privy_user_id: privyUserId });
            if (error) throw error;
            setTemplates(data || []);
        } catch (e) { console.error('load templates failed', e); }
        finally { setLoading(false); }
    };

    const save = async () => {
        if (!editing || !user || !editing.name.trim() || !editing.subject.trim() || !editing.body.trim()) return;
        setSaving(true);
        try {
            await supabase.rpc('upsert_message_template', {
                p_privy_user_id: user.id, p_id: editing.id, p_name: editing.name,
                p_subject: editing.subject, p_body: editing.body, p_category: editing.category,
            });
            setEditing(null);
            await load(user.id);
        } catch (e: any) { alert(e?.message || 'Save failed'); }
        finally { setSaving(false); }
    };

    const remove = async (id: string) => {
        if (!user || !confirm('Delete this template?')) return;
        try {
            await supabase.rpc('delete_message_template', { p_privy_user_id: user.id, p_id: id });
            await load(user.id);
        } catch (e) { console.error('delete failed', e); }
    };

    if (!ready || loading) {
        return <div className="h-full flex items-center justify-center"><Loader2 className="w-10 h-10 text-primary-600 animate-spin" /></div>;
    }

    return (
        <div className="p-5 lg:p-8 max-w-[1000px] mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight text-gray-900 flex items-center gap-2">
                        <Mail className="w-5 h-5 text-primary-600" /> Email Templates
                    </h1>
                    <p className="text-sm text-gray-500">Reusable messages for inviting, rejecting, and updating candidates.</p>
                </div>
                <button onClick={() => setEditing({ ...blank })} className="btn-primary flex items-center gap-2">
                    <Plus className="w-4 h-4" /> New template
                </button>
            </div>

            <div className="grid gap-3">
                {templates.map((t) => (
                    <div key={t.id} className="bg-white rounded-2xl border border-gray-200 ring-1 ring-slate-200/40 p-4 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="font-bold text-gray-900">{t.name}</span>
                                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${CAT_STYLE[t.category] || CAT_STYLE.custom}`}>{t.category}</span>
                            </div>
                            <div className="text-sm text-gray-600 truncate">{t.subject}</div>
                            <div className="text-xs text-gray-400 truncate mt-0.5">{t.body}</div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => setEditing({ id: t.id, name: t.name, subject: t.subject, body: t.body, category: t.category })}
                                className="px-3 py-1.5 text-xs font-bold rounded-lg border border-gray-200 text-gray-600 hover:border-primary-200 hover:text-primary-600">Edit</button>
                            <button onClick={() => remove(t.id)} className="p-2 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 className="w-4 h-4" /></button>
                        </div>
                    </div>
                ))}
                {templates.length === 0 && <p className="text-center text-gray-400 py-12">No templates yet. Create your first one.</p>}
            </div>

            {/* Editor modal */}
            {editing && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 backdrop-blur-sm p-4" onClick={() => setEditing(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-5 border-b border-gray-100">
                            <h3 className="font-black text-gray-900">{editing.id ? 'Edit template' : 'New template'}</h3>
                            <button onClick={() => setEditing(null)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <label className="block">
                                    <span className="block text-xs font-semibold text-gray-600 mb-1">Name</span>
                                    <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500" placeholder="Interview invitation" />
                                </label>
                                <label className="block">
                                    <span className="block text-xs font-semibold text-gray-600 mb-1">Category</span>
                                    <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white outline-none focus:ring-2 focus:ring-primary-500">
                                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </label>
                            </div>
                            <label className="block">
                                <span className="block text-xs font-semibold text-gray-600 mb-1">Subject</span>
                                <input value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500" />
                            </label>
                            <label className="block">
                                <span className="block text-xs font-semibold text-gray-600 mb-1">Body</span>
                                <textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={9}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 font-mono" />
                            </label>
                            <p className="text-[11px] text-gray-400">
                                Variables: {TEMPLATE_VARS.map((v) => <code key={v} className="mx-1 px-1 bg-gray-100 rounded">{`{{${v}}}`}</code>)}
                            </p>
                            <div className="flex justify-end gap-2 pt-2">
                                <button onClick={() => setEditing(null)} className="btn-secondary">Cancel</button>
                                <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2">
                                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
