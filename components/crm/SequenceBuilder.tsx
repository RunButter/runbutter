'use client';

import { useState } from 'react';
import { Loader2, Plus, Trash2, X, Mail, Clock, ArrowDown } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useDialog } from '@/components/ui/Dialog';
import { saveSequence, sequenceLengthDays, type Sequence, type SequenceStep } from '@/lib/crm/sequences';
import type { NewsletterList, NewsletterRow } from '@/lib/crm/newsletters';
import type { Segment } from '@/lib/crm/segments';

/**
 * Build a drip: who enters, then an ordered list of waits and emails.
 *
 * Rendered as a vertical timeline rather than a table, because the thing a
 * person needs to check is the SHAPE — that the second email really does land
 * three days after the first, not that a cell holds the number 3.
 */
export default function SequenceBuilder({
  initial, lists, segments, newsletters, ws, privy, onClose, onSaved,
}: {
  initial: Partial<Sequence>; lists: NewsletterList[]; segments: Segment[];
  newsletters: NewsletterRow[]; ws: string; privy: string;
  onClose: () => void; onSaved: () => void;
}) {
  const { notify } = useDialog();
  const [name, setName] = useState(initial.name || 'New sequence');
  const [entryKind, setEntryKind] = useState<'list' | 'segment'>(initial.entry_segment ? 'segment' : 'list');
  const [entryList, setEntryList] = useState(initial.entry_list || '');
  const [entrySegment, setEntrySegment] = useState(initial.entry_segment || '');
  const [steps, setSteps] = useState<SequenceStep[]>(initial.steps || []);
  const [saving, setSaving] = useState(false);

  // Only drafts are offered as step content: a newsletter that has been sent as
  // a campaign already has delivery rows for those subscribers, and reusing it
  // in a drip would silently skip everyone who received the campaign.
  const usable = newsletters.filter((n) => n.status === 'draft');

  const patch = (i: number, p: any) => setSteps((ss) => ss.map((s, j) => (j === i ? { ...s, ...p } : s)) as SequenceStep[]);
  const move = (i: number, d: -1 | 1) => setSteps((ss) => {
    const j = i + d;
    if (j < 0 || j >= ss.length) return ss;
    const c = [...ss]; [c[i], c[j]] = [c[j], c[i]]; return c;
  });

  const save = async () => {
    if (entryKind === 'list' ? !entryList : !entrySegment) return notify('Choose who enters this sequence.');
    if (steps.length === 0) return notify('Add at least one step.');
    setSaving(true);
    const { error } = await saveSequence(privy, ws, {
      id: initial.id, name, steps,
      entry_list: entryKind === 'list' ? entryList : null,
      entry_segment: entryKind === 'segment' ? entrySegment : null,
    });
    setSaving(false);
    if (error) return notify(error);
    onSaved();
  };

  const days = sequenceLengthDays(steps);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-popover" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-subtle">
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="text-sm font-medium text-primary bg-transparent outline-none flex-1 focus:bg-surface-hover rounded px-1 -mx-1" />
          {days > 0 && <span className="text-2xs text-tertiary">{days} day{days === 1 ? '' : 's'} long</span>}
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <span className="text-xs text-secondary block mb-1.5">Who enters</span>
            <div className="flex items-center gap-1.5">
              <select value={entryKind} onChange={(e) => setEntryKind(e.target.value as any)} className="input-field !h-9 !w-auto text-xs">
                <option value="list">Everyone on list</option>
                <option value="segment">Everyone matching segment</option>
              </select>
              {entryKind === 'list' ? (
                <select value={entryList} onChange={(e) => setEntryList(e.target.value)} className="input-field !h-9 flex-1 text-xs">
                  <option value="">Choose a list…</option>
                  {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.subscriber_count})</option>)}
                </select>
              ) : (
                <select value={entrySegment} onChange={(e) => setEntrySegment(e.target.value)} className="input-field !h-9 flex-1 text-xs">
                  <option value="">Choose a segment…</option>
                  {segments.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              )}
            </div>
            {/* The two properties people assume wrongly, said once, here. */}
            <p className="text-2xs text-tertiary mt-1.5">
              People join once and are never re-added. Leaving the list or segment does not pull someone
              out mid-drip — but unsubscribing or bouncing stops it immediately.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-secondary">Then</span>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setSteps((s) => [...s, { kind: 'wait', days: '3' }])}>
                  <Clock className="w-3.5 h-3.5" /> Wait
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSteps((s) => [...s, { kind: 'email', newsletter_id: '' }])}>
                  <Mail className="w-3.5 h-3.5" /> Email
                </Button>
              </div>
            </div>

            {steps.length === 0 ? (
              <p className="text-xs text-tertiary rounded-lg border border-dashed border-subtle p-6 text-center">
                No steps yet. A typical drip is an email, a wait, then another email.
              </p>
            ) : (
              <div className="space-y-1">
                {steps.map((s, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2 rounded-lg border border-subtle p-2.5">
                      <span className="w-6 h-6 rounded-md bg-surface-hover flex items-center justify-center shrink-0">
                        {s.kind === 'wait' ? <Clock className="w-3.5 h-3.5 text-tertiary" /> : <Mail className="w-3.5 h-3.5 text-accent" />}
                      </span>
                      {s.kind === 'wait' ? (
                        <span className="flex items-center gap-1.5 flex-1">
                          <span className="text-xs text-secondary">Wait</span>
                          <input type="number" min={0} max={365} value={s.days}
                            onChange={(e) => patch(i, { days: e.target.value })}
                            className="input-field !h-8 w-20 text-xs" />
                          <span className="text-xs text-secondary">days</span>
                        </span>
                      ) : (
                        <select value={s.newsletter_id} onChange={(e) => patch(i, { newsletter_id: e.target.value })}
                          className="input-field !h-8 flex-1 text-xs">
                          <option value="">Choose a draft newsletter…</option>
                          {usable.map((n) => <option key={n.id} value={n.id}>{n.subject || 'Untitled'}</option>)}
                        </select>
                      )}
                      <button onClick={() => move(i, -1)} disabled={i === 0}
                        className="p-1 rounded text-tertiary hover:bg-surface-hover disabled:opacity-30 rotate-180"><ArrowDown className="w-3.5 h-3.5" /></button>
                      <button onClick={() => move(i, 1)} disabled={i === steps.length - 1}
                        className="p-1 rounded text-tertiary hover:bg-surface-hover disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                      <button onClick={() => setSteps((ss) => ss.filter((_, j) => j !== i))}
                        className="p-1 rounded text-tertiary hover:bg-surface-hover"><Trash2 className="w-3.5 h-3.5 text-danger" /></button>
                    </div>
                    {i < steps.length - 1 && <div className="h-2 w-px bg-subtle ml-5" />}
                  </div>
                ))}
              </div>
            )}

            {usable.length === 0 && steps.some((s) => s.kind === 'email') && (
              <p className="text-2xs text-warning mt-2">
                No draft newsletters to send. Create one on the Sends tab — a newsletter that has already
                been sent as a campaign cannot be reused here, because everyone who received it would be skipped.
              </p>
            )}
          </div>
        </div>

        <div className="h-14 shrink-0 flex items-center justify-end gap-2 px-4 border-t border-subtle">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save sequence
          </Button>
        </div>
      </div>
    </div>
  );
}
