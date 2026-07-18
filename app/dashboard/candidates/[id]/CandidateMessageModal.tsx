'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { X, Mail, Send, Loader2, Check } from 'lucide-react';
import { rpc } from '@/lib/rpc';

interface Props {
    candidate: any;
    privyUserId: string;
    onClose: () => void;
}

// Compose + send a (optionally template-based) email to a candidate.
export default function CandidateMessageModal({ candidate, privyUserId, onClose }: Props) {
    const [templates, setTemplates] = useState<any[]>([]);
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        (async () => {
            try {
                const { data } = await rpc('get_message_templates', { p_privy_user_id: privyUserId });
                setTemplates(data || []);
            } catch (e) { console.error('load templates failed', e); }
        })();
    }, [privyUserId]);

    const applyTemplate = (id: string) => {
        const t = templates.find((x) => x.id === id);
        if (t) { setSubject(t.subject); setBody(t.body); }
    };

    const send = async () => {
        if (!subject.trim() || !body.trim()) return;
        setSending(true); setError('');
        try {
            const res = await fetch('/api/email/candidate-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ candidateId: candidate.id, subject, body, privyUserId }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to send');
            setSent(true);
            setTimeout(onClose, 1200);
        } catch (e: any) {
            setError(e.message || 'Failed to send');
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-surface rounded-2xl shadow-popover w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-subtle">
                    <div>
                        <h3 className="font-semibold text-primary flex items-center gap-2"><Mail className="w-5 h-5 text-accent" /> Message {candidate.full_name?.split(' ')[0]}</h3>
                        <p className="text-xs text-tertiary">{candidate.email}</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-hover text-tertiary"><X className="w-5 h-5" /></button>
                </div>

                <div className="p-5 space-y-4">
                    {templates.length > 0 && (
                        <label className="block">
                            <span className="block text-xs font-semibold text-secondary mb-1">Start from a template</span>
                            <select onChange={(e) => e.target.value && applyTemplate(e.target.value)} defaultValue=""
                                className="w-full px-3 py-2 text-sm border border-subtle rounded-lg bg-surface outline-none focus:ring-2 focus:ring-accent/30">
                                <option value="">— None —</option>
                                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                        </label>
                    )}
                    <label className="block">
                        <span className="block text-xs font-semibold text-secondary mb-1">Subject</span>
                        <input value={subject} onChange={(e) => setSubject(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-subtle rounded-lg outline-none focus:ring-2 focus:ring-accent/30" />
                    </label>
                    <label className="block">
                        <span className="block text-xs font-semibold text-secondary mb-1">Message</span>
                        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10}
                            className="w-full px-3 py-2 text-sm border border-subtle rounded-lg outline-none focus:ring-2 focus:ring-accent/30" />
                    </label>
                    <p className="text-[11px] text-tertiary">Variables like <code className="px-1 bg-surface-hover rounded">{'{{first_name}}'}</code> are filled in automatically when sent.</p>
                    {error && <p className="text-sm text-danger">{error}</p>}
                    <div className="flex justify-end gap-2">
                        <button onClick={onClose} className="btn-secondary">Cancel</button>
                        <button onClick={send} disabled={sending || sent} className="btn-primary flex items-center gap-2">
                            {sent ? <Check className="w-4 h-4" /> : sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            {sent ? 'Sent!' : 'Send email'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
