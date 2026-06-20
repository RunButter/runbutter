'use client';

import { useEffect, useState, useCallback } from 'react';
import { notFound, useParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Plus, Search, SlidersHorizontal, Upload, Loader2 } from 'lucide-react';
import { OBJECTS } from '@/lib/crm/registry';
import { loadRecords, getRecord } from '@/lib/crm/data';
import RecordTable from '@/components/crm/RecordTable';
import RecordForm from '@/components/crm/RecordForm';
import ImportModal from '@/components/crm/ImportModal';

export default function ObjectPage() {
  const params = useParams();
  const slug = String(params.object);
  const object = OBJECTS[slug];

  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const canEdit = !!object?.form && !!privy;

  const [rows, setRows] = useState<any[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ id: string | null; initial: any } | null>(null);
  const [importing, setImporting] = useState(false);

  const reload = useCallback(() => {
    if (!object) return;
    setLoading(true);
    loadRecords(privy, slug).then((res) => { setRows(res.rows); setLive(res.live); setLoading(false); });
  }, [object, privy, slug]);

  useEffect(() => { if (object && ready) reload(); }, [object, ready, reload]);

  if (!object) return notFound();

  const openEdit = async (row: any) => {
    if (!canEdit) return;
    const raw = await getRecord(privy!, slug, row.id);
    setForm({ id: row.id, initial: raw || row });
  };

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200/70">
        <h1 className="text-sm font-bold text-slate-800">{object.plural}</h1>
        <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 rounded-md px-1.5 py-0.5 tabular-nums">{rows.length}</span>
        <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{live ? 'Live' : 'Sample'}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-slate-500 hover:bg-slate-100 transition-colors"><Search className="w-3.5 h-3.5" /> Search</button>
          <button className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-slate-500 hover:bg-slate-100 transition-colors"><SlidersHorizontal className="w-3.5 h-3.5" /> Filter</button>
          <button onClick={() => setImporting(true)} disabled={!canEdit}
            className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"><Upload className="w-3.5 h-3.5" /> Import</button>
          <button onClick={() => setForm({ id: null, initial: {} })} disabled={!canEdit}
            title={!object.form ? 'Read-only' : !privy ? 'Sign in to add' : ''}
            className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-bold text-white bg-primary-600 hover:bg-primary-700 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"><Plus className="w-3.5 h-3.5" /> New</button>
        </div>
      </header>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-slate-300"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <RecordTable object={object} rows={rows} onRowClick={canEdit ? openEdit : undefined} />
        )}
      </div>

      {form && (
        <RecordForm
          object={object}
          privyUserId={privy}
          recordId={form.id}
          initial={form.initial}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); reload(); }}
        />
      )}

      {importing && (
        <ImportModal
          object={object}
          privyUserId={privy}
          onClose={() => setImporting(false)}
          onImported={() => { setImporting(false); reload(); }}
        />
      )}
    </>
  );
}
