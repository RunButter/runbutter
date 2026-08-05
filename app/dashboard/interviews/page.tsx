'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import Link from 'next/link';
import { Calendar, Clock, Briefcase, Video, Loader2, Plus, Trash2, X, Pencil, Info } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import Button from '@/components/ui/Button';
import { useDialog } from '@/components/ui/Dialog';
import AppLoading from '@/components/ui/AppLoading';
import {
  listInterviews, scheduleInterview, updateInterview, cancelInterview,
  searchCandidatesLite, isGoogleConnected,
  type Interview, type CandidateLite,
} from '@/lib/hr/manage';

export default function InterviewsPage() {
  const { confirm: confirmDialog, notify } = useDialog();
  const router = useRouter();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const [loading, setLoading] = useState(true);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [googleReady, setGoogleReady] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Interview | null>(null);

  const reload = useCallback(async (p: string) => {
    const [ivs, g] = await Promise.all([listInterviews(p), isGoogleConnected(p)]);
    setInterviews(ivs);
    setGoogleReady(g);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) { router.push('/auth/login'); return; }
    if (privy) reload(privy);
  }, [ready, authenticated, privy, router, reload]);

  const cancel = async (iv: Interview) => {
    if (!privy) return;
    if (!(await confirmDialog({
      title: `Cancel interview with ${iv.candidate_name}?`,
      body: 'The calendar event is removed and the candidate is emailed that it was cancelled.',
      danger: true, confirmLabel: 'Cancel interview',
    }))) return;
    const { error } = await cancelInterview(iv.id);
    if (error) { notify(error); return; }
    reload(privy);
  };

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return { day: d.toLocaleDateString('en', { month: 'short', day: 'numeric' }), time: d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }) };
  };

  if (!ready || loading) {
    return <AppLoading />;
  }

  return (
    <>
      <PageHeader title="Interviews" count={interviews.length}>
        <Button size="sm" variant="primary" onClick={() => setCreating(true)} disabled={!privy}>
          <Plus className="w-3.5 h-3.5" /> Schedule
        </Button>
      </PageHeader>

      <div className="p-6">
        <div className="max-w-5xl">
          <div className="mb-5">
            <h2 className="text-lg font-medium text-primary tracking-tight">Upcoming interviews</h2>
            <p className="text-sm text-secondary">
              {googleReady
                ? 'Scheduling creates a Google Meet link and emails it to the candidate.'
                : 'Scheduling emails the candidate. Connect Google Calendar (Automate → Integrations) to auto-add a Meet link.'}
            </p>
          </div>

          {!googleReady && (
            <Link href="/settings/integrations" className="mb-4 flex items-center gap-2 rounded-lg border border-subtle bg-surface-sunken px-3 py-2 text-xs text-secondary hover:border-strong">
              <Info className="w-3.5 h-3.5 text-accent shrink-0" />
              Connect Google Calendar (Automate → Integrations) to generate Meet links and calendar invites automatically.
            </Link>
          )}

          <div className="space-y-3">
            {interviews.map((iv) => {
              const t = fmt(iv.scheduled_at);
              return (
                <div key={iv.id} className="group flex items-center gap-4 rounded-xl bg-surface border border-subtle p-4 hover:border-strong transition-colors">
                  <div className="w-14 h-14 rounded-xl bg-surface-sunken border border-subtle flex flex-col items-center justify-center text-accent shrink-0">
                    <Calendar className="w-5 h-5" />
                    <span className="text-3xs font-medium uppercase tracking-tight mt-0.5">{t.day}</span>
                  </div>
                  <button onClick={() => router.push(`/dashboard/candidates/${iv.candidate_id}`)} className="min-w-0 flex-1 text-left">
                    <h3 className="text-sm font-medium text-primary truncate group-hover:text-accent transition-colors">{iv.candidate_name}</h3>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-secondary">
                      {iv.position_title && <span className="inline-flex items-center gap-1"><Briefcase className="w-3.5 h-3.5 text-tertiary" /> {iv.position_title}</span>}
                      <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-tertiary" /> {t.time} · {iv.duration_minutes}m</span>
                    </div>
                    {iv.notes && <p className="text-xs text-tertiary mt-1 truncate">{iv.notes}</p>}
                  </button>
                  {iv.meet_link && (
                    <a href={iv.meet_link} target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex items-center gap-1 text-3xs text-tertiary hover:text-accent shrink-0"><Video className="w-3 h-3" /> Meet</a>
                  )}
                  <button onClick={() => setEditing(iv)} aria-label="Edit interview"
                    className="p-1.5 rounded-md text-tertiary hover:text-accent hover:bg-surface-hover transition-colors shrink-0"><Pencil className="w-4 h-4" /></button>
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
              <p className="text-xs text-tertiary mt-1">Click Schedule to set one up.</p>
            </div>
          )}
        </div>
      </div>

      {creating && privy && (
        <InterviewModal mode="create" privy={privy} googleReady={googleReady}
          onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(privy); }} />
      )}
      {editing && privy && (
        <InterviewModal mode="edit" privy={privy} googleReady={googleReady} interview={editing}
          onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(privy); }} />
      )}
    </>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function InterviewModal({
  mode, privy, googleReady, interview, onClose, onDone,
}: {
  mode: 'create' | 'edit'; privy: string; googleReady: boolean;
  interview?: Interview; onClose: () => void; onDone: () => void;
}) {
  const { notify } = useDialog();
  const isEdit = mode === 'edit';
  const [candidates, setCandidates] = useState<CandidateLite[]>([]);
  const [candidateId, setCandidateId] = useState(interview?.candidate_id ?? '');
  const [when, setWhen] = useState(interview ? toLocalInput(interview.scheduled_at) : '');
  const [duration, setDuration] = useState(interview?.duration_minutes ?? 30);
  const [notes, setNotes] = useState(interview?.notes ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!isEdit) searchCandidatesLite(privy, '').then(setCandidates); }, [privy, isEdit]);

  const submit = async () => {
    if ((!isEdit && !candidateId) || !when) return;
    setBusy(true);
    if (isEdit && interview) {
      const { ok, emailed, error } = await updateInterview(interview.id, new Date(when).toISOString(), duration, notes);
      setBusy(false);
      if (error) { notify(error); return; }
      if (ok) notify(emailed ? 'Interview updated — the candidate has been emailed the new time.' : 'Interview updated.');
      onDone();
    } else {
      const r = await scheduleInterview(candidateId, new Date(when).toISOString(), duration, notes);
      setBusy(false);
      if (r.error) { notify(r.error); return; }
      notify(
        r.meet && r.emailed ? 'Interview scheduled — a Google Meet link was created and emailed to the candidate.'
        : r.emailed ? 'Interview scheduled — the candidate has been emailed. Connect Google Calendar to include a Meet link.'
        : r.meet ? 'Interview scheduled — Google Meet link created.'
        : 'Interview scheduled.'
      );
      onDone();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="bg-surface border border-subtle rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 flex items-center justify-between px-4 border-b border-subtle">
          <h3 className="text-sm font-medium text-primary">{isEdit ? 'Reschedule interview' : 'Schedule interview'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <label className="block">
            <span className="block text-xs font-medium text-secondary mb-1">Candidate</span>
            {isEdit ? (
              <div className="input-field flex items-center text-primary bg-surface-sunken">{interview?.candidate_name}</div>
            ) : (
              <select value={candidateId} onChange={(e) => setCandidateId(e.target.value)} className="input-field">
                <option value="">Select a candidate…</option>
                {candidates.map((c) => <option key={c.id} value={c.id}>{c.full_name} · {c.email}</option>)}
              </select>
            )}
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
          <p className="flex items-start gap-1.5 text-2xs text-tertiary">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px text-accent" />
            {googleReady
              ? `A Google Meet link and calendar invite will be ${isEdit ? 'updated' : 'created'} and the candidate emailed.`
              : 'The candidate will be emailed. Connect Google Calendar in Automate → Integrations for an automatic Meet link.'}
          </p>
        </div>
        <div className="h-14 flex items-center justify-end gap-2 px-4 border-t border-subtle">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || (!isEdit && !candidateId) || !when} onClick={submit}>
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {isEdit ? 'Save changes' : 'Schedule'}
          </Button>
        </div>
      </div>
    </div>
  );
}
