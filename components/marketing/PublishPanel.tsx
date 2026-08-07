'use client';

import { useCallback, useEffect, useState } from 'react';
import { Send, Check, AlertTriangle, Clock, ExternalLink, Loader2 } from 'lucide-react';
import { Linkedin } from '@/components/ui/BrandIcons';
import { getWorkspace } from '@/lib/crm/data';
import {
  loadSocialAccounts, loadPostTargets, savePostTargets, publishNow,
  PROVIDER_LABEL, PROVIDER_MAX_CHARS,
  type SocialAccount, type PostTarget, type SocialProvider,
} from '@/lib/crm/social';

/**
 * Publishing controls for one post.
 *
 * WHAT THIS DOES NOT DO: send. "Publish now" only marks the pending targets due
 * and nudges the dispatcher — every path to a platform goes through
 * claim_post_targets, so there is exactly one place the at-most-once rule has
 * to hold. That also means the button returns instantly and the status list is
 * what reports the outcome, which is honest: LinkedIn accepting a post is not
 * something we learn synchronously.
 *
 * A sent target is shown but not selectable. Unticking an account cannot
 * un-publish a post, and offering a checkbox that implies otherwise would be a
 * lie about what the product can do.
 */

const ICON: Record<SocialProvider, React.ReactNode> = {
  linkedin: <Linkedin className="w-3.5 h-3.5" />,
  x: <span className="text-2xs font-semibold">X</span>,
};

const STATUS_TONE: Record<PostTarget['status'], string> = {
  pending: 'text-tertiary',
  sending: 'text-secondary',
  sent: 'text-success',
  failed: 'text-danger',
  skipped: 'text-tertiary',
};

/** `datetime-local` wants local wall-clock with no zone; the DB wants ISO. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function PublishPanel({ privy, postId, content }: {
  privy: string | null; postId: string; content: string;
}) {
  const [ws, setWs] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [targets, setTargets] = useState<PostTarget[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [when, setWhen] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    if (!privy) { setLoading(false); return; }
    const w = await getWorkspace(privy);
    setWs(w?.id ?? null);
    if (!w?.id) { setLoading(false); return; }

    const [a, t] = await Promise.all([loadSocialAccounts(privy, w.id), loadPostTargets(privy, postId)]);
    setAccounts(a.rows);
    setTargets(t.rows);
    // Seed the checkboxes from what is already targeted, so opening the panel
    // shows the current state rather than a blank slate that would wipe it on
    // the next save.
    setPicked(new Set(t.rows.map((r) => r.account_id)));
    setWhen(toLocalInput(t.rows.find((r) => r.scheduled_at)?.scheduled_at ?? null));
    if (a.error || t.error) setNote({ ok: false, text: a.error || t.error || '' });
    setLoading(false);
  }, [privy, postId]);

  useEffect(() => { reload(); }, [reload]);

  const sentFor = (accountId: string) => targets.find((t) => t.account_id === accountId && t.status === 'sent');

  const toggle = (id: string) => setPicked((p) => {
    const next = new Set(p);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const save = async () => {
    if (!privy || !ws) return;
    setBusy('save'); setNote(null);
    const iso = when ? new Date(when).toISOString() : null;
    const { rows, error } = await savePostTargets(privy, ws, postId, [...picked], iso);
    setBusy(null);
    if (error) return setNote({ ok: false, text: error });
    setTargets(rows);
    setNote({ ok: true, text: iso ? 'Scheduled.' : 'Saved. Use Publish now to send it.' });
  };

  const publish = async () => {
    if (!privy || !ws) return;
    setBusy('publish'); setNote(null);
    // Save first: publishing what is on screen, not what was last saved, is the
    // only behaviour that matches the button's label.
    const saved = await savePostTargets(privy, ws, postId, [...picked], null);
    if (saved.error) { setBusy(null); return setNote({ ok: false, text: saved.error }); }

    const { rows, error } = await publishNow(privy, ws, postId);
    setBusy(null);
    if (error) return setNote({ ok: false, text: error });
    setTargets(rows);
    setNote({ ok: true, text: 'Sending. Refresh in a moment to see each account.' });
  };

  // Each platform has its own limit, so the warning names the platform rather
  // than showing one number that is wrong for at least one of them.
  const tooLong = [...picked]
    .map((id) => accounts.find((a) => a.id === id))
    .filter((a): a is SocialAccount => !!a)
    .filter((a) => content.trim().length > PROVIDER_MAX_CHARS[a.provider]);

  if (loading) {
    return (
      <div className="card-surface p-4 text-sm text-tertiary inline-flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading publishing…
      </div>
    );
  }

  return (
    <section className="card-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-subtle flex items-center gap-2">
        <h3 className="text-sm font-medium text-primary flex-1">Publish</h3>
        <span className="text-2xs text-tertiary tabular-nums">{content.trim().length} chars</span>
      </div>

      <div className="p-4 space-y-3">
        {accounts.length === 0 ? (
          <p className="text-xs text-tertiary">
            No social accounts connected. Add one in{' '}
            <a href="/settings/integrations" className="font-medium text-secondary hover:text-primary underline">
              Settings → Integrations
            </a>.
          </p>
        ) : (
          <div className="space-y-1.5">
            {accounts.map((a) => {
              const sent = sentFor(a.id);
              const target = targets.find((t) => t.account_id === a.id);
              return (
                <label key={a.id}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 ring-1 ring-subtle ${sent ? 'opacity-70' : 'cursor-pointer hover:bg-surface-hover'}`}>
                  <input type="checkbox" checked={sent ? true : picked.has(a.id)}
                    disabled={!!sent || !a.enabled}
                    onChange={() => toggle(a.id)}
                    className="w-3.5 h-3.5 accent-[hsl(var(--accent))] shrink-0" />
                  <span className="w-6 h-6 rounded-md bg-surface-hover shrink-0 inline-flex items-center justify-center text-tertiary">
                    {ICON[a.provider]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-primary truncate">{a.display_name || PROVIDER_LABEL[a.provider]}</span>
                    {target && (
                      <span className={`block text-3xs ${STATUS_TONE[target.status]}`}>
                        {target.status === 'sent' ? 'Published' : target.status}
                        {target.error ? ` — ${target.error}` : ''}
                      </span>
                    )}
                    {!a.enabled && <span className="block text-3xs text-tertiary">Paused in settings</span>}
                  </span>
                  {sent?.provider_url && (
                    <a href={sent.provider_url} target="_blank" rel="noreferrer"
                       onClick={(e) => e.stopPropagation()}
                       className="p-1 rounded text-tertiary hover:text-primary shrink-0" title="Open the published post">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </label>
              );
            })}
          </div>
        )}

        {tooLong.length > 0 && (
          <p className="text-2xs text-warning inline-flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            Too long for {tooLong.map((a) => `${PROVIDER_LABEL[a.provider]} (${PROVIDER_MAX_CHARS[a.provider]})`).join(', ')}.
          </p>
        )}

        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
          <label className="flex-1 min-w-0">
            <span className="block text-2xs text-tertiary mb-1 inline-flex items-center gap-1"><Clock className="w-3 h-3" /> Schedule (optional)</span>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
              className="input-field !h-8 !text-xs w-full" />
          </label>
          <button onClick={save} disabled={!privy || busy !== null}
            className="h-8 px-3 shrink-0 rounded-lg text-sm font-semibold text-secondary ring-1 ring-subtle bg-surface hover:bg-surface-sunken inline-flex items-center gap-1.5 disabled:opacity-40">
            {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save
          </button>
          <button onClick={publish} disabled={!privy || busy !== null || picked.size === 0}
            className="h-8 px-3 shrink-0 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 inline-flex items-center gap-1.5 disabled:opacity-40">
            {busy === 'publish' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Publish now
          </button>
        </div>

        {note && <p className={`text-2xs ${note.ok ? 'text-success' : 'text-danger'}`}>{note.text}</p>}

        <p className="text-2xs text-tertiary">
          A post goes out at most once per account — if something fails, check the platform before
          publishing again rather than retrying blind.
        </p>
      </div>
    </section>
  );
}
