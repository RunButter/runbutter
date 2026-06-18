import { notFound } from 'next/navigation';
import { Plus, Search, SlidersHorizontal, LayoutGrid } from 'lucide-react';
import { OBJECTS } from '@/lib/crm/registry';
import { MOCK_OBJECT_ROWS } from '@/lib/crm/mock';
import RecordTable from '@/components/crm/RecordTable';

export default function ObjectPage({ params }: { params: { object: string } }) {
  const object = OBJECTS[params.object];
  if (!object) return notFound();
  const rows = MOCK_OBJECT_ROWS[params.object] || [];

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200/70">
        <h1 className="text-sm font-bold text-slate-800">{object.plural}</h1>
        <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 rounded-md px-1.5 py-0.5 tabular-nums">{rows.length}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-slate-500 hover:bg-slate-100 transition-colors"><Search className="w-3.5 h-3.5" /> Search</button>
          <button className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-slate-500 hover:bg-slate-100 transition-colors"><SlidersHorizontal className="w-3.5 h-3.5" /> Filter</button>
          <button className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 transition-colors"><LayoutGrid className="w-3.5 h-3.5" /></button>
          <button className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-bold text-white bg-primary-600 hover:bg-primary-700 transition-colors shadow-sm"><Plus className="w-3.5 h-3.5" /> New</button>
        </div>
      </header>
      <div className="flex-1 overflow-auto">
        <RecordTable object={object} rows={rows} />
      </div>
    </>
  );
}
