'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import {
  Sparkles, ArrowUp, Loader2, Check, X, PanelRightClose, PanelRightOpen,
  Plus, MessageSquare, Trash2, ChevronDown, AtSign, Wrench, AlertCircle,
} from 'lucide-react';
import BorderBeam from '@/components/ui/BorderBeam';
import { getWorkspace } from '@/lib/crm/data';
import { useNav } from '@/lib/crm/nav';
import {
  listThreads, loadThread, newThread, setThread, removeThread, send, approve, pollRun,
  describeCall,
  type CopilotThread, type CopilotThreadRow, type CopilotMessage, type CopilotStep,
} from '@/lib/crm/copilot';

/**
 * The Copilot dock (0102).
 *
 * WHY A DOCK AND NOT A MODAL. The point of a copilot is that it is looking at
 * the same screen you are — "chase these", "add her to it", "why is this one
 * red" are only answerable that way. A modal covers the thing being discussed,
 * which turns every one of those sentences back into a description of what you
 * can no longer see.
 *
 * It is also what fixes the layout complaint that prompted it: app pages cap at
 * max-w-5xl, so on a wide screen the content sat left with a band of dead
 * canvas beside it. The dock is that band.
 *
 * WIDTH IS THE USER'S AND IS REMEMBERED. Closed is also remembered — a docked
 * panel that reopens itself on every navigation is the single most annoying
 * thing a panel can do.
 */

const MIN_W = 320;
const MAX_W = 640;
const KEY_W = 'rb-copilot-w';
const KEY_OPEN = 'rb-copilot-open';

export default function CopilotPanel() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const pathname = usePathname();
  const nav = useNav(privy, !!privy);

  const [ws, setWs] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(400);
  const [threads, setThreads] = useState<CopilotThreadRow[] | null>(null);
  const [thread, setThread_] = useState<CopilotThread | null>(null);
  const [showThreads, setShowThreads] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [liveSteps, setLiveSteps] = useState<CopilotStep[]>([]);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Restore the dock's own state before first paint of the panel, so it does
  // not flash open then closed. Defaults to open only on a screen wide enough
  // that a 400px dock still leaves the page its full measure.
  useEffect(() => {
    const w = Number(localStorage.getItem(KEY_W));
    if (w >= MIN_W && w <= MAX_W) setWidth(w);
    const o = localStorage.getItem(KEY_OPEN);
    setOpen(o === null ? window.innerWidth >= 1536 : o === '1');
  }, []);

  useEffect(() => { if (privy) getWorkspace(privy).then((w) => setWs(w?.id ?? null)).catch(() => {}); }, [privy]);

  const refreshThreads = useCallback(async () => {
    if (!privy || !ws) return;
    const rows = await listThreads(privy, ws);
    // null means the RPC is missing, i.e. 0102 has not been applied. Said once,
    // rather than as an error on every action.
    if (rows === null) { setUnavailable(true); return; }
    setUnavailable(false);
    setThreads(rows);
  }, [privy, ws]);

  useEffect(() => { if (open) refreshThreads(); }, [open, refreshThreads]);

  // The page the person is on, in words they would recognise. Resolved from the
  // nav rather than from the path, so the copilot is told "Invoices" and not
  // "/objects/invoices" — and so a renamed built-in (0097) reads as whatever
  // this workspace calls it.
  const pageLabel = (() => {
    for (const g of nav) for (const it of g.items) if (it.href === pathname) return it.label;
    return '';
  })();
  const page = { path: pathname, label: pageLabel };

  const scrollDown = () => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };
  useEffect(scrollDown, [thread?.messages.length, liveSteps.length, busy]);

  const openThread = async (id: string) => {
    if (!privy) return;
    setShowThreads(false); setError(''); setLiveSteps([]);
    const t = await loadThread(privy, id);
    setThread_(t);
    scrollDown();
  };

  const startThread = async () => {
    if (!privy || !ws) return;
    const id = await newThread(privy, ws, thread?.autonomy ?? 'suggest');
    if (!id) { setUnavailable(true); return; }
    setThread_({ id, title: '', autonomy: thread?.autonomy ?? 'suggest', messages: [] });
    setShowThreads(false); setLiveSteps([]); setError('');
    refreshThreads();
    taRef.current?.focus();
  };

  const submit = async () => {
    const msg = input.trim();
    if (!msg || !privy || !ws || busy) return;

    // A thread is created lazily on the first message, so opening the panel and
    // closing it again does not litter the list with empty conversations.
    let t = thread;
    if (!t) {
      const id = await newThread(privy, ws, 'suggest');
      if (!id) { setUnavailable(true); return; }
      t = { id, title: '', autonomy: 'suggest', messages: [] };
      setThread_(t);
    }

    setInput(''); setError(''); setLiveSteps([]); setBusy(true);
    // Shown immediately, before the round trip. The server writes the same
    // message first thing, so this optimistic turn is replaced by the real one
    // on reload rather than duplicating it.
    const optimistic: CopilotMessage = {
      id: `tmp-${Date.now()}`, role: 'user', content: msg, page_path: pathname,
      created_at: new Date().toISOString(), run_id: null, status: null, steps: null, proposed: null,
    };
    setThread_({ ...t, messages: [...t.messages, optimistic] });

    const runId = crypto.randomUUID();
    // Poll the run for steps while the request is open. The response does not
    // arrive until the whole loop finishes, which for a twenty-step answer is a
    // long time to show nothing at all.
    let stop = false;
    const poll = async () => {
      while (!stop) {
        await new Promise((r) => setTimeout(r, 900));
        if (stop) break;
        const live = await pollRun(privy, ws, runId);
        if (live?.steps?.length) setLiveSteps(live.steps);
      }
    };
    poll();

    const res = await send(privy, ws, t.id, msg, page, runId);
    stop = true;
    setBusy(false);
    if (res.error) { setError(res.error); }
    setLiveSteps([]);
    await openThread(t.id);
    refreshThreads();
  };

  const doApprove = async (runId: string) => {
    if (!privy || !ws || !thread) return;
    setBusy(true);
    const res = await approve(privy, ws, runId);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    await openThread(thread.id);
  };

  const flipAutonomy = async () => {
    if (!privy || !thread) return;
    const next = thread.autonomy === 'auto' ? 'suggest' : 'auto';
    setThread_({ ...thread, autonomy: next });
    await setThread(privy, thread.id, { autonomy: next });
  };

  // Drag to resize. Pointer events rather than mouse, so a trackpad drag and a
  // touch drag behave the same, and capture so the drag survives the pointer
  // leaving the 4px handle.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => {
      const next = Math.min(MAX_W, Math.max(MIN_W, window.innerWidth - ev.clientX));
      setWidth(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setWidth((w) => { localStorage.setItem(KEY_W, String(w)); return w; });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const toggle = (v: boolean) => { setOpen(v); localStorage.setItem(KEY_OPEN, v ? '1' : '0'); };

  if (!ready || !privy) return null;

  if (!open) {
    return (
      <button
        onClick={() => toggle(true)}
        title="Open copilot"
        className="fixed bottom-5 right-5 z-30 h-11 w-11 rounded-full bg-inverse text-inverse-fg shadow-card ring-1 ring-subtle flex items-center justify-center hover:opacity-90"
      >
        <Sparkles className="w-4 h-4" />
      </button>
    );
  }

  return (
    <aside
      className="hidden lg:flex shrink-0 h-full flex-col bg-canvas border-l border-subtle relative"
      style={{ width }}
    >
      <div
        onPointerDown={startResize}
        title="Drag to resize"
        className="absolute left-0 top-0 bottom-0 w-1 -ml-0.5 cursor-col-resize hover:bg-accent/40 z-10"
      />

      <header className="h-12 shrink-0 flex items-center gap-1.5 px-3 border-b border-subtle">
        <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
        <button
          onClick={() => { setShowThreads((s) => !s); refreshThreads(); }}
          className="min-w-0 flex-1 flex items-center gap-1 text-left text-sm font-medium text-primary hover:text-secondary"
        >
          <span className="truncate">{thread?.title || 'Copilot'}</span>
          <ChevronDown className="w-3 h-3 shrink-0 text-tertiary" />
        </button>
        <button onClick={startThread} title="New conversation" className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover hover:text-secondary">
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => toggle(false)} title="Hide copilot" className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover hover:text-secondary">
          <PanelRightClose className="w-3.5 h-3.5" />
        </button>
      </header>

      {showThreads && (
        <div className="border-b border-subtle max-h-64 overflow-auto">
          {threads?.length ? threads.map((t) => (
            <div key={t.id} className="group flex items-center gap-1.5 px-3 h-9 hover:bg-surface-hover">
              <MessageSquare className="w-3 h-3 text-tertiary shrink-0" />
              <button onClick={() => openThread(t.id)} className="min-w-0 flex-1 text-left text-xs text-secondary truncate">
                {t.title || 'Untitled'}
              </button>
              <button
                onClick={async () => { await removeThread(privy, t.id); if (thread?.id === t.id) setThread_(null); refreshThreads(); }}
                className="p-1 rounded text-tertiary opacity-0 group-hover:opacity-100 hover:text-danger"
                title="Delete"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )) : <p className="px-3 py-3 text-xs text-tertiary">No conversations yet.</p>}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-auto px-3 py-3 space-y-3">
        {unavailable ? (
          <Notice>The copilot needs migration <span className="font-mono">0102</span>. Run it and reload.</Notice>
        ) : !thread || thread.messages.length === 0 ? (
          <Empty label={pageLabel} onPick={(s) => { setInput(s); taRef.current?.focus(); }} />
        ) : (
          thread.messages.map((m) => <Turn key={m.id} m={m} onApprove={doApprove} busy={busy} />)
        )}

        {busy && <Working steps={liveSteps} />}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>

      <div className="shrink-0 p-3 pt-0">
        <Composer
          value={input} onChange={setInput} onSubmit={submit} busy={busy}
          taRef={taRef} pageLabel={pageLabel}
          autonomy={thread?.autonomy ?? 'suggest'} onFlip={thread ? flipAutonomy : undefined}
        />
      </div>
    </aside>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

function Notice({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'danger' }) {
  return (
    <div className={`flex items-start gap-1.5 rounded-lg px-2.5 py-2 text-xs ${
      tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-surface-sunken text-secondary'}`}>
      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
      <span>{children}</span>
    </div>
  );
}

function Empty({ label, onPick }: { label: string; onPick: (s: string) => void }) {
  // Suggestions that use the CURRENT SCREEN, because a generic starter list is
  // the part of every assistant nobody clicks.
  const here = label ? `What should I know about ${label.toLowerCase()} right now?` : 'What changed in the workspace this week?';
  const picks = [here, 'Which clients owe us money?', 'Draft a follow-up to the oldest open deal'];
  return (
    <div className="pt-6">
      <p className="text-sm text-secondary mb-1">Ask about your workspace.</p>
      <p className="text-xs text-tertiary mb-4">
        It can read and change records{label ? `, and it knows you are on ${label}` : ''}. Changes need your approval unless you switch to Auto.
      </p>
      <div className="space-y-1.5">
        {picks.map((p) => (
          <button key={p} onClick={() => onPick(p)}
            className="w-full text-left text-xs text-secondary rounded-lg ring-1 ring-subtle px-2.5 py-2 hover:bg-surface-hover">
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function Turn({ m, onApprove, busy }: { m: CopilotMessage; onApprove: (id: string) => void; busy: boolean }) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-inverse text-inverse-fg px-3 py-1.5 text-sm whitespace-pre-wrap break-words">
          {m.content}
        </div>
      </div>
    );
  }
  const steps = (m.steps || []).filter((s) => s.type === 'tool');
  const proposed = m.proposed || [];
  return (
    <div className="space-y-2">
      {steps.length > 0 && <Steps steps={steps} />}
      {m.content && (
        <div className="text-sm text-primary whitespace-pre-wrap break-words leading-relaxed">{m.content}</div>
      )}
      {m.status === 'awaiting_approval' && proposed.length > 0 && m.run_id && (
        <div className="rounded-xl ring-1 ring-subtle bg-surface p-2.5 space-y-2">
          <div className="text-2xs font-medium uppercase tracking-wider text-tertiary">
            {proposed.length} change{proposed.length === 1 ? '' : 's'} waiting for you
          </div>
          <ul className="space-y-1">
            {proposed.map((p, i) => (
              <li key={i} className="text-xs text-secondary flex items-start gap-1.5">
                <span className="text-tertiary mt-px">·</span>
                <span>{describeCall(p.name, p.args)}</span>
              </li>
            ))}
          </ul>
          <div className="flex gap-1.5 pt-0.5">
            <button
              onClick={() => onApprove(m.run_id!)} disabled={busy}
              className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md text-xs font-semibold bg-inverse text-inverse-fg hover:opacity-90 disabled:opacity-40"
            >
              <Check className="w-3 h-3" /> Apply
            </button>
            {/* Discard is deliberately not a button. Nothing has happened yet —
                a proposal that is never approved simply stays unapplied, and a
                "Discard" that writes a row to say a thing was not done is a
                worse record than the run already is. */}
            <span className="self-center text-3xs text-tertiary">Ignore to leave it undone</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Steps({ steps }: { steps: CopilotStep[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-2xs text-tertiary hover:text-secondary">
        <Wrench className="w-3 h-3" />
        {steps.length} step{steps.length === 1 ? '' : 's'}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 border-l border-subtle pl-2 ml-1">
          {steps.map((s, i) => (
            <li key={i} className="text-2xs text-tertiary">{describeCall(s.name || '', s.args)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What it is doing right now, from the live run (0095). */
function Working({ steps }: { steps: CopilotStep[] }) {
  const last = [...steps].reverse().find((s) => s.type === 'tool');
  return (
    <div className="flex items-center gap-1.5 text-xs text-tertiary">
      <Loader2 className="w-3 h-3 animate-spin" />
      {last ? describeCall(last.name || '', last.args) : 'Thinking'}…
    </div>
  );
}

function Composer({
  value, onChange, onSubmit, busy, taRef, pageLabel, autonomy, onFlip,
}: {
  value: string; onChange: (s: string) => void; onSubmit: () => void; busy: boolean;
  taRef: React.RefObject<HTMLTextAreaElement>; pageLabel: string;
  autonomy: 'suggest' | 'auto'; onFlip?: () => void;
}) {
  // Grows with the text to a ceiling, so a long instruction is visible while
  // being written and the panel never loses its message list to the box.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, [value, taRef]);

  // `w-full` is load-bearing, not decoration. BorderBeam wraps its children in
  // a flex row, so without it the composer sizes to its CONTENT the moment the
  // beam turns on — measured at 375px idle and 214px busy, i.e. the box visibly
  // shrank every time you sent a message. A no-op in the un-beamed branch,
  // which is why it lives on the box rather than on one of the two callers.
  const box = (
    <div className="w-full rounded-2xl ring-1 ring-subtle bg-surface shadow-sm overflow-hidden">
      {pageLabel && (
        <div className="flex items-center gap-1 px-3 pt-2 text-3xs text-tertiary">
          <AtSign className="w-2.5 h-2.5" />
          <span className="truncate">{pageLabel}</span>
        </div>
      )}
      <textarea
        ref={taRef}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter breaks the line. The other way round is
          // correct for a document and wrong for a chat.
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); }
        }}
        placeholder="Ask, or tell it what to do…"
        className="w-full resize-none bg-transparent px-3 py-2 text-sm text-primary placeholder:text-tertiary outline-none"
      />
      <div className="flex items-center gap-1.5 px-2 pb-2">
        <button
          onClick={onFlip}
          disabled={!onFlip}
          title={autonomy === 'auto'
            ? 'Auto — changes are made straight away'
            : 'Suggest — changes wait for your approval'}
          className={`h-7 px-2 rounded-lg text-2xs font-semibold ring-1 disabled:opacity-50 ${
            autonomy === 'auto'
              ? 'ring-warning/40 text-warning bg-warning/10'
              : 'ring-subtle text-secondary hover:bg-surface-hover'}`}
        >
          {autonomy === 'auto' ? 'Auto' : 'Suggest'}
        </button>
        <div className="flex-1" />
        <button
          onClick={onSubmit}
          disabled={busy || !value.trim()}
          className="h-7 w-7 inline-flex items-center justify-center rounded-lg bg-inverse text-inverse-fg disabled:opacity-30 hover:opacity-90"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUp className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );

  // The beam runs ONLY while a turn is in flight. A permanent animation beside
  // the thing you are trying to read is decoration that costs attention every
  // second it is on screen; as a busy state it is doing a job.
  return busy
    ? <BorderBeam size="sm" colorVariant="colorful" strength={0.6} className="flex w-full">{box}</BorderBeam>
    : box;
}
