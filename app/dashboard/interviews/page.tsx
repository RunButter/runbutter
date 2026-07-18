'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Calendar, Clock, Briefcase, Video, Loader2, Plus, Trash2, X, Mail } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import Button from '@/components/ui/Button';
import { useDialog } from '@/components/ui/Dialog';
import {
  listInterviews, scheduleInterview, cancelInterview, searchCandidatesLite,
  type Interview, type CandidateLite,
} from '@/lib/hr/manage';

export default function InterviewsPage() {
  const { confirm: confirmDialog, notify } = useDialog();
  const router = useRouter();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const [loading, setLoading] = useState(true);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [scheduling, setScheduling] = useState(false);

  const reload = useCallback(async (p: string) => {
    setInterviews(await listInterviews(p));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) { router.push('/auth/login'); return; }
    if (privy) reload(privy);
  }, [ready, authenticated, privy, router, reload]);

  const cancel = async (iv: Interview) => {
    if (!privy) return;
    if (!(await confirmDialog(`Cancel the interview with ${iv.candidate_name}?`))) return;
    const { error } = await cancelInterview(privy, iv.id);
    if (error) { notify(error); return; }
    reload(privy);
  };

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return { day: d.toLocaleDateString('en', { month: 'short', day: 'numeric' }), time: d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }) };
  };

  if (!ready || loading) {
    return <div className="h-full flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  return (
    <>
      <PageHeader title="Interviews" count={interviews.length}>
        <Button size="sm" variant="primary" onClick={() => setScheduling(true)} disabled={!privy}>
          <Plus className="w-3.5 h-3.5" /> Schedule
        </Button>
      </PageHeader>

      <div className="p-6">
        <div className="max-w-3xl mx-auto">
          <div className="mb-5">
            <h2 className="text-lg font-medium text-primary tracking-tight">Upcoming interviews</h2>
            <p className="text-[13px] text-secondary">Schedule and track candidate evaluations. Connect Google Calendar on a candidate for Meet links.</p>
          </div>

          <div className="space-y-3">
            {interviews.map((iv) => {
              const t = fmt(iv.scheduled_at);
              return (
                <div key={iv.id} className="group flex items-center gap-4 rounded-xl bg-surface border border-subtle p-4 hover:border-strong transition-colors">
                  <div className="w-14 h-14 rounded-xl bg-surface-sunken border border-subtle flex flex-col items-center justify-center text-accent shrink-0">
                    <Calendar className="w-5 h-5" />
                    <span className="text-[9px] font-medium uppercase tracking-tight mt-0.5">{t.day}</span>
                  </div>
                  <button onClick={() => router.push(`/dashboard/candidates/${iv.candidate_id}`)} className="min-w-0 flex-1 text-left">
                    <h3 className="text-sm font-medium text-primary truncate group-hover:text-accent transition-colors">{iv.candidate_name}</h3>
                    <div className="flex items-center gap-3 mt-0.5 text-[12px] text-secondary">
                      {iv.position_title && <span className="inline-flex items-center gap-1"><Briefcase className="w-3.5 h-3.5 text-tertiary" /> {iv.position_title}</span>}
                      <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-tertiary" /> {t.time} · {iv.duration_minutes}m</span>
                    </div>
                    {iv.notes && <p className="text-[12px] text-tertiary mt-1 truncate">{iv.notes}</p>}
                  </button>
                  {iv.meet_link && (
                    <a href={iv.meet_link} target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex items-center gap-1 text-[10px] text-tertiary hover:text-accent shrink-0"><Video className="w-3 h-3" /> Meet</a>
                  )}
                  <button onClick={() => cancel(iv)} aria-label="Cancel interview"
                    className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10 transition-colors shrink-0"><Trash2 className="w-4 h-4" /></button>
                </div>
              );
            })}
          </div>

          {interviews.length === 0 && (
            <div className="rounded-xl border border-dashed border-subtle p-12 text-center">
              <Calendar className="w-8 h-8 text-tertiary mx-auto mb-3" />
              <h3 className="text-sm font-medium text-secondary">No upcoming interviews</h3>
              <p className="text-[12px] text-tertiary mt-1">Click Schedule to set one up.</p>
            </div>
          )}
        </div>
      </div>

      {scheduling && privy && (
        <ScheduleModal privy={privy} onClose={() => setScheduling(false)} onDone={() => { setScheduling(false); reload(privy); }} />
      )}
    </>
  );
}

function ScheduleModal({ privy, onClose, onDone }: { privy: string; onClose: () => void; onDone: () => void }) {
  const { notify } = useDialog();
  const [candidates, setCandidates] = useState<CandidateLite[]>([]);
  const [candidateId, setCandidateId] = useState('');
  const [when, setWhen] = useState('');
  const [duration, setDuration] = useState(30);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { searchCandidatesLite(privy, '').then(setCandidates); }, [privy]);

  const submit = async () => {
    if (!candidateId || !when) return;
    setBusy(true);
    const { error } = await scheduleInterview(privy, candidateId, new Date(when).toISOString(), duration, notes);
    setBusy(false);
    if (error) { notify(error); return; }
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-surface border border-subtle rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 flex items-center justify-between px-4 border-b border-subtle">
          <h3 className="text-sm font-medium text-primary">Schedule interview</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <label className="block">
            <span className="block text-xs font-medium text-secondary mb-1">Candidate</span>
            <select value={candidateId} onChange={(e) => setCandidateId(e.target.value)} className="input-field">
              <option value="">Select a candidate…</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.full_name} · {c.email}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-secondary mb-1">Date &amp; time</span>
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="input-field" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-secondary mb-1">Duration</span>
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="input-field">
                {[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="block text-xs font-medium text-secondary mb-1">Notes <span className="text-tertiary">(optional)</span></span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input-field !h-auto py-2 resize-y" placeholder="Technical screen, portfolio review…" />
          </label>
        </div>
        <div className="h-14 flex items-center justify-end gap-2 px-4 border-t border-subtle">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !candidateId || !when} onClick={submit}>
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Schedule
          </Button>
        </div>
      </div>
    </div>
  );
}
