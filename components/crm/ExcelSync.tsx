'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Loader2, Trash2, Plus, Search, ArrowRight, ArrowLeft, ArrowLeftRight, AlertTriangle, Power } from 'lucide-react';
import { useDialog } from '@/components/ui/Dialog';
import {
  loadMsConnection, loadExcelLinks, saveExcelLink, setExcelLinkEnabled, deleteExcelLink,
  disconnectMicrosoft, listWorkbooks, syncExcelLink, FEED_OBJECTS,
  type MsConnection, type ExcelLink, type Workbook,
} from '@/lib/crm/automations';
import Thinking from '@/components/ui/Thinking';

/**
 * Two-way Excel sync (0079) — the panel for people whose workbook IS the
 * working surface, as opposed to the read-only feed above it.
 *
 * The direction picker is the whole feature in one control, so it says what
 * each option actually does to the user's file rather than naming a mode.
 */

const DIRECTIONS = [
  { value: 'out' as const, icon: ArrowRight, label: 'RunButter → Excel', hint: 'The sheet mirrors your data. Your edits in Excel are overwritten.' },
  { value: 'in' as const, icon: ArrowLeft, label: 'Excel → RunButter', hint: 'The sheet is the source. Edits there update your records.' },
  { value: 'both' as const, icon: ArrowLeftRight, label: 'Two-way', hint: 'Excel edits are read first, then the sheet is refreshed to match.' },
];

const fmt = (s: string | null) => {
  if (!s) return '';
  const d = new Date(s);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString();
};

export default function ExcelSync({ privy }: { privy: string | null }) {
  const { notify, confirm } = useDialog();
  const [conn, setConn] = useState<MsConnection | null>(null);
  const [links, setLinks] = useState<ExcelLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [files, setFiles] = useState<Workbook[]>([]);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<Workbook | null>(null);
  const [object, setObject] = useState<string>('people');
  const [direction, setDirection] = useState<'out' | 'in' | 'both'>('out');
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!privy) { setLoading(false); return; }
    setLoading(true);
    Promise.all([loadMsConnection(privy), loadExcelLinks(privy)]).then(([c, l]) => {
      setConn(c); setLinks(l); setLoading(false);
    });
  }, [privy]);
  useEffect(() => { reload(); }, [reload]);

  // The OAuth round trip lands back here with ?microsoft=…
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('microsoft');
    if (!p) return;
    window.history.replaceState({}, '', '/settings/integrations');
    if (p === 'connected') reload();
    else if (p === 'notconfigured') notify({ title: 'Microsoft sign-in isn’t set up on this server', body: 'Set MS_CLIENT_ID and MS_CLIENT_SECRET, then try again.' });
    else if (p === 'cancelled') { /* the user clicked Cancel — nothing to say */ }
    else if (p !== 'connected') notify('Couldn’t connect the Microsoft account. Try again.');
  }, [reload, notify]);

  const search = async (term: string) => {
    setSearching(true);
    try { setFiles(await listWorkbooks(term)); }
    catch (e: any) { notify(e?.message || 'Could not list your workbooks.'); }
    finally { setSearching(false); }
  };

  const openPicker = async () => { setPicking(true); setChosen(null); await search(''); };

  const create = async () => {
    if (!privy || !chosen) return;
    setBusy('save');
    const res = await saveExcelLink(privy, {
      object, driveId: chosen.driveId, itemId: chosen.itemId,
      fileName: chosen.name, worksheet: 'RunButter', direction,
    });
    setBusy(null);
    if (res.error) return notify(res.error);
    setPicking(false); setChosen(null);
    reload();
  };

  const runNow = async (l: ExcelLink) => {
    setBusy(l.id);
    try {
      const r = await syncExcelLink(l.id);
      notify(`Synced — ${r.rowsOut} row(s) written to Excel, ${r.rowsIn} change(s) read back.`);
    } catch (e: any) {
      notify(e?.message || 'Sync failed.');
    } finally { setBusy(null); reload(); }
  };

  const remove = async (l: ExcelLink) => {
    if (!privy) return;
    if (!await confirm({ title: 'Stop syncing this sheet?', body: 'Your workbook is left exactly as it is — only the link is removed.' })) return;
    await deleteExcelLink(privy, l.id); reload();
  };

  const toggle = async (l: ExcelLink) => { if (privy) { await setExcelLinkEnabled(privy, l.id, !l.enabled); reload(); } };

  const disconnect = async () => {
    if (!privy) return;
    if (!await confirm({ title: 'Disconnect Microsoft?', body: 'Every linked sheet stops syncing. Your workbooks are not changed.' })) return;
    await disconnectMicrosoft(privy); reload();
  };

  return (
    <section>
      <h2 className="text-base font-medium text-primary mb-1">Two-way Excel sync</h2>
      <p className="text-sm text-secondary mb-3">
        For teams who work in the spreadsheet. Edits in Excel come back into RunButter, and the sheet
        stays up to date — no copy-paste in either direction.
      </p>

      <div className="card-surface overflow-hidden">
        {/* Connection. Stacks on a phone: side by side, the buttons squeezed the
            address down to a single truncated letter. */}
        <div className="px-5 py-4 border-b border-subtle">
          {loading ? (
            <span className="text-sm text-tertiary inline-flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</span>
          ) : conn ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm text-primary truncate">{conn.account_email || 'Microsoft account'}</div>
                  <div className="text-2xs text-tertiary">OneDrive and SharePoint workbooks</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={openPicker} disabled={!privy}
                  className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm disabled:opacity-40">
                  <Plus className="w-3.5 h-3.5" /> Link a sheet
                </button>
                <button onClick={disconnect}
                  className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold ring-1 ring-subtle text-secondary hover:text-danger hover:bg-danger/10">
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-primary">Not connected</div>
                <div className="text-2xs text-tertiary">Sign in with the Microsoft account that owns the workbooks.</div>
              </div>
              <a href="/api/auth/microsoft"
                 className="h-9 px-3 shrink-0 self-start sm:self-auto inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm">
                Connect Microsoft
              </a>
            </div>
          )}
        </div>

        {/* Picker */}
        {picking && (
          <div className="px-5 py-4 border-b border-subtle bg-surface-sunken space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-tertiary absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input value={q} onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') search(q); }}
                  placeholder="Search your workbooks…"
                  className="input-field !h-9 !text-xs !pl-8" />
              </div>
              <button onClick={() => search(q)} className="h-9 px-3 rounded-lg text-sm ring-1 ring-subtle text-secondary hover:bg-surface-hover">
                {searching ? <Thinking kind="searching" label="Searching OneDrive" /> : 'Search'}
              </button>
              <button onClick={() => setPicking(false)} className="h-9 px-3 rounded-lg text-sm text-tertiary hover:text-primary">Cancel</button>
            </div>

            <div className="max-h-52 overflow-auto rounded-lg bg-surface ring-1 ring-subtle divide-y divide-subtle">
              {files.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-tertiary">
                  {searching ? 'Looking…' : 'No .xlsx files found in this account.'}
                </div>
              ) : files.map((f) => (
                <button key={f.itemId} onClick={() => setChosen(f)}
                  className={`w-full text-left px-4 h-11 flex items-center gap-3 hover:bg-surface-hover ${chosen?.itemId === f.itemId ? 'bg-accent/10' : ''}`}>
                  <span className="text-sm text-primary truncate flex-1">{f.name}</span>
                  <span className="text-2xs text-tertiary shrink-0">{fmt(f.lastModified)}</span>
                </button>
              ))}
            </div>

            {chosen && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-3">
                  <label className="block">
                    <span className="text-xs text-secondary block mb-1">What to sync</span>
                    <select value={object} onChange={(e) => setObject(e.target.value)} className="input-field !h-9 !text-xs w-48">
                      {FEED_OBJECTS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  <label className="block flex-1 min-w-[16rem]">
                    <span className="text-xs text-secondary block mb-1">Direction</span>
                    <select value={direction} onChange={(e) => setDirection(e.target.value as any)} className="input-field !h-9 !text-xs w-full">
                      {DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                    </select>
                  </label>
                </div>
                <p className="text-2xs text-tertiary">{DIRECTIONS.find((d) => d.value === direction)?.hint}</p>
                <button onClick={create} disabled={busy === 'save'}
                  className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm disabled:opacity-40">
                  {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Link “{chosen.name}”
                </button>
              </div>
            )}
          </div>
        )}

        {/* Links */}
        {links.length === 0 ? (
          !loading && conn && !picking && (
            <div className="px-5 py-8 text-center text-sm text-tertiary">No sheets linked yet.</div>
          )
        ) : links.map((l) => {
          const D = DIRECTIONS.find((d) => d.value === l.direction) || DIRECTIONS[0];
          return (
            <div key={l.id} className={`px-5 py-3 border-b border-subtle last:border-0 ${l.enabled ? '' : 'opacity-50'}`}>
              {/* Stacks on a phone. Side by side, three buttons left the label
                  a column so narrow the filename wrapped over five lines. */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <D.icon className="w-4 h-4 text-tertiary shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-sm text-primary truncate">
                      {l.file_name || 'Workbook'} <span className="text-tertiary">· {l.worksheet}</span>
                    </div>
                    <div className="text-2xs text-tertiary">
                      {l.object} · {D.label} · {l.last_sync_at ? `synced ${fmt(l.last_sync_at)}` : 'not synced yet'}
                      {l.last_status === 'ok' && (l.last_rows_out > 0 || l.last_rows_in > 0) &&
                        ` · ${l.last_rows_out} out, ${l.last_rows_in} in`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 pl-6 sm:pl-0">
                  <button onClick={() => runNow(l)} disabled={busy === l.id}
                    className="h-7 px-2.5 text-xs font-semibold rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-hover inline-flex items-center gap-1.5 disabled:opacity-40">
                    {/* A sync is two Graph round-trips plus a full inbound and
                        outbound pass — never the sub-second wait a spinner
                        implies. */}
                    {busy === l.id ? <Thinking kind="connecting" label="Syncing with Excel" /> : <RefreshCw className="w-3.5 h-3.5" />} Sync now
                  </button>
                  <button onClick={() => toggle(l)} title={l.enabled ? 'Pause syncing' : 'Resume syncing'}
                    className="h-7 px-2 rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-hover">
                    <Power className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => remove(l)} title="Unlink this sheet"
                    className="h-7 px-2 rounded-md ring-1 ring-subtle text-secondary hover:text-danger hover:bg-danger/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {l.last_status === 'error' && l.last_error && (
                <div className="mt-2 pl-6 text-2xs text-danger flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {l.last_error}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* The rule that protects people, said before they need it — not in a
          tooltip they find after a sync surprised them. */}
      {conn && (
        <p className="text-2xs text-tertiary mt-2">
          Rows you delete in Excel are never deleted here — a filter or a sort looks identical to a
          deletion over the API. Delete records in RunButter instead.
        </p>
      )}
    </section>
  );
}
