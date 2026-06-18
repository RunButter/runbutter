import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Plus, Columns3, Table2 } from 'lucide-react';
import { MOCK_PIPELINES, mockBoard } from '@/lib/crm/mock';
import PipelineBoard from '@/components/crm/PipelineBoard';

export default function BoardPage({ params }: { params: { pipelineId: string } }) {
  const pipeline = MOCK_PIPELINES[params.pipelineId];
  if (!pipeline) return notFound();
  const { stages, records } = mockBoard(params.pipelineId);

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200/70">
        <h1 className="text-sm font-bold text-slate-800">{pipeline.name}</h1>
        <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 rounded-md px-1.5 py-0.5 tabular-nums">{records.length}</span>
        <div className="ml-1 flex items-center rounded-md ring-1 ring-slate-200/70 overflow-hidden">
          <span className="h-7 px-2 inline-flex items-center gap-1.5 text-[12px] font-semibold bg-white text-slate-800"><Columns3 className="w-3.5 h-3.5" /> Board</span>
          <Link href={`/pipelines/${params.pipelineId}/table`} className="h-7 px-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-400 hover:bg-slate-50"><Table2 className="w-3.5 h-3.5" /> Table</Link>
        </div>
        <button className="ml-auto h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-bold text-white bg-primary-600 hover:bg-primary-700 transition-colors shadow-sm"><Plus className="w-3.5 h-3.5" /> New</button>
      </header>
      <div className="flex-1 overflow-hidden p-4">
        <PipelineBoard stages={stages} records={records} />
      </div>
    </>
  );
}
