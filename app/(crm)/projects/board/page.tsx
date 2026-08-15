'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { Plus, Columns3, Table2 } from 'lucide-react';
import { loadIssueBoard } from '@/lib/crm/data';
import PipelineBoard from '@/components/crm/PipelineBoard';
import type { PipelineStage, PipelineRecord } from '@/lib/crm/types';
import DataBadge from '@/components/ui/DataBadge';
import AppLoading from '@/components/ui/AppLoading';
import RecordForm from '@/components/crm/RecordForm';
import { OBJECTS } from '@/lib/crm/registry';

export default function IssueBoardPage() {
  const { ready, authenticated, user } = usePrivy();
  const [board, setBoard] = useState<{ stages: PipelineStage[]; records: PipelineRecord[] }>({ stages: [], records: [] });
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  // New issue used to be a button with no handler — the board could be read and
  // dragged and never added to, the same defect the Deals board had for its
  // whole life. It opens the SAME RecordForm the table uses, so a field added
  // to `issues` in the registry appears here without touching this file.
  const [creating, setCreating] = useState(false);
  const privy = authenticated && user ? user.id : null;

  const load = () => {
    setLoading(true);
    return loadIssueBoard(privy).then((res) => {
      setBoard({ stages: res.stages, records: res.records }); setLive(res.live); setLoading(false);
    });
  };

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
      <header className="h-16 shrink-0 flex items-center gap-3 px-5 lg:px-7">
        <h1 className="text-md font-medium text-primary">Issues</h1>
        <span className="text-2xs font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{board.records.length}</span>
        <DataBadge live={live} />
        <div className="ml-1 flex items-center rounded-md ring-1 ring-subtle overflow-hidden">
          <span className="h-7 px-2 inline-flex items-center gap-1.5 text-xs font-semibold bg-surface text-primary"><Columns3 className="w-3.5 h-3.5" /> Board</span>
          <Link href="/objects/issues" className="h-7 px-2 inline-flex items-center gap-1.5 text-xs font-medium text-tertiary hover:bg-surface-sunken"><Table2 className="w-3.5 h-3.5" /> Table</Link>
        </div>
        <button onClick={() => setCreating(true)} disabled={!privy}
          className="ml-auto h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 transition-colors shadow-sm disabled:opacity-40"><Plus className="w-3.5 h-3.5" /> New issue</button>
      </header>
      <div className="flex-1 overflow-hidden p-4">
        {loading ? (
          <AppLoading />
        ) : (
          <PipelineBoard key={`issues-${live}-${board.records.length}`} stages={board.stages} records={board.records} />
        )}
      </div>
      {creating && privy && (
        <RecordForm object={OBJECTS.issues} privyUserId={privy} recordId={null} initial={{}}
          onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />
      )}
    </>
  );
}
