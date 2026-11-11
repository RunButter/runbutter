'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send, X, Mail } from 'lucide-react';

/**
 * The visitor's side of the support chat (0131).
 *
 * Rendered three ways from ONE component: inside the iframe the embed script
 * opens on a customer's website (`embed`), as a full page at /support/<id> that
 * works as a "contact us" link and as the target of reply emails, and as the
 * live preview on the widget settings screen (`preview`, which sends nothing).
 *
 * The visitor's key is a token the server derived when the conversation began
 * (lib/support/token.ts). It lives in THIS origin's localStorage — inside the
 * iframe, so the host website can never read it — and a reply email carries it
 * in the link, so the thread opens on another device too. Every message is
 * rendered as text; nothing a visitor or a teammate types becomes HTML.
 */

export interface PublicWidget {
  id: string; title: string; greeting: string; color: string;
  ask_email: boolean; company: string | null; logo: string | null;
}
interface Msg { id: string; from: 'visitor' | 'team'; name: string | null; body: string; at: string }
interface Session { c: string; t: string }

const KEY = (id: string) => `rb-support:${id}`;
const readSession = (id: string): Session | null => {
  try { const v = JSON.parse(localStorage.getItem(KEY(id)) || 'null'); return v?.c && v?.t ? v : null; } catch { return null; }
};
const writeSession = (id: string, s: Session | null) => {
  try { if (s) localStorage.setItem(KEY(id), JSON.stringify(s)); else localStorage.removeItem(KEY(id)); } catch { /* private mode */ }
};

/** Black or white text on the brand colour, whichever reads. */
function onColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#18181b' : '#ffffff';
}

async function call(body: Record<string, any>): Promise<any> {
  const res = await fetch('/api/support/visitor', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(d.error || 'Something went wrong.'), { status: res.status });
  return d;
}

export default function SupportChat({ widget, embed = false, preview = false }: {
  widget: PublicWidget; embed?: boolean; preview?: boolean;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [hasEmail, setHasEmail] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(!embed);
  const last = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fg = onColor(widget.color);

  // Restore: a reply email's link first (it may be another device), else this browser.
  useEffect(() => {
    if (preview) { setReady(true); return; }
    const q = new URLSearchParams(window.location.search);
    const c = q.get('c'); const t = q.get('t');
    if (c && t) {
      writeSession(widget.id, { c, t });
      // The token must not linger in the address bar or the history.
      q.delete('c'); q.delete('t');
      window.history.replaceState(null, '', window.location.pathname + (q.toString() ? `?${q}` : ''));
    }
    setSession(readSession(widget.id));
    setReady(true);
  }, [widget.id, preview]);

  const poll = useCallback(async () => {
    if (!session || preview) return;
    try {
      const d = await call({ action: 'poll', conversation: session.c, token: session.t, after: last.current });
      setHasEmail(!!d.email);
      const fresh: Msg[] = d.messages || [];
      if (fresh.length) {
        last.current = fresh[fresh.length - 1].at;
        setMessages((m) => {
          const seen = new Set(m.map((x) => x.id));
          const add = fresh.filter((x) => !seen.has(x.id));
          // Tell the launcher on the host page there is something new while closed.
          const fromTeam = add.filter((x) => x.from === 'team').length;
          if (embed && fromTeam && !open) window.parent?.postMessage({ type: 'rb-support', unread: fromTeam }, '*');
          return [...m, ...add];
        });
      }
    } catch (e: any) {
      // A conversation that no longer opens (deleted, or the server key
      // rotated) — start over rather than polling a 404 forever.
      if (e.status === 404) { writeSession(widget.id, null); setSession(null); setMessages([]); last.current = null; }
    }
  }, [session, preview, embed, open, widget.id]);

  useEffect(() => { last.current = null; setMessages([]); poll(); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!session || preview) return;
    // Quick while somebody is looking at it, slow while it is folded away.
    const t = setInterval(() => { if (document.visibilityState === 'visible') poll(); }, open ? 4000 : 20000);
    return () => clearInterval(t);
  }, [session, preview, open, poll]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

  // The embed script tells the iframe when its panel opens or closes.
  useEffect(() => {
    if (!embed) return;
    const on = (e: MessageEvent) => {
      if (e.source !== window.parent || e.data?.type !== 'rb-support-open') return;
      setOpen(!!e.data.open);
      if (e.data.open) poll();
    };
    window.addEventListener('message', on);
    window.parent?.postMessage({ type: 'rb-support-ready', active: !!readSession(widget.id) }, '*');
    return () => window.removeEventListener('message', on);
  }, [embed, poll, widget.id]);

  const start = async () => {
    if (preview) return;
    setBusy(true); setError('');
    try {
      const d = await call({ action: 'start', widget: widget.id, name, email, body, page: embed ? document.referrer : window.location.href });
      const s = { c: d.conversation, t: d.token };
      writeSession(widget.id, s);
      setBody('');
      setSession(s);
      if (embed) window.parent?.postMessage({ type: 'rb-support-active' }, '*');
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  const send = async () => {
    if (!session || !body.trim() || preview) return;
    const text = body;
    setBusy(true); setError(''); setBody('');
    try { await call({ action: 'send', conversation: session.c, token: session.t, body: text }); await poll(); }
    catch (e: any) { setError(e.message); setBody(text); }
    setBusy(false);
  };

  const identify = async () => {
    if (!session) return;
    setBusy(true); setError('');
    try { await call({ action: 'identify', conversation: session.c, token: session.t, name, email }); setHasEmail(true); }
    catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  const input = 'w-full h-10 px-3 rounded-lg bg-surface ring-1 ring-subtle text-sm text-primary outline-none focus:ring-2 focus:ring-accent/30 placeholder:text-tertiary';

  return (
    <div className={`flex flex-col bg-surface text-primary ${embed ? 'h-[100dvh]' : 'h-[min(680px,calc(100dvh-2rem))] rounded-2xl ring-1 ring-subtle shadow-popover overflow-hidden'}`}>
      <header className="shrink-0 px-4 py-3.5 flex items-center gap-3" style={{ background: widget.color, color: fg }}>
        {widget.logo
          ? <img src={widget.logo} alt="" className="w-8 h-8 rounded-lg object-contain bg-white/90 p-0.5" />
          : <span className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-semibold" style={{ background: fg === '#ffffff' ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.08)' }}>{(widget.company || widget.title || '?')[0]}</span>}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{widget.title}</div>
          {widget.company && <div className="text-xs opacity-80 truncate">{widget.company}</div>}
        </div>
        {embed && (
          <button onClick={() => window.parent?.postMessage({ type: 'rb-support-close' }, '*')} aria-label="Close chat"
            className="p-1.5 rounded-md opacity-80 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        )}
      </header>

      {!ready ? (
        <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-tertiary" /></div>
      ) : !session ? (
        <form className="flex-1 overflow-y-auto p-4 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); start(); }}>
          <div className="rounded-2xl rounded-tl-md bg-surface-sunken px-3.5 py-2.5 text-sm text-primary whitespace-pre-wrap">{widget.greeting}</div>
          <div className="mt-auto flex flex-col gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" className={input} autoComplete="name" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required={widget.ask_email}
              placeholder={widget.ask_email ? 'Email — so we can reply' : 'Email (optional)'} aria-label="Email" className={input} autoComplete="email" />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} required placeholder="How can we help?" aria-label="Message"
              className={`${input} h-auto py-2.5 resize-none`} />
            {error && <p className="text-xs text-danger">{error}</p>}
            <button type="submit" disabled={busy || preview || !body.trim()}
              className="h-10 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
              style={{ background: widget.color, color: fg }}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5">
            <div className="rounded-2xl rounded-tl-md bg-surface-sunken px-3.5 py-2.5 text-sm text-primary whitespace-pre-wrap self-start max-w-[85%]">{widget.greeting}</div>
            {messages.map((m) => (
              <div key={m.id} className={`max-w-[85%] ${m.from === 'visitor' ? 'self-end' : 'self-start'}`}>
                <div className={`px-3.5 py-2 text-sm whitespace-pre-wrap break-words rounded-2xl ${m.from === 'visitor' ? 'rounded-br-md' : 'rounded-bl-md bg-surface-sunken text-primary'}`}
                  style={m.from === 'visitor' ? { background: widget.color, color: fg } : undefined}>
                  {m.body}
                </div>
                {m.from === 'team' && m.name && <div className="mt-0.5 text-3xs text-tertiary">{m.name}</div>}
              </div>
            ))}
            {messages.length > 0 && messages[messages.length - 1].from === 'visitor' && (
              <p className="self-center text-2xs text-tertiary">Sent — we will reply here{hasEmail ? ' and by email' : ''}.</p>
            )}
            <div ref={endRef} />
          </div>

          {!hasEmail && messages.length > 0 && (
            <form className="shrink-0 mx-3 mb-2 rounded-xl ring-1 ring-subtle bg-surface-sunken p-2.5 flex items-center gap-2"
              onSubmit={(e) => { e.preventDefault(); identify(); }}>
              <Mail className="w-4 h-4 text-tertiary shrink-0" />
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="Get the reply by email" aria-label="Your email"
                className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-tertiary" />
              <button type="submit" disabled={busy} className="text-xs font-semibold text-secondary hover:text-primary">Save</button>
            </form>
          )}

          <form className="shrink-0 border-t border-subtle p-2.5 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={1} placeholder="Write a message…" aria-label="Message"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              className="flex-1 min-w-0 max-h-32 resize-none bg-transparent text-sm text-primary outline-none placeholder:text-tertiary px-1.5 py-2" />
            <button type="submit" disabled={busy || !body.trim()} aria-label="Send"
              className="w-9 h-9 shrink-0 rounded-lg inline-flex items-center justify-center disabled:opacity-40"
              style={{ background: widget.color, color: fg }}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
          {error && <p className="shrink-0 px-4 pb-2 text-xs text-danger">{error}</p>}
        </>
      )}

      {!embed && (
        <a href="https://runbutter.app" target="_blank" rel="noreferrer noopener"
          className="shrink-0 py-2 text-center text-3xs text-tertiary hover:text-secondary border-t border-subtle">
          Chat by RunButter
        </a>
      )}
    </div>
  );
}
