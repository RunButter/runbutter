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
  active: 'bg-success/10 text-success ring-success/30',
  paused: 'bg-warning/10 text-warning ring-warning/30',
  completed: 'bg-surface-hover text-secondary ring-subtle',
  cancelled: 'bg-danger/10 text-danger ring-danger/30',
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
    { label: 'Issues', value: total, icon: Circle, tone: 'text-tertiary' },
    { label: 'In progress', value: inProgress, icon: Clock, tone: 'text-accent' },
    { label: 'Done', value: done, icon: CheckCircle2, tone: 'text-success' },
    { label: 'Complete', value: `${pct}%`, icon: CheckCircle2, tone: 'text-accent' },
  ];

  return (
    <>
      <header className="shrink-0 px-4 pt-3 pb-3 border-b border-subtle">
        <div className="flex items-center gap-2">
          <Link href="/objects/projects" className="p-1.5 -ml-1 rounded-md text-tertiary hover:bg-surface-hover"><ArrowLeft className="w-4 h-4" /></Link>
          <h1 className="text-sm font-semibold text-primary">{project?.name || 'Project'}</h1>
          {project?.identifier && <span className="text-[11px] font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5">{project.identifier}</span>}
          {project?.status && <span className={`text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ring-1 ${STATUS_TONE[project.status] || STATUS_TONE.active}`}>{project.status}</span>}
          <span className={`ml-1 text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>{live ? 'Live' : 'Sample'}</span>
          <button className="ml-auto h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm"><Plus className="w-3.5 h-3.5" /> New issue</button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <>
            <div className="shrink-0 grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
              {stats.map((s) => (
                <div key={s.label} className="rounded-xl bg-surface ring-1 ring-subtle shadow-card p-3">
                  <s.icon className={`w-4 h-4 ${s.tone}`} />
                  <div className="mt-2 text-2xl font-semibold text-primary tabular-nums">{s.value}</div>
                  <div className="text-[12px] font-medium text-tertiary">{s.label}</div>
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
