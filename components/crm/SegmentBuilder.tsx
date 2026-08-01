'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Trash2, X, Users, ArrowRight } from 'lucide-react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import {
  SEGMENT_FIELDS, SUBSCRIBER_STATUSES, inputFor, previewSegment, saveSegment, syncSegmentToList,
  type Segment, type SegmentFilter, type SegmentPreviewRow,
} from '@/lib/crm/segments';
import type { NewsletterList } from '@/lib/crm/newsletters';
import { useDialog } from '@/components/ui/Dialog';

/**
 * Build a segment and see who it matches, live.
 *
 * The live count is the whole feature. A filter builder that only tells you the
 * result after saving is guesswork, and the specific guess people get wrong is
 * an over-broad filter — which, once synced to a list, mails the wrong people.
 * So every edit re-evaluates against the real subscriber table (debounced), and
 * the count sits next to the conditions that produced it.
 */
export default function SegmentBuilder({
  initial, lists, ws, privy, onClose, onSaved,
}: {
  initial: Partial<Segment>; lists: NewsletterList[]; ws: string; privy: string;
  onClose: () => void; onSaved: () => void;
}) {
  const { notify } = useDialog();
  const [name, setName] = useState(initial.name || 'New segment');
  const [filters, setFilters] = useState<SegmentFilter[]>(initial.filters || []);
  const [preview, setPreview] = useState<{ rows: SegmentPreviewRow[]; total: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncList, setSyncList] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback((f: SegmentFilter[]) => {
    if (timer.current) clearTimeout(timer.current);
    // Debounced: this hits the real table on every keystroke otherwise, and a
    // "contains" filter is retyped a character at a time.
    timer.current = setTimeout(async () => {
      setPreviewing(true);
      setPreview(await previewSegment(privy, ws, f, 8));
      setPreviewing(false);
    }, 450);
  }, [privy, ws]);

  useEffect(() => { run(filters); }, [filters, run]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const patch = (i: number, p: Partial<SegmentFilter>) =>
    setFilters((fs) => fs.map((f, j) => (j === i ? { ...f, ...p } : f)));

  const addFilter = () => setFilters((fs) => [...fs, { field: 'status', op: 'eq', value: 'enabled' }]);

  const save = async () => {
    setSaving(true);
    const { error } = await saveSegment(privy, ws, { id: initial.id, name, filters });
    setSaving(false);
    if (error) return notify(error);
    onSaved();
  };

  const sync = async () => {
    if (!initial.id) return notify('Save the segment before syncing it to a list.');
    if (!syncList) return;
    const { added, error } = await syncSegmentToList(privy, ws, initial.id, syncList);
    if (error) return notify(error);
    notify(`${added} subscriber${added === 1 ? '' : 's'} added to the list. Existing members were left alone.`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-popover" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-subtle">
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="text-sm font-medium text-primary bg-transparent outline-none flex-1 focus:bg-surface-hover rounded px-1 -mx-1" />
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-secondary">
                Subscribers matching <span className="text-tertiary">all</span> of:
              </span>
              <Button size="sm" variant="ghost" onClick={addFilter}><Plus className="w-3.5 h-3.5" /> Condition</Button>
            </div>

            {filters.length === 0 ? (
              <p className="text-xs text-tertiary rounded-lg border border-dashed border-subtle p-4 text-center">
                No conditions — this matches every subscriber.
              </p>
            ) : (
              <div className="space-y-1.5">
                {filters.map((f, i) => {
                  const fieldDef = SEGMENT_FIELDS.find((x) => x.field === f.field);
                  const input = inputFor(f.field, f.op);
                  return (
                    <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-subtle p-2">
                      <select value={f.field} className="input-field !h-8 !w-auto text-xs"
                        onChange={(e) => {
                          // Reset the operator too: the previous one almost
                          // certainly does not exist on the new field, and SQL
                          // fails closed on an unknown pair — the segment would
                          // silently match nobody.
                          const nf = SEGMENT_FIELDS.find((x) => x.field === e.target.value)!;
                          patch(i, { field: nf.field, op: nf.ops[0].op, value: '' });
                        }}>
                        {SEGMENT_FIELDS.map((x) => <option key={x.field} value={x.field}>{x.label}</option>)}
                      </select>

                      <select value={f.op} className="input-field !h-8 !w-auto text-xs"
                        onChange={(e) => patch(i, { op: e.target.value, value: '' })}>
                        {(fieldDef?.ops || []).map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
                      </select>

                      {input === 'none' ? null
                        : input === 'status' ? (
                          <select value={f.value} onChange={(e) => patch(i, { value: e.target.value })} className="input-field !h-8 !w-auto text-xs">
                            <option value="">—</option>
                            {SUBSCRIBER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        ) : input === 'list' ? (
                          <select value={f.value} onChange={(e) => patch(i, { value: e.target.value })} className="input-field !h-8 !w-auto text-xs">
                            <option value="">—</option>
                            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                          </select>
                        ) : (
                          <input
                            value={f.value}
                            // Numeric operands are validated in SQL too (a
                            // non-numeric one fails closed), but typing letters
                            // into a "days" box should not silently match nobody.
                            type={input === 'days' || input === 'count' ? 'number' : 'text'}
                            min={input === 'days' || input === 'count' ? 1 : undefined}
                            onChange={(e) => patch(i, { value: e.target.value })}
                            className="input-field !h-8 flex-1 min-w-[8rem] text-xs"
                            placeholder={input === 'days' ? '30' : input === 'count' ? '1' : 'value'} />
                        )}

                      <button onClick={() => setFilters((fs) => fs.filter((_, j) => j !== i))}
                        className="ml-auto p-1.5 rounded-md text-tertiary hover:bg-surface-hover">
                        <Trash2 className="w-3.5 h-3.5 text-danger" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Live result */}
          <div className="rounded-lg bg-surface-sunken p-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-accent" />
              <span className="text-sm font-medium text-primary">
                {previewing ? '…' : preview?.total ?? 0} subscriber{preview?.total === 1 ? '' : 's'} match
              </span>
              {previewing && <Loader2 className="w-3.5 h-3.5 animate-spin text-tertiary" />}
            </div>
            {preview && preview.rows.length > 0 && (
              <div className="mt-2 space-y-1">
                {preview.rows.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 text-2xs">
                    <span className="text-primary truncate flex-1">{r.email}</span>
                    <Badge tone={r.status === 'enabled' ? 'success' : 'neutral'}>{r.status}</Badge>
                  </div>
                ))}
                {preview.total > preview.rows.length && (
                  <p className="text-3xs text-tertiary pt-1">and {preview.total - preview.rows.length} more</p>
                )}
              </div>
            )}
          </div>

          {/* Sync. Only offered once saved, because it needs a segment id. */}
          {initial.id && lists.length > 0 && (
            <div className="rounded-lg border border-subtle p-3">
              <div className="flex items-center gap-2">
                <select value={syncList} onChange={(e) => setSyncList(e.target.value)} className="input-field !h-8 flex-1 text-xs">
                  <option value="">Add these subscribers to a list…</option>
                  {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <Button size="sm" variant="secondary" disabled={!syncList} onClick={sync}>
                  <ArrowRight className="w-3.5 h-3.5" /> Sync
                </Button>
              </div>
              {/* Said plainly, because "sync" usually implies two-way. */}
              <p className="text-3xs text-tertiary mt-1.5">
                Copies the current matches onto that list so a newsletter can target them. It only adds —
                nobody is removed, and the list does not stay in step as the segment changes.
              </p>
            </div>
          )}
        </div>

        <div className="h-14 shrink-0 flex items-center justify-end gap-2 px-4 border-t border-subtle">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save segment
          </Button>
        </div>
      </div>
    </div>
  );
}
