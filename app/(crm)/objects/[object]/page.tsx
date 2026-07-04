'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { notFound, useParams, useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Plus, Search, Upload, Download, Loader2, FileText } from 'lucide-react';
import { OBJECTS } from '@/lib/crm/registry';
import { loadRecords, getRecord, createRecord, deleteRecord } from '@/lib/crm/data';
import { toCSV, downloadCSV } from '@/lib/crm/csv';
import RecordTable from '@/components/crm/RecordTable';
import RecordForm from '@/components/crm/RecordForm';
import RecordDetail from '@/components/crm/RecordDetail';
import ImportModal from '@/components/crm/ImportModal';
import FilterBar, { EMPTY_FILTERS, type FilterState } from '@/components/crm/FilterBar';
import InvoiceItemsModal from '@/components/crm/InvoiceItemsModal';
import { Package } from 'lucide-react';

export default function ObjectPage() {
  const params = useParams();
  const router = useRouter();
  const slug = String(params.object);
  const object = OBJECTS[slug];

  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const canEdit = !!object?.form && !!privy;

  const [rows, setRows] = useState<any[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<{ id: string | null; initial: any } | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [importing, setImporting] = useState(false);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [itemsFor, setItemsFor] = useState<string | null>(null);   // invoice/offer id whose line items are being edited
  const isDoc = slug === 'invoices' || slug === 'offers';

  const reload = useCallback(() => {
    if (!object) return;
    setLoading(true);
    loadRecords(privy, slug).then((res) => { setRows(res.rows); setLive(res.live); setLoading(false); });
  }, [object, privy, slug]);

  useEffect(() => { if (object && ready) reload(); }, [object, ready, reload]);
  useEffect(() => { setFilters(EMPTY_FILTERS); setQuery(''); }, [slug]); // reset when switching objects

  const dateKey = useMemo(() => object?.fields.find((f) => f.type === 'date')?.key, [object]);

  // Client-side facets + date range + free-text search.
  const filtered = useMemo(() => {
    let out = rows;
    const fac = filters.facets;
    const facKeys = Object.keys(fac).filter((k) => fac[k]);
    if (facKeys.length) out = out.filter((r) => facKeys.every((k) => String(r[k] ?? '') === fac[k]));
    if (dateKey && (filters.from || filters.to)) {
      out = out.filter((r) => {
        const d = r[dateKey]; if (!d) return false;
        const ds = String(d).slice(0, 10);
        if (filters.from && ds < filters.from) return false;
        if (filters.to && ds > filters.to) return false;
        return true;
      });
    }
    const q = query.trim().toLowerCase();
    if (q) out = out.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q)));
    return out;
  }, [rows, query, filters, dateKey]);

  // Autocomplete suggestions for datalist fields (e.g. custom invoice categories).
  const suggestions = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const f of object?.form || []) {
      if (f.input === 'datalist') out[f.key] = Array.from(new Set(rows.map((r) => r[f.key]).filter(Boolean))) as string[];
    }
    return out;
  }, [rows, object]);

  if (!object) return notFound();

  const openEditFromDetail = async () => {
    if (!canEdit || !detail) return;
    const raw = await getRecord(privy!, slug, detail.id);
    setForm({ id: detail.id, initial: raw || detail });
    setDetail(null);
  };

  // Invoices/offers create a draft and open the editable builder; everything
  // else opens the standard form.
  const newRecord = async () => {
    if (isDoc && privy) {
      const res = await createRecord(privy, slug, {});
      if (res.id) { router.push(`/documents/${res.id}/edit`); return; }
    }
    setForm({ id: null, initial: {} });
  };

  // Bulk actions from the table's floating bar.
  const deleteSelected = async (ids: string[]) => {
    if (!privy) return;
    const results = await Promise.all(ids.map((id) => deleteRecord(privy, slug, id)));
    reload();
    const failed = results.filter((r) => r.error);
    if (failed.length) alert(failed[0].error?.includes('FORBIDDEN') ? 'Deleting requires an owner/admin role.' : `${failed.length} could not be deleted.`);
  };

  const exportSelected = (sel: any[]) => {
    const cols = object!.fields;
    const csv = toCSV(cols.map((c) => c.label), sel.map((r) => cols.map((c) => r[c.key])));
    downloadCSV(`${object!.slug}-selection-${new Date().toISOString().slice(0, 10)}`, csv);
  };

  const exportCsv = () => {
    const cols = object.fields;
    const csv = toCSV(cols.map((c) => c.label), filtered.map((r) => cols.map((c) => r[c.key])));
    downloadCSV(`${object.slug}-${new Date().toISOString().slice(0, 10)}`, csv);
  };

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200/70">
        <h1 className="text-sm font-bold text-slate-800">{object.plural}</h1>
        <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 rounded-md px-1.5 py-0.5 tabular-nums">{filtered.length}</span>
        <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{live ? 'Live' : 'Sample'}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…"
              className="h-7 w-44 pl-7 pr-2 text-[12px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none" />
          </div>
          <button onClick={exportCsv} disabled={filtered.length === 0}
            className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"><Download className="w-3.5 h-3.5" /> Export</button>
          <button onClick={() => setImporting(true)} disabled={!canEdit}
            className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"><Upload className="w-3.5 h-3.5" /> Import</button>
          <button onClick={newRecord} disabled={!canEdit}
            title={!object.form ? 'Read-only' : !privy ? 'Sign in to add' : ''}
            className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-bold text-white bg-primary-600 hover:bg-primary-700 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"><Plus className="w-3.5 h-3.5" /> New</button>
        </div>
      </header>

      <FilterBar object={object} rows={rows} value={filters} onChange={setFilters} />

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-slate-300"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <RecordTable object={object} rows={filtered}
            onRowClick={(r) => (slug === 'projects' ? router.push(`/projects/${r.id}`) : setDetail(r))}
            canDelete={canEdit} onDeleteSelected={deleteSelected} onExportSelected={exportSelected} />
        )}
      </div>

      {detail && (
        <RecordDetail object={object} row={detail} canEdit={canEdit} onEdit={openEditFromDetail} onClose={() => setDetail(null)}
          extraActions={isDoc ? (
            <>
              <button onClick={() => setItemsFor(detail.id)} disabled={!privy} title={!privy ? 'Sign in' : ''}
                className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-[12px] font-semibold text-primary-700 hover:bg-primary-50 disabled:opacity-40 disabled:cursor-not-allowed"><Package className="w-3.5 h-3.5" /> Products</button>
              <button onClick={() => router.push(`/documents/${detail.id}`)}
                className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-[12px] font-semibold text-primary-700 hover:bg-primary-50"><FileText className="w-3.5 h-3.5" /> Document</button>
            </>
          ) : undefined} />
      )}
      {form && (
        <RecordForm object={object} privyUserId={privy} recordId={form.id} initial={form.initial} suggestions={suggestions}
          onClose={() => setForm(null)} onSaved={(newId) => { setForm(null); reload(); if (newId && isDoc) setItemsFor(newId); }} />
      )}
      {importing && (
        <ImportModal object={object} privyUserId={privy} onClose={() => setImporting(false)} onImported={() => { setImporting(false); reload(); }} />
      )}
      {itemsFor && privy && (
        <InvoiceItemsModal privyUserId={privy} invoiceId={itemsFor} onClose={() => setItemsFor(null)} onSaved={() => { setItemsFor(null); reload(); }} />
      )}
    </>
  );
}
