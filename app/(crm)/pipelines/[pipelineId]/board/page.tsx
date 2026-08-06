'use client';

import { useCallback, useEffect, useState } from 'react';
import { notFound, useParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Plus, Loader2, X } from 'lucide-react';
import { MOCK_PIPELINES } from '@/lib/crm/mock';
import { loadBoard, loadRecords, createDeal } from '@/lib/crm/data';
import PipelineBoard from '@/components/crm/PipelineBoard';
import SearchSelect, { type SearchOption } from '@/components/crm/SearchSelect';
import type { PipelineStage, PipelineRecord, PipelineKind, ObjectType } from '@/lib/crm/types';
import DataBadge from '@/components/ui/DataBadge';
import AppLoading from '@/components/ui/AppLoading';

/**
 * The board that used to be read-only.
 *
 * The New button here has existed since the screen shipped and never had an
 * onClick — there was no create path in the app OR in SQL, so Sales → Deals was
 * a surface that could not hold a deal. 0092 added create_pipeline_record; this
 * is the form for it.
 *
 * The panel is inline rather than a modal because the stage picker only makes
 * sense next to the columns it names.
 */

export default function BoardPage() {
  const params = useParams();
  const slug = String(params.pipelineId);
  const pipeline = MOCK_PIPELINES[slug];

  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [board, setBoard] = useState<{ stages: PipelineStage[]; records: PipelineRecord[] }>({ stages: [], records: [] });
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!pipeline || !ready) return;
    let cancelled = false;
    loadBoard(privy, slug, pipeline.kind).then((res) => {
      if (cancelled) return;
      setBoard({ stages: res.stages, records: res.records }); setLive(res.live); setLoading(false);
    });
    return () => { cancelled = true; };
  }, [pipeline, ready, privy, slug, reloads]);

  const refresh = useCallback(() => setReloads((n) => n + 1), []);

  if (!pipeline) return notFound();

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 px-5 lg:px-7">
        <h1 className="text-md font-medium text-primary">{pipeline.name}</h1>
        <span className="text-2xs font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{board.records.length}</span>
        <DataBadge live={live} />
        <NewDeal privy={privy} live={live} kind={pipeline.kind} target={pipeline.target}
          stages={board.stages} onCreated={refresh} />
      </header>
      <div className="flex-1 overflow-hidden p-4">
        {loading ? (
          <AppLoading />
        ) : (
          <PipelineBoard key={`${slug}-${live}`} stages={board.stages} records={board.records}
            privy={privy} live={live} onChanged={refresh} />
        )}
      </div>
    </>
  );
}

// ── The create panel ────────────────────────────────────────────────────────

function NewDeal({ privy, live, kind, target, stages, onCreated }: {
  privy: string | null; live: boolean; kind: PipelineKind; target: ObjectType;
  stages: PipelineStage[]; onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [stageId, setStageId] = useState('');
  const [subject, setSubject] = useState('');
  const [options, setOptions] = useState<SearchOption[] | null>(null);

  // Whatever this pipeline is about. Loaded once, when the panel first opens —
  // a contact list nobody asked for is a wasted round trip on every board view.
  useEffect(() => {
    if (!open || options || !privy) return;
    const object = target === 'person' ? 'people' : 'companies';
    loadRecords(privy, object).then((res) => {
      setOptions((res.rows || []).map((r: any) => ({ id: r.id, name: r.name || '—', hint: r.domain || r.email || '' })));
    });
  }, [open, options, privy, target]);

  useEffect(() => { if (open && !stageId && stages[0]) setStageId(stages[0].id); }, [open, stageId, stages]);

  const submit = async () => {
    if (!privy) return;
    setBusy(true); setError('');
    const n = Number(amount.replace(/[^0-9.-]/g, ''));
    const { error } = await createDeal(privy, kind, {
      title: title.trim(),
      amount: amount.trim() && Number.isFinite(n) ? n : null,
      stageId: stageId || null,
      companyId: target === 'company' ? subject || null : null,
      personId: target === 'person' ? subject || null : null,
    });
    setBusy(false);
    if (error) { setError(error); return; }
    setTitle(''); setAmount(''); setSubject(''); setOpen(false);
    onCreated();
  };

  // Sample data is not somewhere you can add a row: the board you are looking
  // at does not exist in the database, so there is nothing to add it to.
  if (!privy || !live) {
    return (
      <span className="ml-auto text-2xs text-tertiary">
        {privy ? 'Sample board — sign-in workspace has no pipeline yet' : 'Sign in to add deals'}
      </span>
    );
  }

  return (
    <div className="ml-auto relative">
      <button onClick={() => setOpen((o) => !o)}
        className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 transition-colors shadow-sm">
        <Plus className="w-3.5 h-3.5" /> New
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-30 w-80 rounded-xl bg-surface ring-1 ring-subtle shadow-popover p-3 space-y-2.5">
          <div className="flex items-center">
            <span className="text-xs font-medium text-primary">New {target === 'person' ? 'candidate' : 'deal'}</span>
            <button onClick={() => setOpen(false)} aria-label="Close"
              className="ml-auto p-1 rounded-md text-tertiary hover:text-primary hover:bg-surface-hover">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <label className="block">
            <span className="block text-2xs text-tertiary mb-1">Name</span>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder={target === 'person' ? 'Senior Engineer' : 'Northwind — platform'}
              className="input-field w-full !h-8 !text-xs" />
          </label>

          <label className="block">
            <span className="block text-2xs text-tertiary mb-1">{target === 'person' ? 'Person' : 'Company'}</span>
            <SearchSelect options={options || []} value={subject} onChange={setSubject}
              allowClear placeholder={options ? 'Search…' : 'Loading…'} />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block min-w-0">
              <span className="block text-2xs text-tertiary mb-1">Stage</span>
              <select value={stageId} onChange={(e) => setStageId(e.target.value)}
                className="input-field w-full !h-8 !text-xs">
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="block min-w-0">
              <span className="block text-2xs text-tertiary mb-1">Amount</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                inputMode="decimal" placeholder="24000" className="input-field w-full !h-8 !text-xs font-mono" />
            </label>
          </div>

          {error && <p className="text-2xs text-danger">{error}</p>}

          <div className="flex items-center gap-2 pt-0.5">
            <button onClick={submit} disabled={busy || (!title.trim() && !subject)}
              className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40 transition-colors">
              {busy && <Loader2 className="w-3 h-3 animate-spin" />} Add
            </button>
            <button onClick={() => setOpen(false)}
              className="h-7 px-2 rounded-md text-xs text-tertiary hover:text-primary">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
