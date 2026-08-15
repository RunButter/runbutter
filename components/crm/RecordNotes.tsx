'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, User, ExternalLink, Plus, Trash2, Loader2, Sparkles } from 'lucide-react';
import { useDialog } from '@/components/ui/Dialog';
import { loadRecordNotes, addRecordNote, deleteRecordNote, type RecordNote } from '@/lib/crm/notes';
import MentionText from '@/components/crm/MentionText';
import MentionInput from '@/components/crm/MentionInput';

/**
 * What has been found out about this record — the "Agent" view.
 *
 * EVERY NOTE SHOWS ITS SOURCE, and no note shows a confidence score, because
 * neither exists in the data. That is the feature: a reader can check a URL or
 * a file name; they cannot check "87% confident". The source is rendered as
 * prominently as the claim for the same reason.
 *
 * A person can write a note here too. Research an agent produces but a human
 * cannot correct is research nobody will trust, and a second, human-only notes
 * table would just split the record in half.
 */

const fmt = (s: string) => new Date(s).toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' });

export default function RecordNotes({ privy, workspaceId, object, recordId }: {
  privy: string | null; workspaceId: string | null; object: string; recordId: string;
}) {
  const { confirm: confirmDialog } = useDialog();
  const [rows, setRows] = useState<RecordNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [body, setBody] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!privy) { setLoading(false); return; }
    const { rows, error } = await loadRecordNotes(privy, object, recordId);
    setRows(rows); setError(error || ''); setLoading(false);
  }, [privy, object, recordId]);

  useEffect(() => { reload(); }, [reload]);

  const submit = async () => {
    if (!privy || !workspaceId) return;
    setBusy(true);
    const { error } = await addRecordNote(privy, workspaceId, object, recordId, body.trim(), source.trim());
    setBusy(false);
    if (error) return setError(error);
    setBody(''); setSource(''); setAdding(false); setError('');
    reload();
  };

  const remove = async (n: RecordNote) => {
    if (!privy || !workspaceId) return;
    if (!await confirmDialog('Delete this note?')) return;
    await deleteRecordNote(privy, workspaceId, n.id);
    reload();
  };

  return (
    <section className="card-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-subtle flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-accent" />
        <h3 className="text-sm font-medium text-primary flex-1">Research</h3>
        <span className="text-2xs font-semibold text-tertiary bg-surface-hover rounded px-1.5 tabular-nums">{rows.length}</span>
        <button onClick={() => setAdding((a) => !a)} disabled={!privy}
          className="h-7 px-2 rounded-md text-xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-hover inline-flex items-center gap-1 disabled:opacity-40">
          <Plus className="w-3.5 h-3.5" /> Note
        </button>
      </div>

      <div className="p-4 space-y-3">
        {adding && (
          <div className="rounded-lg ring-1 ring-subtle bg-surface-sunken p-3 space-y-2">
            <MentionInput value={body} onChange={setBody} rows={2}
              privy={privy} workspaceId={workspaceId}
              placeholder="One thing you found out. @ to link a record."
              className="input-field !h-auto py-2 resize-none w-full text-xs" />
            {/* Required, and labelled as such rather than validated after the
                fact — the whole point of these notes is that every claim can be
                checked, so the field is not an afterthought. */}
            <input value={source} onChange={(e) => setSource(e.target.value)}
              placeholder="Where it came from — a link, a document, or who told you (required)"
              className="input-field !h-8 w-full text-xs" />
            <div className="flex items-center gap-2">
              <button onClick={submit} disabled={busy || !body.trim() || !source.trim()}
                className="h-7 px-2.5 rounded-md text-xs font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 inline-flex items-center gap-1.5 disabled:opacity-40">
                {busy && <Loader2 className="w-3 h-3 animate-spin" />} Save
              </button>
              <button onClick={() => { setAdding(false); setError(''); }}
                className="h-7 px-2.5 rounded-md text-xs text-tertiary hover:text-primary">Cancel</button>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-danger">{error}</p>}

        {loading ? (
          <span className="text-xs text-tertiary inline-flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</span>
        ) : rows.length === 0 ? (
          <p className="text-xs text-tertiary">
            Nothing recorded yet. An agent with the <span className="font-mono">add_record_note</span> tool
            writes what it finds here — with a source, and never a confidence score.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((n) => (
              <div key={n.id} className="group rounded-lg ring-1 ring-subtle bg-surface p-3">
                <div className="flex items-center gap-1.5">
                  {n.agent_name
                    ? <Bot className="w-3.5 h-3.5 text-accent shrink-0" />
                    : <User className="w-3.5 h-3.5 text-tertiary shrink-0" />}
                  <span className="text-2xs font-medium text-secondary truncate">{n.agent_name || 'Team'}</span>
                  {n.kind === 'action' && (
                    <span className="text-3xs font-semibold text-tertiary bg-surface-hover rounded px-1.5">did</span>
                  )}
                  <span className="text-3xs text-tertiary ml-auto shrink-0">
                    {n.observed_at ? `${fmt(n.observed_at)} · logged ${fmt(n.created_at)}` : fmt(n.created_at)}
                  </span>
                  <button onClick={() => remove(n)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-tertiary hover:text-danger transition-opacity shrink-0">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-secondary leading-snug whitespace-pre-wrap"><MentionText text={n.body} privy={privy} /></p>
                {/* As prominent as the claim. An unsourced fact and a sourced
                    one look different at a glance, which is the point. */}
                <div className="mt-1.5 text-3xs text-tertiary inline-flex items-center gap-1 min-w-0 max-w-full">
                  <span className="shrink-0">Source:</span>
                  {n.source_url ? (
                    <a href={n.source_url} target="_blank" rel="noreferrer"
                       className="inline-flex items-center gap-1 min-w-0 text-secondary hover:text-primary underline">
                      <span className="truncate">{n.source}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ) : (
                    <span className="font-mono truncate">{n.source}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
