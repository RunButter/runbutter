'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { brandColor, onColor } from '@/components/booking/SlotPicker';

/**
 * The respondent's page for a survey (0138) — /survey/<id>.
 *
 * From an email (`?i=&t=&score=`) the score is recorded on arrival, so one tap
 * in the inbox is a complete answer; the page then asks for the reason, which
 * UPDATES the same answer. From the share link there is no invite: the person
 * picks a score here and submits once. `?unsubscribe=1` stops survey emails.
 */

interface PublicSurvey {
  id: string; kind: 'nps' | 'csat'; question: string; followup_question: string | null; thank_you: string | null;
  company?: { name?: string; logo?: string | null; accent?: string | null } | null;
  answer?: { score: number; comment: string | null } | null;
}

async function call(body: Record<string, any>) {
  const res = await fetch('/api/surveys/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'Something went wrong. Try again.');
  return d;
}

const FACES = ['😞', '🙁', '😐', '🙂', '😄'];

export default function SurveyRespond({ surveyId, embed = false }: { surveyId: string; embed?: boolean }) {
  const [s, setS] = useState<PublicSurvey | null>(null);
  const [error, setError] = useState('');
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [email, setEmail] = useState('');
  const [trap, setTrap] = useState('');
  const [stage, setStage] = useState<'loading' | 'pick' | 'reason' | 'done' | 'optout' | 'optedout'>('loading');
  const [busy, setBusy] = useState(false);
  const keys = useRef<{ invite?: string; token?: string }>({});

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const invite = q.get('i') || undefined, token = q.get('t') || undefined;
    keys.current = { invite, token };
    const wanted = q.get('score');
    // The token stays out of the address bar once read (history, screenshots).
    if (invite) window.history.replaceState(null, '', window.location.pathname + (embed ? '?embed=1' : ''));
    call({ action: 'get', survey: surveyId, invite, token }).then(async (d) => {
      const sv = d.survey as PublicSurvey;
      setS(sv);
      if (q.get('unsubscribe') === '1' && invite) { setStage('optout'); return; }
      const n = wanted !== null && /^\d{1,2}$/.test(wanted) ? Number(wanted) : null;
      const lo = sv.kind === 'csat' ? 1 : 0, hi = sv.kind === 'csat' ? 5 : 10;
      if (invite && n !== null && n >= lo && n <= hi) {
        setScore(n);
        try { await call({ action: 'answer', survey: surveyId, invite, token, score: n }); setStage('reason'); }
        catch (e: any) { setError(e.message); setStage('pick'); }
        return;
      }
      if (sv.answer) { setScore(sv.answer.score); setComment(sv.answer.comment || ''); }
      setStage('pick');
    }, (e) => setError(e.message));
  }, [surveyId, embed]);

  const color = brandColor(s?.company?.accent);
  const fg = onColor(color);
  const submit = async () => {
    if (score === null) return;
    setBusy(true); setError('');
    try {
      await call({ action: 'answer', survey: surveyId, ...keys.current, score, comment, email, website: trap });
      setStage('done');
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const optOut = async () => {
    setBusy(true);
    try { await call({ action: 'optout', survey: surveyId, ...keys.current }); setStage('optedout'); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const scale = s?.kind === 'csat' ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const reasonQ = s?.followup_question || (score === null ? 'Anything you would like to add?'
    : (s?.kind === 'csat' ? score >= 4 : score >= 9) ? 'What do you like most?' : 'What could we do better?');

  const card = (
    <div className={embed ? 'p-4' : 'rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-6 sm:p-8'}>
      {s?.company?.logo ? <img src={s.company.logo} alt={s.company.name || ''} className="h-7 max-w-[140px] object-contain mb-4" />
        : s?.company?.name ? <p className="text-sm mb-4" style={{ color }}>{s.company.name}</p> : null}
      {stage === 'loading' && !error && <p className="text-sm text-tertiary flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading…</p>}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      {s && stage === 'pick' && (
        <div className="space-y-5">
          <h1 className="text-lg text-primary font-medium">{s.question}</h1>
          <div>
            <div className={s.kind === 'csat' ? 'flex gap-2' : 'grid grid-cols-6 sm:grid-cols-11 gap-1.5'}>
              {scale.map((n) => (
                <button key={n} type="button" onClick={() => setScore(n)} aria-pressed={score === n} aria-label={String(n)}
                  className={`h-11 ${s.kind === 'csat' ? 'flex-1 text-2xl' : 'text-sm font-semibold'} rounded-lg ring-1 transition-shadow ${score === n ? '' : 'ring-strong text-primary hover:ring-2'}`}
                  style={score === n ? { background: color, color: fg, ['--tw-ring-color' as any]: color } : undefined}>
                  {s.kind === 'csat' ? FACES[n - 1] : n}
                </button>
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-2xs text-tertiary">
              <span>{s.kind === 'csat' ? 'Very unsatisfied' : 'Not likely'}</span><span>{s.kind === 'csat' ? 'Very satisfied' : 'Very likely'}</span>
            </div>
          </div>
          {score !== null && (
            <>
              <label className="block"><span className="text-sm text-primary">{reasonQ} <span className="text-tertiary">(optional)</span></span>
                <textarea rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-surface ring-1 ring-subtle text-sm text-primary outline-none focus:ring-2" /></label>
              {!keys.current.invite && (
                <label className="block"><span className="text-sm text-primary">Your email <span className="text-tertiary">(optional)</span></span>
                  <input type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full h-10 px-3 rounded-lg bg-surface ring-1 ring-subtle text-sm text-primary outline-none focus:ring-2" /></label>
              )}
              <input type="text" tabIndex={-1} aria-hidden="true" autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} className="absolute -left-[9999px] w-px h-px opacity-0" />
              <button type="button" onClick={submit} disabled={busy} className="h-10 px-5 rounded-full text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60" style={{ background: color, color: fg }}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}Send</button>
            </>
          )}
        </div>
      )}

      {s && stage === 'reason' && (
        <div className="space-y-4">
          <p className="text-sm text-secondary flex items-center gap-2"><span className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: color, color: fg }}><Check className="w-3 h-3" /></span>
            Thanks — your answer ({s.kind === 'csat' ? FACES[(score || 1) - 1] : score}) is in.</p>
          <label className="block"><span className="text-base text-primary">{reasonQ}</span>
            <textarea autoFocus rows={4} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)}
              className="mt-2 w-full px-3 py-2 rounded-lg bg-surface ring-1 ring-subtle text-sm text-primary outline-none focus:ring-2" /></label>
          <div className="flex items-center gap-3">
            <button type="button" onClick={submit} disabled={busy || !comment.trim()} className="h-10 px-5 rounded-full text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50" style={{ background: color, color: fg }}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}Send</button>
            <button type="button" onClick={() => setStage('pick')} className="text-sm text-secondary hover:text-primary">Change my score</button>
          </div>
        </div>
      )}

      {s && stage === 'done' && (
        <div className="text-center py-4 space-y-3">
          <span className="mx-auto w-12 h-12 rounded-full flex items-center justify-center" style={{ background: color, color: fg }}><Check className="w-6 h-6" /></span>
          <p className="text-lg text-primary">{s.thank_you || 'Thank you — that helps.'}</p>
        </div>
      )}

      {s && stage === 'optout' && (
        <div className="space-y-4">
          <p className="text-base text-primary">Stop survey emails from {s.company?.name || 'this company'}?</p>
          <button type="button" onClick={optOut} disabled={busy} className="h-10 px-5 rounded-full text-sm font-semibold disabled:opacity-60" style={{ background: color, color: fg }}>Yes, stop them</button>
        </div>
      )}
      {stage === 'optedout' && <p className="text-base text-primary">Done — you will not get survey emails from {s?.company?.name || 'us'} again.</p>}
    </div>
  );

  if (embed) return card;
  return (
    <main className="min-h-[100dvh] bg-canvas flex items-start sm:items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-xl">{card}</div>
    </main>
  );
}
