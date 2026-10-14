'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Gauge, Plus, Smile } from 'lucide-react';
import AppLoading from '@/components/ui/AppLoading';
import EmptyState from '@/components/ui/EmptyState';
import { getWorkspace } from '@/lib/crm/data';
import { headline, loadSurveys, saveSurvey, type Survey } from '@/lib/surveys/client';

/**
 * Support → Surveys (0138): NPS and CSAT, asked of the customers in People.
 * Every answer lands on the person and the company as a note, so a detractor
 * is visible where the account is worked, not in a separate tool.
 */
export default function SurveysPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const router = useRouter();
  const [ws, setWs] = useState<{ id: string; role: string } | null>(null);
  const [list, setList] = useState<Survey[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!privy) return;
    getWorkspace(privy).then(async (w) => {
      if (!w?.id) { setError('No workspace found.'); return; }
      setWs({ id: w.id, role: w.role });
      const r = await loadSurveys(privy, w.id);
      if (r.error) setError(r.error); else setList(r.surveys!);
    });
  }, [privy]);
  if (!ready) return <AppLoading />;
  if (!privy) return <div className="page-pad text-sm text-tertiary">Sign in to see surveys.</div>;
  const create = async (kind: 'nps' | 'csat') => {
    if (!ws) return;
    const r = await saveSurvey(privy, ws.id, { kind });
    if (r.error) setError(r.error); else router.push(`/surveys/${r.survey!.id}`);
  };
  const viewer = ws?.role === 'viewer';
  const btn = 'h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold';
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="h-14 shrink-0 flex items-center gap-2 page-x">
        <h1 className="text-base font-medium text-primary mr-auto">Surveys</h1>
        {!viewer && list && list.length > 0 && (
          <>
            <button onClick={() => create('nps')} className={`${btn} text-inverse-fg bg-inverse hover:bg-inverse/90`}><Plus className="w-4 h-4" />NPS</button>
            <button onClick={() => create('csat')} className={`${btn} ring-1 ring-subtle text-primary hover:bg-surface-hover`}><Plus className="w-4 h-4" />CSAT</button>
          </>
        )}
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto page-pad space-y-4">
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        {!list ? (!error && <AppLoading />) : list.length === 0 ? (
          <EmptyState icon={Gauge} title="Ask your customers how you are doing"
            description="NPS asks how likely they are to recommend you (0–10); CSAT how satisfied they are (1–5). Answers land on the person and the company."
            action={!viewer ? (
              <div className="flex gap-2 justify-center">
                <button onClick={() => create('nps')} className={`${btn} h-9 px-4 text-inverse-fg bg-inverse hover:bg-inverse/90`}><Gauge className="w-4 h-4" />Start an NPS survey</button>
                <button onClick={() => create('csat')} className={`${btn} h-9 px-4 ring-1 ring-subtle text-primary hover:bg-surface-hover`}><Smile className="w-4 h-4" />CSAT</button>
              </div>
            ) : undefined} />
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {list.map((s) => {
              const h = headline(s.kind, s.promoters || 0, s.detractors || 0, s.responses || 0);
              return (
                <Link key={s.id} href={`/surveys/${s.id}`} className="card-surface p-4 hover:ring-2 hover:ring-accent/20 block">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-primary font-medium truncate">{s.name}</p>
                    <span className="text-2xs uppercase tracking-wide text-tertiary">{s.kind}</span>
                    {!s.enabled && <span className="ml-auto text-2xs font-semibold rounded-full px-2 py-0.5 bg-surface-hover text-tertiary">Off</span>}
                  </div>
                  <p className="mt-2 text-2xl text-primary font-medium tabular-nums">{h.value}<span className="ml-1.5 text-xs text-tertiary font-normal">{h.label}</span></p>
                  <p className="mt-1 text-xs text-secondary">{s.responses || 0} answers · {s.invites || 0} asked</p>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
