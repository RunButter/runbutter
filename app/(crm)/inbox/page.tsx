'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Inbox as InboxIcon, Loader2, Sparkles, Send, Check, RotateCcw, UserPlus, UserMinus, ExternalLink, ArrowLeft, StickyNote, MessageSquare } from 'lucide-react';
import AppLoading from '@/components/ui/AppLoading';
import { getWorkspace } from '@/lib/crm/data';
import {
  loadInbox, loadThread, setConversation, sendReply, draftReply,
  type InboxRow, type InboxCounts, type InboxView, type Thread, type ThreadMessage,
} from '@/lib/support/client';

/**
 * The support inbox (0131) — conversations from the chat widget on your site.
 *
 * Three states, the ones Plain settled on: TO DO (the customer is waiting on
 * us), WAITING (we replied, the customer has not), DONE. A visitor writing
 * moves a thread to To do on its own; a reply moves it to Waiting. Nobody has
 * to remember to file anything, which is the only way an inbox stays honest.
 *
 * It POLLS, like team chat (0075) and for the same reason: Realtime would need
 * anon-key RLS policies on these tables, and every read here goes through the
 * Privy-verified proxy precisely so the browser holds no capability of its own.
 */

const VIEWS: [InboxView, string][] = [['open', 'To do'], ['pending', 'Waiting'], ['closed', 'Done'], ['mine', 'Mine'], ['all', 'All']];
const POLL_MS = 5000;

const initials = (s: string) => s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function InboxPage() {
  return <Suspense fallback={<AppLoading />}><Inbox /></Suspense>;
}

function Inbox() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const router = useRouter();
  const search = useSearchParams();
  const selected = search?.get('c') || null;

  const [ws, setWs] = useState<string | null>(null);
  const [view, setView] = useState<InboxView>('open');
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { if (privy) getWorkspace(privy).then((w) => setWs(w?.id ?? null)); else if (ready) setLoading(false); }, [privy, ready]);

  const refreshList = useCallback(async () => {
    if (!privy || !ws) return;
    const r = await loadInbox(privy, ws, view);
    setRows(r.rows); setCounts(r.counts); setError(r.error || ''); setLoading(false);
  }, [privy, ws, view]);

  const refreshThread = useCallback(async () => {
    if (!privy || !ws || !selected) { setThread(null); return; }
    const r = await loadThread(privy, ws, selected);
    if (r.thread) setThread(r.thread);
    else if (r.error) setError(r.error);
  }, [privy, ws, selected]);

  useEffect(() => { refreshList(); }, [refreshList]);
  useEffect(() => { setThread(null); refreshThread(); }, [refreshThread]);

  // Poll only while the tab is visible — a background tab polling every five
  // seconds all day is load nobody is looking at.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      refreshList(); refreshThread();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [refreshList, refreshThread]);

  const open = (id: string | null) => router.replace(id ? `/inbox?c=${id}` : '/inbox', { scroll: false });

  if (!ready || (privy && loading && !error)) return <AppLoading />;

  return (
    // flex-1, not h-full: the shell draws the Inbox / Chat widget tab strip
    // above this, and h-full would push the composer below the fold.
    <div className="flex-1 flex flex-col min-h-0">
      <header className="h-16 shrink-0 flex items-center gap-3 page-x">
        <h1 className="text-md font-medium text-primary">Inbox</h1>
        {!!counts?.unread && <span className="text-2xs font-semibold text-accent-fg bg-accent rounded-full px-1.5 py-0.5 tabular-nums">{counts.unread} new</span>}
        <span className="text-xs text-tertiary hidden lg:inline truncate">Messages from the chat on your website</span>
      </header>

      {!privy ? (
        <div className="page-pad text-sm text-tertiary">Sign in to see your inbox.</div>
      ) : (
        // pb-20 keeps the composer's Send clear of the Copilot button, which
        // floats over the bottom-right corner of every screen.
        <div className="flex-1 min-h-0 flex gap-4 page-x pb-20 md:pb-20">
          {/* List — hidden on a phone while a thread is open. */}
          <section className={`${selected ? 'hidden md:flex' : 'flex'} w-full md:w-80 lg:w-96 shrink-0 flex-col min-h-0 card-surface overflow-hidden`}>
            <div className="shrink-0 p-2 border-b border-subtle overflow-x-auto">
              <div className="inline-flex items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5">
                {VIEWS.map(([v, label]) => {
                  const n = v === 'all' ? null : counts?.[v as keyof InboxCounts];
                  return (
                    <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                      className={`h-7 px-2.5 rounded-md text-xs whitespace-nowrap transition-colors ${view === v ? 'bg-surface text-primary shadow-sm font-medium' : 'text-tertiary hover:text-secondary'}`}>
                      {label}{n ? <span className="ml-1 tabular-nums text-tertiary">{n}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
            {error && <p className="px-4 py-3 text-xs text-danger">{error}</p>}
            <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-subtle">
              {rows.length === 0 && !error && (
                <li className="px-6 py-12 text-center">
                  <InboxIcon className="w-5 h-5 mx-auto text-tertiary" />
                  <p className="mt-2 text-sm text-secondary">{view === 'open' ? 'Nothing waiting on you.' : 'Nothing here.'}</p>
                  {view === 'open' && (counts?.pending || 0) + (counts?.closed || 0) === 0 && (
                    <Link href="/inbox/widget" className="mt-1 inline-block text-xs text-accent hover:underline">Put the chat on your website →</Link>
                  )}
                </li>
              )}
              {rows.map((r) => (
                <li key={r.id}>
                  <button onClick={() => open(r.id)}
                    className={`w-full text-left px-3.5 py-3 flex gap-3 transition-colors ${selected === r.id ? 'bg-surface-hover' : 'hover:bg-surface-sunken/70'}`}>
                    <span className="w-8 h-8 rounded-full bg-surface-sunken ring-1 ring-subtle text-2xs font-semibold text-secondary flex items-center justify-center shrink-0">
                      {initials(r.name || r.email || '?')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={`text-sm truncate ${r.unread ? 'font-semibold text-primary' : 'text-primary'}`}>{r.name || r.email || 'Website visitor'}</span>
                        <span className="ml-auto text-2xs text-tertiary shrink-0 tabular-nums">{ago(r.last_message_at)}</span>
                      </span>
                      <span className="flex items-center gap-1.5 mt-0.5">
                        {r.unread && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-label="Unread" />}
                        <span className={`text-xs truncate ${r.unread ? 'text-secondary' : 'text-tertiary'}`}>{r.preview || r.subject || ''}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Thread */}
          <section className={`${selected ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col min-h-0 card-surface overflow-hidden`}>
            {!selected ? (
              <div className="m-auto text-center px-6">
                <MessageSquare className="w-5 h-5 mx-auto text-tertiary" />
                <p className="mt-2 text-sm text-tertiary">Pick a conversation.</p>
              </div>
            ) : !thread ? (
              <AppLoading />
            ) : (
              <ThreadView key={thread.id} thread={thread} privy={privy} ws={ws!} onBack={() => open(null)}
                onChanged={() => { refreshThread(); refreshList(); }} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ThreadView({ thread, privy, ws, onBack, onChanged }: {
  thread: Thread; privy: string; ws: string; onBack: () => void; onChanged: () => void;
}) {
  const [body, setBody] = useState('');
  const [note, setNote] = useState(false);
  const [busy, setBusy] = useState<'' | 'send' | 'draft' | 'status'>('');
  const [msg, setMsg] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const count = thread.messages.length;
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [count]);

  const mine = thread.assignee_privy === privy;
  const who = thread.name || thread.email || 'Website visitor';

  const send = async () => {
    if (!body.trim()) return;
    setBusy('send'); setMsg('');
    const r = await sendReply(privy, ws, thread.id, body, note);
    setBusy('');
    if (r.error) { setMsg(r.error); return; }
    setBody('');
    if (r.emailed) setMsg(`Also emailed to ${thread.email} — they had left the chat.`);
    onChanged();
  };
  const draft = async () => {
    setBusy('draft'); setMsg('');
    const r = await draftReply(privy, ws, thread.id);
    setBusy('');
    if (r.error) { setMsg(r.error); return; }
    setNote(false);
    setBody(r.text || '');
  };
  const status = async (patch: { status?: 'open' | 'pending' | 'closed'; assignee?: string | null }) => {
    setBusy('status'); setMsg('');
    const r = await setConversation(privy, ws, thread.id, patch);
    setBusy('');
    if (r.error) setMsg(r.error); else onChanged();
  };

  return (
    <>
      <div className="shrink-0 px-4 h-14 flex items-center gap-2 border-b border-subtle">
        <button onClick={onBack} aria-label="Back to the list" className="md:hidden p-1.5 -ml-1.5 rounded-md text-secondary hover:bg-surface-hover"><ArrowLeft className="w-4 h-4" /></button>
        <div className="min-w-0">
          <div className="text-sm font-medium text-primary truncate">{who}</div>
          <div className="text-2xs text-tertiary truncate">
            {thread.email && thread.name ? `${thread.email} · ` : ''}
            {thread.page_url ? <a href={thread.page_url} target="_blank" rel="noreferrer noopener" className="hover:underline">{thread.page_url.replace(/^https?:\/\//, '').slice(0, 60)}</a> : 'from the chat widget'}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {thread.person_id && (
            <Link href={`/objects/people?ref=${thread.person_id}`} title="Open the contact"
              className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs text-secondary ring-1 ring-subtle hover:bg-surface-hover">
              <ExternalLink className="w-3.5 h-3.5" /> <span className="hidden lg:inline">Contact</span>
            </Link>
          )}
          <button onClick={() => status({ assignee: mine ? null : privy })} disabled={!!busy}
            className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs text-secondary ring-1 ring-subtle hover:bg-surface-hover disabled:opacity-40">
            {mine ? <UserMinus className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
            <span className="hidden lg:inline">{mine ? 'Unassign' : thread.assignee_privy ? 'Take it' : 'Assign to me'}</span>
          </button>
          {thread.status === 'closed' ? (
            <button onClick={() => status({ status: 'open' })} disabled={!!busy}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs text-secondary ring-1 ring-subtle hover:bg-surface-hover disabled:opacity-40">
              <RotateCcw className="w-3.5 h-3.5" /> Reopen
            </button>
          ) : (
            <button onClick={() => status({ status: 'closed' })} disabled={!!busy}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
              <Check className="w-3.5 h-3.5" /> Done
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
        {thread.messages.map((m) => <Bubble key={m.id} m={m} />)}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-subtle p-3">
        <div className={`rounded-xl ring-1 ${note ? 'ring-warning/40 bg-warning/5' : 'ring-subtle bg-surface'} p-2`}>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} aria-label={note ? 'Internal note' : 'Reply'}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send(); }}
            placeholder={note ? 'A note only your team sees…' : `Reply to ${who}…`}
            className="w-full resize-none bg-transparent text-sm text-primary outline-none placeholder:text-tertiary px-1" />
          <div className="flex items-center gap-1.5">
            <div className="inline-flex items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5">
              <button onClick={() => setNote(false)} aria-pressed={!note}
                className={`h-7 px-2.5 rounded-md text-xs ${!note ? 'bg-surface text-primary shadow-sm font-medium' : 'text-tertiary'}`}>Reply</button>
              <button onClick={() => setNote(true)} aria-pressed={note}
                className={`h-7 px-2.5 rounded-md text-xs inline-flex items-center gap-1 ${note ? 'bg-surface text-primary shadow-sm font-medium' : 'text-tertiary'}`}>
                <StickyNote className="w-3 h-3" /> Note
              </button>
            </div>
            <button onClick={draft} disabled={!!busy} title="Draft a reply with AI — you review it before sending"
              className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-xs text-secondary hover:bg-surface-hover disabled:opacity-40">
              {busy === 'draft' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} <span className="hidden sm:inline">Draft</span>
            </button>
            <span className="ml-auto hidden sm:inline text-3xs text-tertiary">⌘↵</span>
            <button onClick={send} disabled={!!busy || !body.trim()}
              className="ml-auto sm:ml-0 h-8 px-3 shrink-0 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
              {busy === 'send' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} {note ? 'Add note' : 'Send'}
            </button>
          </div>
        </div>
        {msg && <p className="mt-1.5 text-2xs text-secondary">{msg}</p>}
      </div>
    </>
  );
}

function Bubble({ m }: { m: ThreadMessage }) {
  const time = useMemo(() => new Date(m.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), [m.at]);
  if (m.kind === 'note') {
    return (
      <div className="mx-auto max-w-[85%] rounded-xl bg-warning/10 ring-1 ring-warning/30 px-3 py-2">
        <div className="text-3xs font-semibold uppercase tracking-wider text-warning mb-0.5">Internal note · {m.name || 'Team'} · {time}</div>
        <p className="text-sm text-primary whitespace-pre-wrap break-words">{m.body}</p>
      </div>
    );
  }
  const visitor = m.kind === 'visitor';
  return (
    <div className={`flex ${visitor ? 'justify-start' : 'justify-end'}`}>
      <div className="max-w-[80%]">
        <div className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${visitor ? 'bg-surface-sunken text-primary rounded-bl-md' : 'bg-inverse text-inverse-fg rounded-br-md'}`}>
          {m.body}
        </div>
        <div className={`mt-0.5 text-3xs text-tertiary ${visitor ? '' : 'text-right'}`}>
          {visitor ? time : `${m.kind === 'agent' ? 'AI · ' : ''}${m.name || 'Team'} · ${time}`}
        </div>
      </div>
    </div>
  );
}
