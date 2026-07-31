'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Waypoints, Plus, Loader2, Trash2, AlertCircle } from 'lucide-react';
import { getWorkspace, type WorkspaceContext } from '@/lib/crm/data';
import { loadMindMaps, createMindMap, deleteMindMap, type MindMapSummary } from '@/lib/crm/mindmaps';
import { useDialog } from '@/components/ui/Dialog';
import EmptyState from '@/components/ui/EmptyState';
import ListRow, { RowTile } from '@/components/ui/ListRow';
import SectionCard from '@/components/ui/SectionCard';

const when = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

export default function MapsPage() {
  const { confirm: confirmDialog, notify } = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const router = useRouter();

  const [ws, setWs] = useState<WorkspaceContext | null>(null);
  const [maps, setMaps] = useState<MindMapSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!privy) { setLoading(false); return; }
    const w = await getWorkspace(privy);
    setWs(w);
    if (w) {
      const { maps: rows, error: err } = await loadMindMaps(privy, w.id);
      setMaps(rows);
      setError(err || '');
    }
    setLoading(false);
  }, [privy]);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  const create = async () => {
    if (!privy || !ws) return;
    setCreating(true);
    const { id, error: err } = await createMindMap(privy, ws.id);
    setCreating(false);
    if (err || !id) { setError(err || 'Could not create the map.'); return; }
    // Straight into the canvas: a new map is empty, so a list row for it is a
    // click nobody wants.
    router.push(`/maps/${id}`);
  };

  const remove = async (m: MindMapSummary) => {
    if (!privy) return;
    if (!await confirmDialog({
      title: `Delete “${m.title}”?`,
      body: 'The canvas and everything on it is removed permanently.',
      danger: true, confirmLabel: 'Delete',
    })) return;
    const { error: err } = await deleteMindMap(privy, m.id);
    if (err) { notify({ title: 'Could not delete', body: err }); return; }
    load();
  };

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 px-5 lg:px-7">
        <h1 className="text-md font-medium text-primary">Maps</h1>
        <span className="text-2xs font-medium text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{maps.length}</span>
        {privy && ws && (
          <button onClick={create} disabled={creating}
            className="ml-auto h-10 px-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-inverse-fg bg-inverse shadow-sm hover:opacity-90 disabled:opacity-50 transition-opacity">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} New map
          </button>
        )}
      </header>

      <div className="flex-1 overflow-auto p-5 sm:p-6 2xl:p-8">
        <div className="max-w-5xl space-y-4">
          <p className="text-sm text-secondary -mt-1">
            Free-form canvases for thinking out loud — drag boxes around, connect them, and it saves as you go.
          </p>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-danger/10 text-danger px-3 py-2 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" /> <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="h-32 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : !privy ? (
            <EmptyState icon={Waypoints} title="Sign in to see your maps" />
          ) : maps.length === 0 ? (
            <EmptyState
              icon={Waypoints}
              title="No maps yet"
              description="Sketch a launch plan, an org chart, or how a process actually works."
              action={
                <button onClick={create} className="h-10 px-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-inverse-fg bg-inverse shadow-sm">
                  <Plus className="w-4 h-4" /> New map
                </button>
              }
            />
          ) : (
            <SectionCard flush>
              <div className="divide-y divide-subtle">
                {maps.map((m) => (
                  <ListRow
                    key={m.id}
                    href={`/maps/${m.id}`}
                    leading={<RowTile><Waypoints className="w-4 h-4" /></RowTile>}
                    title={m.title}
                    sub={`${m.node_count} ${m.node_count === 1 ? 'box' : 'boxes'} · ${m.edge_count} ${m.edge_count === 1 ? 'link' : 'links'} · ${when(m.updated_at)}`}
                    trailing={
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); remove(m); }}
                        aria-label={`Delete ${m.title}`}
                        className="h-8 w-8 inline-flex items-center justify-center rounded-md text-tertiary hover:text-danger hover:bg-surface-hover transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    }
                  />
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </>
  );
}
