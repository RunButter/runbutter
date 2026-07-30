'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { Plus, Columns3, Table2, Loader2 } from 'lucide-react';
import { loadIssueBoard } from '@/lib/crm/data';
import PipelineBoard from '@/components/crm/PipelineBoard';
import type { PipelineStage, PipelineRecord } from '@/lib/crm/types';

export default function IssueBoardPage() {
  const { ready, authenticated, user } = usePrivy();
  const [board, setBoard] = useState<{ stages: PipelineStage[]; records: PipelineRecord[] }>({ stages: [], records: [] });
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    loadIssueBoard(authenticated && user ? user.id : null).then((res) => {
      if (cancelled) return;
      setBoard({ stages: res.stages, records: res.records }); setLive(res.live); setLoading(false);
    });
    return () => { cancelled = true; };
  }, [ready, authenticated, user]);

  return (
    <>
      <header className="h-14 shrink-0 flex items-center gap-3 px-5 border-b border-subtle">
        <h1 className="text-sm font-semibold text-primary">Issues</h1>
        <span className="text-2xs font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{board.records.length}</span>
        <span className={`text-3xs font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
          {live ? 'Live' : 'Sample'}
        </span>
        <div className="ml-1 flex items-center rounded-md ring-1 ring-subtle overflow-hidden">
          <span className="h-7 px-2 inline-flex items-center gap-1.5 text-xs font-semibold bg-surface text-primary"><Columns3 className="w-3.5 h-3.5" /> Board</span>
          <Link href="/objects/issues" className="h-7 px-2 inline-flex items-center gap-1.5 text-xs font-medium text-tertiary hover:bg-surface-sunken"><Table2 className="w-3.5 h-3.5" /> Table</Link>
        </div>
        <button className="ml-auto h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 transition-colors shadow-sm"><Plus className="w-3.5 h-3.5" /> New issue</button>
      </header>
      <div className="flex-1 overflow-hidden p-4">
        {loading ? (
          <div className="h-full flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <PipelineBoard key={`issues-${live}-${board.records.length}`} stages={board.stages} records={board.records} />
        )}
      </div>
    </>
  );
}
