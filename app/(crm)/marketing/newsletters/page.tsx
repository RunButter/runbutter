'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Plus, Loader2, Mail, Users, Clock, Ban, Trash2, Upload, X, Check, Filter, GitBranch } from 'lucide-react';
import { getWorkspace, type WorkspaceContext } from '@/lib/crm/data';
import {
  listNewsletterLists, saveNewsletterList, deleteNewsletterList,
  listSubscribers, addSubscriber, setSubscriberStatus, deleteSubscriber,
  listNewsletters, saveNewsletter, deleteNewsletter, cancelNewsletter,
  parseSubscriberPaste,
  type NewsletterList, type Subscriber, type NewsletterRow,
} from '@/lib/crm/newsletters';
import {
  listSegments, deleteSegment, getScoringConfig, saveScoringConfig, SCORING_KINDS,
  type Segment, type ScoringConfig,
} from '@/lib/crm/segments';
import SegmentBuilder from '@/components/crm/SegmentBuilder';
import { listSequences, setSequenceEnabled, deleteSequence, sequenceLengthDays, type Sequence } from '@/lib/crm/sequences';
import SequenceBuilder from '@/components/crm/SequenceBuilder';
import PageHeader from '@/components/dashboard/PageHeader';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { useDialog } from '@/components/ui/Dialog';
import AppLoading from '@/components/ui/AppLoading';

const STATUS_TONE: Record<string, 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral', scheduled: 'warning', sending: 'warning',
  sent: 'success', paused: 'neutral', cancelled: 'danger',
};
const SUB_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  enabled: 'success', unconfirmed: 'warning', unsubscribed: 'neutral',
  bounced: 'danger', complained: 'danger',
};

export default function NewslettersPage() {
  const router = useRouter();
  const { confirm: confirmDialog, notify } = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [ws, setWs] = useState<WorkspaceContext | null>(null);
  const [tab, setTab] = useState<'sends' | 'lists' | 'segments' | 'sequences'>('sends');
  const [rows, setRows] = useState<NewsletterRow[]>([]);
  const [lists, setLists] = useState<NewsletterList[]>([]);
  const [loading, setLoading] = useState(true);
  const [openList, setOpenList] = useState<NewsletterList | null>(null);
  const [importing, setImporting] = useState<NewsletterList | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [editingSeg, setEditingSeg] = useState<Partial<Segment> | null>(null);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [editingSeq, setEditingSeq] = useState<Partial<Sequence> | null>(null);

  const reload = useCallback(async (w: WorkspaceContext, p: string) => {
    const [n, l, g, q] = await Promise.all([
      listNewsletters(p, w.id), listNewsletterLists(p, w.id), listSegments(p, w.id), listSequences(p, w.id),
    ]);
    setRows(n); setLists(l); setSegments(g); setSequences(q); setLoading(false);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!privy) { setLoading(false); return; }
    getWorkspace(privy).then((w) => { if (w) { setWs(w); reload(w, privy); } else setLoading(false); });
  }, [ready, privy, reload]);

  const refresh = () => { if (ws && privy) reload(ws, privy); };

  const create = async () => {
    if (!ws || !privy) return;
    const { id, error } = await saveNewsletter(privy, ws.id, { subject: '', template: 'plain', content: {}, list_ids: [] });
    if (error) return notify(error);
    if (id) router.push(`/marketing/newsletters/${id}`);
  };

  const newList = async () => {
    if (!ws || !privy) return;
    await saveNewsletterList(privy, ws.id, { name: 'New list', opt_in: 'single' });
    refresh();
  };

  if (!ready || loading) {
    return <AppLoading />;
  }

  const totalSubs = lists.reduce((a, l) => a + (l.subscriber_count || 0), 0);

  return (
    <>
      <PageHeader
        title="Newsletters"
        subtitle={`${rows.length} send${rows.length === 1 ? '' : 's'} · ${totalSubs} subscriber${totalSubs === 1 ? '' : 's'}`}
      >
        {tab === 'sends' ? (
          <Button size="sm" variant="primary" onClick={create} disabled={!privy}><Plus className="w-3.5 h-3.5" /> New newsletter</Button>
        ) : tab === 'lists' ? (
          <Button size="sm" variant="primary" onClick={newList} disabled={!privy}><Plus className="w-3.5 h-3.5" /> New list</Button>
        ) : tab === 'segments' ? (
          <Button size="sm" variant="primary" onClick={() => setEditingSeg({ name: 'New segment', filters: [] })} disabled={!privy}>
            <Plus className="w-3.5 h-3.5" /> New segment
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => setEditingSeq({ name: 'New sequence', steps: [] })} disabled={!privy}>
            <Plus className="w-3.5 h-3.5" /> New sequence
          </Button>
        )}
      </PageHeader>

      <div className="flex-1 overflow-auto px-5 lg:px-7 pb-8">
        <div className="max-w-5xl">
          {!privy && (
            <div className="rounded-xl bg-surface shadow-card p-4 text-sm text-secondary mb-4">Sign in to manage newsletters.</div>
          )}

          <div className="inline-flex items-center rounded-lg bg-surface-hover p-0.5 mb-4">
            {([['sends', 'Sends', Mail], ['lists', 'Lists', Users], ['segments', 'Segments', Filter], ['sequences', 'Sequences', GitBranch]] as const).map(([v, label, Icon]) => (
              <button key={v} onClick={() => setTab(v)} aria-pressed={tab === v}
                className={`h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-xs font-medium transition-colors ${
                  tab === v ? 'bg-surface text-primary shadow-sm' : 'text-tertiary hover:text-secondary'}`}>
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          {tab === 'sends' ? (
            rows.length === 0 ? (
              <Empty icon={Mail} text="No newsletters yet." hint="Create one, pick a list, and it goes out on the next cron tick." />
            ) : (
              <div className="rounded-xl bg-surface shadow-card divide-y divide-subtle overflow-hidden">
                {rows.map((n) => (
                  <div key={n.id} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover transition-colors">
                    <button onClick={() => router.push(`/marketing/newsletters/${n.id}`)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-primary truncate">{n.subject || 'Untitled newsletter'}</span>
                        <Badge tone={STATUS_TONE[n.status] || 'neutral'}>{n.status}</Badge>
                      </div>
                      <div className="text-2xs text-tertiary mt-0.5 flex items-center gap-3">
                        <span className="capitalize">{n.template}</span>
                        {n.status === 'scheduled' && n.scheduled_at && (
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(n.scheduled_at).toLocaleString()}</span>
                        )}
                        {/* Stats appear only once something has actually gone out.
                            A row of zeroes on a draft reads as a failed send. */}
                        {n.sent_count > 0 && (
                          <span>{n.sent_count} sent · {n.open_count} opened · {n.click_count} clicked</span>
                        )}
                      </div>
                    </button>
                    {(n.status === 'scheduled' || n.status === 'sending') && (
                      <Button size="sm" variant="ghost" onClick={async () => {
                        if (ws && privy && await confirmDialog(`Stop sending "${n.subject || 'this newsletter'}"? Messages already delivered cannot be recalled.`)) {
                          await cancelNewsletter(privy, ws.id, n.id); refresh();
                        }
                      }}><Ban className="w-3.5 h-3.5" /></Button>
                    )}
                    {n.status === 'draft' && (
                      <Button size="sm" variant="ghost" onClick={async () => {
                        if (ws && privy && await confirmDialog(`Delete "${n.subject || 'this draft'}"?`)) {
                          const { error } = await deleteNewsletter(privy, ws.id, n.id);
                          if (error) notify(error); else refresh();
                        }
                      }}><Trash2 className="w-3.5 h-3.5 text-danger" /></Button>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : tab === 'sequences' ? (
            sequences.length === 0 ? (
              <Empty icon={GitBranch} text="No sequences yet."
                hint="A drip: email, wait three days, email again — running per subscriber." />
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {sequences.map((q) => (
                  <div key={q.id} className="rounded-xl bg-surface shadow-card p-4 flex flex-col">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-primary truncate flex-1">{q.name}</h3>
                      <Badge tone={q.enabled ? 'success' : 'neutral'}>{q.enabled ? 'on' : 'off'}</Badge>
                    </div>
                    <p className="text-2xs text-tertiary mt-1">
                      {q.steps.length} step{q.steps.length === 1 ? '' : 's'} · {sequenceLengthDays(q.steps)} days
                    </p>
                    <p className="text-2xs text-tertiary mt-0.5">
                      {q.active_count} in progress · {q.completed_count} finished
                    </p>
                    <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-subtle">
                      <Button size="sm" variant="ghost" onClick={() => setEditingSeq(q)}>Open</Button>
                      <label className="flex items-center gap-1.5 text-2xs text-tertiary cursor-pointer select-none">
                        <input type="checkbox" checked={q.enabled} className="rounded border-strong accent-accent"
                          onChange={(e) => ws && privy && setSequenceEnabled(privy, ws.id, q.id, e.target.checked).then(refresh)} />
                        on
                      </label>
                      <button
                        onClick={async () => {
                          if (ws && privy && await confirmDialog(`Delete sequence "${q.name}"? Anyone partway through stops receiving it.`)) {
                            await deleteSequence(privy, ws.id, q.id); refresh();
                          }
                        }}
                        className="ml-auto p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><Trash2 className="w-3.5 h-3.5 text-danger" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : tab === 'segments' ? (
            <>
            {ws && privy && <ScoringPanel ws={ws.id} privy={privy} />}
            {segments.length === 0 ? (
              <Empty icon={Filter} text="No segments yet."
                hint="A list is who you added. A segment is who currently matches — 'opened nothing in 90 days'." />
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {segments.map((g) => (
                  <div key={g.id} className="rounded-xl bg-surface shadow-card p-4 flex flex-col">
                    <h3 className="text-sm font-medium text-primary truncate">{g.name}</h3>
                    <p className="text-2xs text-tertiary mt-1">
                      {g.filters.length === 0 ? 'Every subscriber' : `${g.filters.length} condition${g.filters.length === 1 ? '' : 's'}`}
                    </p>
                    <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-subtle">
                      <Button size="sm" variant="ghost" onClick={() => setEditingSeg(g)}>Open</Button>
                      <button
                        onClick={async () => {
                          if (ws && privy && await confirmDialog(`Delete segment "${g.name}"? Subscribers are not affected.`)) {
                            await deleteSegment(privy, ws.id, g.id); refresh();
                          }
                        }}
                        className="ml-auto p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><Trash2 className="w-3.5 h-3.5 text-danger" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            </>
          ) : lists.length === 0 ? (
            <Empty icon={Users} text="No lists yet." hint="A list is who a newsletter goes to." />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {lists.map((l) => (
                <div key={l.id} className="rounded-xl bg-surface shadow-card p-4 flex flex-col">
                  <input
                    defaultValue={l.name}
                    onBlur={(e) => { if (ws && privy && e.target.value !== l.name) saveNewsletterList(privy, ws.id, { ...l, name: e.target.value }).then(refresh); }}
                    className="text-sm font-medium text-primary bg-transparent outline-none focus:bg-surface-hover rounded px-1 -mx-1"
                  />
                  <p className="text-2xs text-tertiary mt-1">
                    {l.subscriber_count} mailable · {l.opt_in === 'double' ? 'double opt-in' : 'single opt-in'}
                  </p>
                  <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-subtle">
                    <Button size="sm" variant="ghost" onClick={() => setOpenList(l)}>View</Button>
                    <Button size="sm" variant="ghost" onClick={() => setImporting(l)}><Upload className="w-3.5 h-3.5" /> Add</Button>
                    <button
                      onClick={async () => {
                        if (ws && privy && await confirmDialog(`Delete list "${l.name}"? Subscribers stay in the workspace; only the list goes.`)) {
                          await deleteNewsletterList(privy, ws.id, l.id); refresh();
                        }
                      }}
                      className="ml-auto p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><Trash2 className="w-3.5 h-3.5 text-danger" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {openList && ws && privy && (
        <SubscribersModal list={openList} ws={ws.id} privy={privy} onClose={() => { setOpenList(null); refresh(); }} />
      )}
      {importing && ws && privy && (
        <ImportModal list={importing} ws={ws.id} privy={privy} onClose={() => { setImporting(null); refresh(); }} />
      )}
      {editingSeq && ws && privy && (
        <SequenceBuilder initial={editingSeq} lists={lists} segments={segments} newsletters={rows}
          ws={ws.id} privy={privy}
          onClose={() => setEditingSeq(null)} onSaved={() => { setEditingSeq(null); refresh(); }} />
      )}
      {editingSeg && ws && privy && (
        <SegmentBuilder initial={editingSeg} lists={lists} ws={ws.id} privy={privy}
          onClose={() => setEditingSeg(null)}
          onSaved={() => { setEditingSeg(null); refresh(); }} />
      )}
    </>
  );
}

function Empty({ icon: Icon, text, hint }: { icon: any; text: string; hint: string }) {
  return (
    <div className="rounded-xl border border-dashed border-subtle p-10 text-center">
      <Icon className="w-5 h-5 text-tertiary mx-auto mb-2" />
      <p className="text-sm text-secondary">{text}</p>
      <p className="text-xs text-tertiary mt-1">{hint}</p>
    </div>
  );
}

function SubscribersModal({ list, ws, privy, onClose }: { list: NewsletterList; ws: string; privy: string; onClose: () => void }) {
  const { confirm: confirmDialog } = useDialog();
  const [rows, setRows] = useState<Subscriber[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(true);
  const PER = 25;

  const load = useCallback(async () => {
    setBusy(true);
    const r = await listSubscribers(privy, ws, { list: list.id, query: q, limit: PER, offset: page * PER });
    setRows(r.rows); setTotal(r.total); setBusy(false);
  }, [privy, ws, list.id, q, page]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-popover" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-subtle">
          <h3 className="text-sm font-medium text-primary flex-1 truncate">{list.name}</h3>
          <span className="text-2xs text-tertiary tabular-nums">{total}</span>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-3 border-b border-subtle">
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} className="input-field" placeholder="Search email or name" />
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-subtle">
          {busy ? (
            <div className="p-8 flex justify-center text-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-tertiary">No subscribers here yet.</p>
          ) : rows.map((s) => (
            <div key={s.id} className="flex items-center gap-2 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-primary truncate">{s.email}</div>
                <div className="text-3xs text-tertiary truncate">
                  {s.name || '—'} · {s.consent_source || 'unknown source'}
                  {/* Only when scoring has actually run. A "0" on every row
                      before anyone enables scoring reads as "nobody engages". */}
                  {s.score > 0 && <span className="text-accent"> · score {s.score}</span>}
                </div>
              </div>
              <Badge tone={SUB_TONE[s.status] || 'neutral'}>{s.status}</Badge>
              {/* No "re-enable" for bounced or complained: the mail system told us
                  to stop, and overriding it is how a sending domain gets blocked. */}
              {s.status === 'enabled' && (
                <button onClick={() => setSubscriberStatus(privy, ws, s.id, 'unsubscribed').then(load)}
                  className="text-3xs text-tertiary hover:text-danger">unsubscribe</button>
              )}
              <button onClick={async () => {
                if (await confirmDialog(`Delete ${s.email}? This removes the consent record too.`)) {
                  await deleteSubscriber(privy, ws, s.id); load();
                }
              }} className="p-1 rounded text-tertiary hover:bg-surface-hover"><Trash2 className="w-3.5 h-3.5 text-danger" /></button>
            </div>
          ))}
        </div>
        {total > PER && (
          <div className="h-12 shrink-0 flex items-center justify-between px-4 border-t border-subtle">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="text-2xs text-tertiary">{page * PER + 1}–{Math.min((page + 1) * PER, total)} of {total}</span>
            <Button size="sm" variant="ghost" disabled={(page + 1) * PER >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ImportModal({ list, ws, privy, onClose }: { list: NewsletterList; ws: string; privy: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ added: number; failed: string[] } | null>(null);
  const parsed = parseSubscriberPaste(text);

  const run = async () => {
    setBusy(true);
    let added = 0; const failed: string[] = [];
    for (const p of parsed) {
      const { error } = await addSubscriber(privy, ws, p.email, p.name, list.id, 'import');
      if (error) failed.push(p.email); else added++;
    }
    setDone({ added, failed }); setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl w-full max-w-lg shadow-popover" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 flex items-center gap-2 px-4 border-b border-subtle">
          <h3 className="text-sm font-medium text-primary flex-1">Add to {list.name}</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          {done ? (
            <div className="rounded-lg bg-surface-sunken p-4 text-sm">
              <p className="text-primary flex items-center gap-1.5"><Check className="w-4 h-4 text-success" />{done.added} added.</p>
              {done.failed.length > 0 && (
                <p className="text-xs text-danger mt-2">{done.failed.length} rejected: {done.failed.slice(0, 5).join(', ')}{done.failed.length > 5 ? '…' : ''}</p>
              )}
            </div>
          ) : (
            <>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9}
                className="input-field !h-auto py-2 resize-y font-mono text-2xs"
                placeholder={'ann@example.com, Ann Smith\nbo@example.com\n"Cy" <cy@example.com>'} />
              <p className="text-2xs text-tertiary">
                Paste a column from a spreadsheet. One per line: an email, optionally with a name.
                A header row is skipped and duplicates are collapsed.
              </p>
              {/* Not decoration — importing into a marketing list without a lawful
                  basis is the actual exposure here, not anything in the code. */}
              <p className="text-2xs text-warning">
                Only add people who agreed to hear from you. Anyone already unsubscribed stays unsubscribed.
              </p>
              {parsed.length > 0 && <p className="text-xs text-secondary">{parsed.length} valid address{parsed.length === 1 ? '' : 'es'} found.</p>}
            </>
          )}
        </div>
        <div className="h-14 flex items-center justify-end gap-2 px-4 border-t border-subtle">
          <Button variant="ghost" onClick={onClose}>{done ? 'Close' : 'Cancel'}</Button>
          {!done && (
            <Button variant="primary" disabled={busy || parsed.length === 0} onClick={run}>
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Add {parsed.length || ''}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Engagement scoring config. Lives beside segments because a score is only
 * useful as something to segment ON — presenting it as its own destination
 * would imply it does something on its own, which it does not.
 */
function ScoringPanel({ ws, privy }: { ws: string; privy: string }) {
  const { notify } = useDialog();
  const [c, setC] = useState<ScoringConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => { getScoringConfig(privy, ws).then(setC); }, [privy, ws]);
  if (!c) return null;

  const save = async (next: ScoringConfig) => {
    setC(next); setSaving(true);
    const { error } = await saveScoringConfig(privy, ws, next);
    setSaving(false);
    if (error) notify(error);
  };

  return (
    <div className="rounded-xl bg-surface shadow-card p-4 mb-3">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 w-full text-left">
        <span className="text-sm font-medium text-primary">Engagement scoring</span>
        <Badge tone={c.enabled ? 'success' : 'neutral'}>{c.enabled ? 'on' : 'off'}</Badge>
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-tertiary" />}
        <span className="ml-auto text-2xs text-tertiary">{open ? 'hide' : 'configure'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <label className="flex items-center gap-2 text-xs text-secondary cursor-pointer">
            <input type="checkbox" checked={c.enabled} className="rounded border-strong accent-accent"
              onChange={(e) => save({ ...c, enabled: e.target.checked })} />
            Score subscribers on how they engage
          </label>

          <div className="flex items-center gap-2">
            <span className="text-xs text-secondary">A signal is worth half after</span>
            <input type="number" min={0} max={3650} value={c.half_life_days}
              onChange={(e) => setC({ ...c, half_life_days: Number(e.target.value) || 0 })}
              onBlur={() => save(c)} className="input-field !h-8 w-20 text-xs" />
            <span className="text-xs text-secondary">days</span>
          </div>
          {/* Explains the one number people set wrong. */}
          <p className="text-2xs text-tertiary">
            Decay is what makes the score answer &ldquo;who is warm now&rdquo; rather than &ldquo;who was ever
            warm&rdquo;. Set 0 for a lifetime total instead.
          </p>

          <div className="space-y-1.5">
            {SCORING_KINDS.map((k) => (
              <div key={k.kind} className="flex items-center gap-2">
                <span className="text-xs text-primary flex-1 min-w-0">
                  {k.label}
                  <span className="text-2xs text-tertiary block">{k.hint}</span>
                </span>
                <input type="number" min={-100} max={100} value={c.rules[k.kind] ?? 0}
                  onChange={(e) => setC({ ...c, rules: { ...c.rules, [k.kind]: Number(e.target.value) || 0 } })}
                  onBlur={() => save(c)} className="input-field !h-8 w-20 text-xs" />
              </div>
            ))}
          </div>

          <p className="text-2xs text-tertiary">
            Scores refresh on the send tick, so a change takes a minute or two to show.
          </p>
        </div>
      )}
    </div>
  );
}
