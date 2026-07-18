'use client';

import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Loader2 } from 'lucide-react';
import { loadRoadmap, type RoadmapProject } from '@/lib/crm/data';
import RoadmapTimeline from '@/components/crm/RoadmapTimeline';

const PRIORITY: [string, string][] = [
  ['Urgent', '#f43f5e'], ['High', '#f59e0b'], ['Medium', '#3b82f6'], ['Low', '#94a3b8'],
];

export default function RoadmapPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const [projects, setProjects] = useState<RoadmapProject[] | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!ready) return;
    loadRoadmap(privy).then((r) => { setProjects(r.projects); setLive(r.live); });
  }, [ready, privy]);

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-subtle">
        <h1 className="text-sm font-semibold text-primary">Roadmap</h1>
        <span className={`text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
          {live ? 'Live' : 'Sample'}
        </span>
        <div className="ml-auto hidden sm:flex items-center gap-3 text-[11px] font-semibold">
          {PRIORITY.map(([label, color]) => (
            <span key={label} className="inline-flex items-center gap-1.5 text-secondary">
              <span className="w-2 h-2 rounded-full" style={{ background: color }} /> {label}
            </span>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {!projects ? (
          <div className="h-40 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : projects.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-sm text-tertiary">No projects yet. Create one to see it on the roadmap.</div>
        ) : (
          <div className="max-w-6xl rounded-xl bg-surface ring-1 ring-subtle overflow-x-auto">
            <RoadmapTimeline projects={projects} />
          </div>
        )}
      </div>
    </>
  );
}
