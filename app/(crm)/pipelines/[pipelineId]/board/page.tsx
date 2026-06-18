'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Plus, Columns3, Table2, Loader2 } from 'lucide-react';
import { MOCK_PIPELINES } from '@/lib/crm/mock';
import { loadBoard } from '@/lib/crm/data';
import PipelineBoard from '@/components/crm/PipelineBoard';
import type { PipelineStage, PipelineRecord } from '@/lib/crm/types';

export default function BoardPage() {
  const params = useParams();
  const slug = String(params.pipelineId);
  const pipeline = MOCK_PIPELINES[slug];

  const { ready, authenticated, user } = usePrivy();
  const [board, setBoard] = useState<{ stages: PipelineStage[]; records: PipelineRecord[] }>({ stages: [], records: [] });
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!pipeline || !ready) return;
    let cancelled = false;
    setLoading(true);
    loadBoard(authenticated && user ? user.id : null, slug, pipeline.kind).then((res) => {
      if (cancelled) return;
      setBoard({ stages: res.stages, records: res.records }); setLive(res.live); setLoading(false);
    });
    return () => { cancelled = true; };
  }, [pipeline, ready, authenticated, user, slug]);

  if (!pipeline) return notFound();

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200/70">
        <h1 className="text-sm font-bold text-slate-800">{pipeline.name}</h1>
        <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 rounded-md px-1.5 py-0.5 tabular-nums">{board.records.length}</span>
        <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
          {live ? 'Live' : 'Sample'}
        </span>
        <div className="ml-1 flex items-center rounded-md ring-1 ring-slate-200/70 overflow-hidden">
          <span className="h-7 px-2 inline-flex items-center gap-1.5 text-[12px] font-semibold bg-white text-slate-800"><Columns3 className="w-3.5 h-3.5" /> Board</span>
          <Link href={`/pipelines/${slug}/table`} className="h-7 px-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-400 hover:bg-slate-50"><Table2 className="w-3.5 h-3.5" /> Table</Link>
        </div>
        <button className="ml-auto h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-bold text-white bg-primary-600 hover:bg-primary-700 transition-colors shadow-sm"><Plus className="w-3.5 h-3.5" /> New</button>
      </header>
      <div className="flex-1 overflow-hidden p-4">
        {loading ? (
          <div className="h-full flex items-center justify-center text-slate-300"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <PipelineBoard key={`${slug}-${live}-${board.records.length}`} stages={board.stages} records={board.records} />
        )}
      </div>
    </>
  );
}
