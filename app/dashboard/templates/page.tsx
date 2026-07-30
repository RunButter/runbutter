'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import { Plus, Trash2, Loader2, Save, X } from 'lucide-react';
import { TEMPLATE_VARS } from '@/lib/render-template';
import PageHeader from '@/components/dashboard/PageHeader';
import { rpc } from '@/lib/rpc';
import { useDialog } from '@/components/ui/Dialog';

const CATEGORIES = ['invite', 'decline', 'offer', 'reminder', 'custom'];
const CAT_STYLE: Record<string, string> = {
    invite: 'bg-accent/10 text-accent ring-accent/30',
    decline: 'bg-danger/10 text-danger ring-danger/30',
    offer: 'bg-success/10 text-success ring-success/30',
    reminder: 'bg-warning/10 text-warning ring-warning/30',
    custom: 'bg-surface-hover text-secondary ring-subtle',
};

const blank = { id: null as string | null, name: '', subject: '', body: '', category: 'custom' };

export default function TemplatesPage() {
  const { confirm: confirmDialog, notify } = useDialog();
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
            const { data, error } = await rpc('get_message_templates', { p_privy_user_id: privyUserId });
            if (error) throw error;
            setTemplates(data || []);
        } catch (e) { console.error('load templates failed', e); }
        finally { setLoading(false); }
    };

    const save = async () => {
        if (!editing || !user || !editing.name.trim() || !editing.subject.trim() || !editing.body.trim()) return;
        setSaving(true);
        try {
            // supabase.rpc() returns { error } — it does NOT throw — so check it explicitly.
            const { error } = await rpc('upsert_message_template', {
                p_privy_user_id: user.id, p_id: editing.id, p_name: editing.name,
                p_subject: editing.subject, p_body: editing.body, p_category: editing.category,
            });
            if (error) throw error;
            setEditing(null);
            await load(user.id);
        } catch (e: any) { notify(e?.message || 'Save failed'); }
        finally { setSaving(false); }
    };

    const remove = async (id: string) => {
        if (!user || !await confirmDialog('Delete this template?')) return;
        try {
            const { error } = await rpc('delete_message_template', { p_privy_user_id: user.id, p_id: id });
            if (error) throw error;
            await load(user.id);
        } catch (e: any) { notify(e?.message || 'Delete failed'); }
    };

    if (!ready || loading) {
        return <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 text-tertiary animate-spin" /></div>;
    }

    return (
        <>
            <PageHeader title="Email templates" count={templates.length}>
                <button onClick={() => setEditing({ ...blank })} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm transition-colors">
                    <Plus className="w-3.5 h-3.5" /> New template
                </button>
            </PageHeader>

            <div className="p-6">
                <div className="max-w-5xl">
                    <p className="text-sm text-secondary mb-4">Reusable messages for inviting, rejecting, and updating candidates.</p>

                    <div className="grid gap-2.5">
                        {templates.map((t) => (
                            <div key={t.id} className="group flex items-start justify-between gap-4 card-surface p-4 hover:ring-strong transition-all">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-semibold text-primary">{t.name}</span>
                                        <span className={`text-3xs font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md ring-1 capitalize ${CAT_STYLE[t.category] || CAT_STYLE.custom}`}>{t.category}</span>
                                    </div>
                                    <div className="text-sm text-secondary truncate">{t.subject}</div>
                                    <div className="text-xs text-tertiary truncate mt-0.5">{t.body}</div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button onClick={() => setEditing({ id: t.id, name: t.name, subject: t.subject, body: t.body, category: t.category })}
                                        className="h-7 px-2.5 text-xs font-semibold rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-sunken">Edit</button>
                                    <button onClick={() => remove(t.id)} className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10"><Trash2 className="w-4 h-4" /></button>
                                </div>
                            </div>
                        ))}
                        {templates.length === 0 && (
                            <div className="rounded-xl ring-1 ring-subtle bg-surface px-6 py-12 text-center text-tertiary text-sm">No templates yet. Create your first one.</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Editor modal */}
            {editing && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={() => setEditing(null)}>
                    <div className="bg-surface rounded-xl ring-1 ring-subtle shadow-popover w-full max-w-xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
                        <div className="h-12 flex items-center justify-between px-4 border-b border-subtle">
                            <h3 className="text-base font-semibold text-primary">{editing.id ? 'Edit template' : 'New template'}</h3>
                            <button onClick={() => setEditing(null)} className="p-1.5 rounded-md hover:bg-surface-hover text-tertiary"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="p-4 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <label className="block">
                                    <span className="block text-xs font-semibold text-secondary mb-1">Name</span>
                                    <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                                        className="w-full h-9 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle outline-none shadow-sm focus:ring-2 focus:ring-accent/30" placeholder="Interview invitation" />
                                </label>
                                <label className="block">
                                    <span className="block text-xs font-semibold text-secondary mb-1">Category</span>
                                    <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                                        className="w-full h-9 px-2 text-sm rounded-md bg-surface ring-1 ring-subtle outline-none shadow-sm focus:ring-2 focus:ring-accent/30 capitalize">
                                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </label>
                            </div>
                            <label className="block">
                                <span className="block text-xs font-semibold text-secondary mb-1">Subject</span>
                                <input value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
                                    className="w-full h-9 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle outline-none shadow-sm focus:ring-2 focus:ring-accent/30" />
                            </label>
                            <label className="block">
                                <span className="block text-xs font-semibold text-secondary mb-1">Body</span>
                                <textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={9}
                                    className="w-full px-2.5 py-2 text-sm rounded-md bg-surface ring-1 ring-subtle outline-none shadow-sm focus:ring-2 focus:ring-accent/30 font-mono" />
                            </label>
                            <p className="text-2xs text-tertiary">
                                Variables: {TEMPLATE_VARS.map((v) => <code key={v} className="mx-1 px-1 bg-surface-hover rounded">{`{{${v}}}`}</code>)}
                            </p>
                            <div className="flex justify-end gap-2 pt-1">
                                <button onClick={() => setEditing(null)} className="h-8 px-3 rounded-md text-sm font-medium text-secondary hover:bg-surface-hover">Cancel</button>
                                <button onClick={save} disabled={saving} className="h-8 px-3 rounded-md text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 inline-flex items-center gap-1.5 disabled:opacity-50">
                                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
