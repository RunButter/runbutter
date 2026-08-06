'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Hash, Lock, Plus, Loader2, Send, Trash2, Bot, Link2, X, Paperclip } from 'lucide-react';
import { getWorkspace, type WorkspaceContext } from '@/lib/crm/data';
import {
  listChannels, createChannel, deleteChannel, listMessages, postMessage,
  deleteMessage, markChannelRead, groupMessages, POLL_MS,
  type Channel, type Message,
} from '@/lib/crm/chat';
import PageHeader from '@/components/dashboard/PageHeader';
import Button from '@/components/ui/Button';
import { useDialog } from '@/components/ui/Dialog';
import ChatAttachments from '@/components/crm/ChatAttachments';
import { EmbedResolver, uploadEmbed, MAX_EMBED_BYTES } from '@/lib/files/embeds';
import { formatBytes } from '@/lib/files/client';
import AppLoading from '@/components/ui/AppLoading';

/**
 * Team chat. The point is not chat — it is chat attached to records: a channel
 * can belong to an invoice, a candidate, a deal, in the same database as the
 * thing it is about. Slack cannot do that because it does not know what an
 * invoice is.
 */
export default function ChatPage() {
  const { confirm: confirmDialog, notify } = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const displayName = (user?.email?.address || user?.google?.email || 'Someone').split('@')[0];

  const [ws, setWs] = useState<WorkspaceContext | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  // Files already uploaded and waiting to be sent with the next message. The
  // upload happens on pick, not on send, so a slow upload never blocks typing
  // and the sender sees a thumbnail before committing to it.
  const [pending, setPending] = useState<{ id: string; name: string; size: number; url: string; mime: string }[]>([]);
  const [attaching, setAttaching] = useState(false);
  const filePick = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  // One resolver for the whole page: signed URLs are cached across the 4s poll,
  // so a channel of images does not re-mint every URL every tick.
  const embeds = useMemo(() => new EmbedResolver(privy), [privy]);

  const loadChannels = useCallback(async (w: WorkspaceContext, p: string) => {
    const cs = await listChannels(p, w.id);
    setChannels(cs);
    setActive((a) => a ?? cs[0]?.id ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!privy) { setLoading(false); return; }
    getWorkspace(privy).then((w) => { if (w) { setWs(w); loadChannels(w, privy); } else setLoading(false); });
  }, [ready, privy, loadChannels]);

  // Poll the open channel and the channel list together — see POLL_MS for why
  // this is polling and not a websocket.
  useEffect(() => {
    if (!privy || !ws || !active) return;
    let cancelled = false;
    const tick = async () => {
      const [ms, cs] = await Promise.all([listMessages(privy, active), listChannels(privy, ws.id)]);
      if (cancelled) return;
      setMessages(ms);
      setChannels(cs);
    };
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [privy, ws, active]);

  // Mark read on open, and again whenever new messages land while you are
  // looking at the bottom of the channel.
  useEffect(() => {
    if (privy && active && atBottom.current) markChannelRead(privy, active);
  }, [privy, active, messages.length]);

  useEffect(() => {
    // Only auto-scroll if the reader was already at the bottom; yanking someone
    // away from history they are reading is worse than a missed scroll.
    if (atBottom.current) bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const attach = async (files: FileList | null) => {
    if (!privy || !files?.length) return;
    setAttaching(true);
    for (const f of [...files]) {
      if (f.size > MAX_EMBED_BYTES) { notify(`${f.name} is larger than 10 MB.`); continue; }
      // Linked to the channel, so the file also shows up on the Files screen
      // attached to the conversation it was shared in.
      const res = await uploadEmbed(f, privy, ws?.id ?? null, 'channel', active);
      if ('error' in res) { notify(res.error); continue; }
      embeds.remember(res.id, res.url);
      setPending((p) => [...p, { id: res.id, name: f.name, size: f.size, url: res.url, mime: f.type }]);
    }
    setAttaching(false);
  };

  const send = async () => {
    // Either is enough — an image with no caption is an ordinary message.
    if (!privy || !active || (!body.trim() && pending.length === 0)) return;
    setSending(true);
    const text = body;
    const files = pending;
    setBody(''); setPending([]);
    const { error } = await postMessage(privy, active, text, displayName, files.map((f) => f.id));
    setSending(false);
    // Put the draft back exactly as it was, attachments included — they are
    // already uploaded, so nothing needs re-picking.
    if (error) { setBody(text); setPending(files); return notify(error); }
    atBottom.current = true;
    setMessages(await listMessages(privy, active));
  };

  const newChannel = async () => {
    if (!privy || !ws) return;
    const name = window.prompt('Channel name');   // eslint-disable-line no-alert
    if (!name?.trim()) return;
    setCreating(true);
    const { id, error } = await createChannel(privy, ws.id, name);
    setCreating(false);
    if (error) return notify(error);
    await loadChannels(ws, privy);
    if (id) setActive(id);
  };

  if (!ready || loading) {
    return <AppLoading />;
  }

  const channel = channels.find((c) => c.id === active) || null;
  const groups = groupMessages(messages);

  return (
    <>
      <PageHeader title="Chat" subtitle={channel ? channel.topic || `#${channel.name}` : 'Channels for your team'}>
        <Button size="sm" variant="primary" onClick={newChannel} disabled={!privy || creating}>
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} New channel
        </Button>
      </PageHeader>

      {/* On a phone the sidebar below is hidden, and until now nothing replaced
          it — you landed in whichever channel loaded first and there was no way
          to leave it. A scrolling row of chips is the one control that fits:
          a dropdown hides the unread counts, which are the reason you switch. */}
      {channels.length > 0 && (
        <div className="sm:hidden px-5 pb-2 -mt-1">
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            {channels.map((c) => (
              <button key={c.id} onClick={() => { atBottom.current = true; setActive(c.id); }}
                aria-current={c.id === active ? 'true' : undefined}
                className={`shrink-0 h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs transition-colors ${
                  c.id === active ? 'bg-inverse text-inverse-fg font-medium' : 'bg-surface text-secondary ring-1 ring-subtle'}`}>
                {c.is_private ? <Lock className="w-3 h-3 shrink-0 opacity-70" /> : <Hash className="w-3 h-3 shrink-0 opacity-70" />}
                <span className="max-w-[9rem] truncate">{c.name}</span>
                {c.unread > 0 && (
                  <span className={`min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded text-3xs font-medium tabular-nums ${
                    c.id === active ? 'bg-inverse-fg/20' : 'bg-accent text-accent-fg'}`}>
                    {c.unread > 99 ? '99+' : c.unread}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex gap-3 px-5 lg:px-7 pb-6">
        {/* Channel list */}
        <aside className="w-52 shrink-0 rounded-xl bg-surface shadow-card p-2 overflow-y-auto hidden sm:block">
          {channels.length === 0 ? (
            <p className="text-2xs text-tertiary p-3 text-center">No channels yet.</p>
          ) : channels.map((c) => (
            <button key={c.id} onClick={() => { atBottom.current = true; setActive(c.id); }}
              className={`w-full flex items-center gap-1.5 h-8 px-2 rounded-lg text-xs transition-colors ${
                c.id === active ? 'bg-surface-hover text-primary font-medium' : 'text-secondary hover:bg-surface-hover'}`}>
              {c.is_private ? <Lock className="w-3.5 h-3.5 shrink-0 text-tertiary" /> : <Hash className="w-3.5 h-3.5 shrink-0 text-tertiary" />}
              <span className="truncate flex-1 text-left">{c.name}</span>
              {c.unread > 0 && (
                <span className="shrink-0 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-md bg-accent text-accent-fg text-3xs font-medium tabular-nums">
                  {c.unread > 99 ? '99+' : c.unread}
                </span>
              )}
            </button>
          ))}
        </aside>

        {/* Conversation */}
        <section className="flex-1 min-w-0 rounded-xl bg-surface shadow-card flex flex-col overflow-hidden">
          {!channel ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-8">
              <Hash className="w-5 h-5 text-tertiary" />
              <p className="text-sm text-secondary">No channel selected.</p>
              <p className="text-xs text-tertiary max-w-sm">
                Channels can be attached to a record — an invoice, a candidate — so the discussion
                lives next to the thing it is about.
              </p>
            </div>
          ) : (
            <>
              <div className="h-11 shrink-0 flex items-center gap-2 px-4 border-b border-subtle">
                {channel.is_private ? <Lock className="w-3.5 h-3.5 text-tertiary" /> : <Hash className="w-3.5 h-3.5 text-tertiary" />}
                <span className="text-sm font-medium text-primary truncate">{channel.name}</span>
                {channel.linked_object && (
                  <span className="inline-flex items-center gap-1 text-2xs text-tertiary">
                    <Link2 className="w-3 h-3" />{channel.linked_object}
                  </span>
                )}
                <button
                  onClick={async () => {
                    if (ws && privy && await confirmDialog(`Delete #${channel.name}? Every message in it goes too.`)) {
                      await deleteChannel(privy, ws.id, channel.id);
                      setActive(null); loadChannels(ws, privy);
                    }
                  }}
                  className="ml-auto p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><Trash2 className="w-3.5 h-3.5 text-danger" /></button>
              </div>

              <div
                className="flex-1 overflow-y-auto p-4 space-y-3"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                }}>
                {messages.length === 0 && (
                  <p className="text-xs text-tertiary text-center py-8">Nothing here yet. Say something.</p>
                )}
                {groups.map((g) => (
                  <div key={g[0].id} className="flex gap-2.5">
                    <span className={`w-7 h-7 rounded-lg shrink-0 flex items-center justify-center text-2xs font-medium ${
                      g[0].author_kind === 'agent' ? 'bg-accent/10 text-accent' : 'bg-surface-hover text-secondary'}`}>
                      {g[0].author_kind === 'agent'
                        ? <Bot className="w-3.5 h-3.5" />
                        : (g[0].author_name || '?')[0].toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-medium text-primary truncate">{g[0].author_name || 'Someone'}</span>
                        {/* An agent is always labelled. A reader must never have
                            to guess whether a person or a bot wrote something. */}
                        {g[0].author_kind === 'agent' && <span className="text-3xs text-accent">agent</span>}
                        <span className="text-3xs text-tertiary">
                          {new Date(g[0].created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {g.map((m) => (
                        <div key={m.id} className="group flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm whitespace-pre-wrap break-words ${m.deleted ? 'text-tertiary italic' : 'text-secondary'}`}>
                              {m.deleted ? 'Message deleted' : m.body}
                              {m.edited_at && !m.deleted && <span className="text-3xs text-tertiary ml-1">(edited)</span>}
                            </p>
                            {!m.deleted && <ChatAttachments items={m.attachments} embeds={embeds} />}
                          </div>
                          {!m.deleted && m.author_privy === privy && (
                            <button
                              onClick={async () => {
                                if (privy && await confirmDialog('Delete this message?')) {
                                  await deleteMessage(privy, m.id);
                                  if (active) setMessages(await listMessages(privy, active));
                                }
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded text-tertiary hover:bg-surface-hover transition-opacity">
                              <Trash2 className="w-3 h-3 text-danger" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div ref={bottom} />
              </div>

              <div className="shrink-0 border-t border-subtle">
                {/* Already uploaded, waiting to send. Removing one here does not
                    delete the file — it is in the workspace either way, and a
                    silent delete on "cancel" would be a nasty surprise. */}
                {pending.length > 0 && (
                  <div className="flex flex-wrap gap-2 px-3 pt-3">
                    {pending.map((f) => (
                      <span key={f.id} className="inline-flex items-center gap-2 h-8 pl-1 pr-1.5 rounded-md ring-1 ring-subtle bg-surface text-xs text-secondary">
                        {f.mime.startsWith('image/')
                          // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived, off-origin
                          ? <img src={f.url} alt="" className="w-6 h-6 rounded object-cover" />
                          : <Paperclip className="w-3.5 h-3.5 text-tertiary ml-1" />}
                        <span className="truncate max-w-[10rem]">{f.name}</span>
                        <span className="text-2xs text-tertiary tabular-nums">{formatBytes(f.size)}</span>
                        <button onClick={() => setPending((p) => p.filter((x) => x.id !== f.id))}
                          aria-label={`Remove ${f.name}`}
                          className="p-0.5 rounded text-tertiary hover:text-primary hover:bg-surface-hover"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="p-3 flex items-end gap-2">
                  <input ref={filePick} type="file" multiple className="hidden"
                    onChange={(e) => { attach(e.target.files); e.target.value = ''; }} />
                  <button onClick={() => filePick.current?.click()} disabled={!privy || attaching}
                    aria-label="Attach a file" title="Attach a file"
                    className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg text-tertiary hover:text-primary hover:bg-surface-hover disabled:opacity-40">
                    {attaching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                  </button>
                  <textarea
                    value={body} onChange={(e) => setBody(e.target.value)} rows={1}
                    // Pasting a screenshot is how most images get shared, so it
                    // is wired alongside the picker rather than instead of it.
                    onPaste={(e) => { if (e.clipboardData?.files?.length) { e.preventDefault(); attach(e.clipboardData.files); } }}
                    onDrop={(e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); attach(e.dataTransfer.files); } }}
                    onKeyDown={(e) => {
                      // Enter sends, Shift+Enter breaks the line — the convention
                      // every chat app shares, so anything else feels broken.
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                    }}
                    className="input-field !h-auto py-2 resize-none flex-1 min-w-0 max-h-32"
                    placeholder={`Message #${channel.name}`} />
                  <Button variant="primary" onClick={send} disabled={sending || (!body.trim() && pending.length === 0)}>
                    {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
