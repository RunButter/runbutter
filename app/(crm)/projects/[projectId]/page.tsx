'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { ArrowLeft, Loader2, Plus, CheckCircle2, Circle, Clock } from 'lucide-react';
import { loadProject } from '@/lib/crm/data';
import PipelineBoard from '@/components/crm/PipelineBoard';
import type { PipelineStage, PipelineRecord } from '@/lib/crm/types';

const STATUS_TONE: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60',
  paused: 'bg-amber-50 text-amber-700 ring-amber-200/60',
  completed: 'bg-slate-100 text-slate-500 ring-slate-200/60',
  cancelled: 'bg-rose-50 text-rose-700 ring-rose-200/60',
};

export default function ProjectDashboard() {
  const params = useParams();
  const projectId = String(params.projectId);
  const { ready, authenticated, user } = usePrivy();

  const [project, setProject] = useState<any>(null);
  const [board, setBoard] = useState<{ stages: PipelineStage[]; records: PipelineRecord[] }>({ stages: [], records: [] });
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    loadProject(authenticated && user ? user.id : null, projectId).then((res) => {
      if (cancelled) return;
      setProject(res.project); setBoard({ stages: res.stages, records: res.records }); setLive(res.live); setLoading(false);
    });
    return () => { cancelled = true; };
  }, [ready, authenticated, user, projectId]);

  const total = board.records.length;
  const done = board.records.filter((r) => r.stage_id === 'done').length;
  const inProgress = board.records.filter((r) => r.stage_id === 'in_progress').length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const stats = [
    { label: 'Issues', value: total, icon: Circle, tone: 'text-slate-400' },
    { label: 'In progress', value: inProgress, icon: Clock, tone: 'text-violet-500' },
    { label: 'Done', value: done, icon: CheckCircle2, tone: 'text-emerald-500' },
    { label: 'Complete', value: `${pct}%`, icon: CheckCircle2, tone: 'text-indigo-500' },
  ];

  return (
    <>
      <header className="shrink-0 px-4 pt-3 pb-3 border-b border-slate-200/70">
        <div className="flex items-center gap-2">
          <Link href="/objects/projects" className="p-1.5 -ml-1 rounded-md text-slate-400 hover:bg-slate-100"><ArrowLeft className="w-4 h-4" /></Link>
          <h1 className="text-sm font-bold text-slate-800">{project?.name || 'Project'}</h1>
          {project?.identifier && <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 rounded-md px-1.5 py-0.5">{project.identifier}</span>}
          {project?.status && <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ring-1 ${STATUS_TONE[project.status] || STATUS_TONE.active}`}>{project.status}</span>}
          <span className={`ml-1 text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{live ? 'Live' : 'Sample'}</span>
          <button className="ml-auto h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-bold text-white bg-primary-600 hover:bg-primary-700 shadow-sm"><Plus className="w-3.5 h-3.5" /> New issue</button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-300"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <>
            <div className="shrink-0 grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
              {stats.map((s) => (
                <div key={s.label} className="rounded-xl bg-white ring-1 ring-slate-200/60 p-3">
                  <s.icon className={`w-4 h-4 ${s.tone}`} />
                  <div className="mt-2 text-2xl font-black text-slate-900 tabular-nums">{s.value}</div>
                  <div className="text-[12px] font-medium text-slate-400">{s.label}</div>
                </div>
              ))}
            </div>
            <div className="flex-1 overflow-hidden px-4 pb-4">
              <PipelineBoard key={`${projectId}-${live}-${total}`} stages={board.stages} records={board.records} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
