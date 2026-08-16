'use client';

import { useState } from 'react';
import { Zap, MessageCircle, Database, Code2, X, Check, Loader2, Send } from 'lucide-react';
import {
  connectorsByGroup, looksWrong, NOTIFY_RECIPES, recipeAutomation,
  type Connector,
} from '@/lib/crm/connectors';

/**
 * Pick an app, paste its webhook URL, done.
 *
 * The old flow was a blank Add form and a sentence saying "Slack / Zapier /
 * Make", which assumes you know where each of those hides its Incoming Webhook
 * screen. Every one of these connections was already possible; what was missing
 * was the instruction.
 *
 * ── IT SAYS WHEN A CONNECTOR IS INDIRECT ────────────────────────────────────
 * Slack, Discord, Teams and Telegram each demand their own request body, and we
 * send a signed RunButter envelope. So they are listed WITH that fact and with
 * what to do instead, rather than offered as one-click and left to fail with a
 * 400 nobody can read. A connector that silently does not work is worse than
 * one that is not offered — the same rule the agent tool surface follows about
 * saying no honestly.
 *
 * The URL hint is a HINT and never blocks. Self-hosted n8n, a corporate relay
 * and a proxy are all legitimate and match no hostname worth hard-coding.
 */

const GROUP_ICON: Record<string, any> = {
  Automation: Zap, Chat: MessageCircle, Data: Database, Custom: Code2,
};

export default function ConnectorPicker({ onSave, onRecipes, onTest, onClose, canEdit }: {
  /** Creates the connection and returns its id, or null if it failed. */
  onSave: (label: string, url: string) => Promise<string | null>;
  /** Creates one automation per chosen recipe, wired to that connection. */
  onRecipes: (connectionId: string, appName: string, ids: string[]) => Promise<void>;
  onTest: (connectionId: string) => Promise<{ ok: boolean; text: string }>;
  onClose: () => void;
  canEdit: boolean;
}) {
  const [picked, setPicked] = useState<Connector | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Step three exists because step two on its own did nothing. Two are ticked
  // by default: an empty list would leave somebody exactly where the old flow
  // did, with a connection and no reason for it to ever fire.
  const [connId, setConnId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(NOTIFY_RECIPES.filter((r) => r.common).map((r) => r.id)));
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [done, setDone] = useState(false);

  const warn = picked ? looksWrong(picked, url) : null;

  const save = async () => {
    if (!picked || !url.trim()) return;
    setBusy(true); setErr('');
    const id = await onSave(picked.name, url.trim());
    setBusy(false);
    if (!id) { setErr('That connection could not be saved. Check the URL is public and https.'); return; }
    setConnId(id);
  };

  const finish = async () => {
    if (!connId || !picked) return;
    setBusy(true);
    await onRecipes(connId, picked.name, [...chosen]);
    setBusy(false);
    setDone(true);
  };

  const runTest = async () => {
    if (!connId) return;
    setBusy(true);
    setTest(await onTest(connId));
    setBusy(false);
  };

  const toggle = (id: string) =>
    setChosen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="card-surface p-4 mb-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-primary">Connect an app</h3>
          <p className="mt-0.5 text-2xs text-tertiary">
            Each one is an outgoing webhook your automations can fire. Nothing here needs an account
            with us or a client secret — you paste a URL the app gives you.
          </p>
        </div>
        <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover">
          <X className="w-4 h-4" />
        </button>
      </div>

      {!picked ? (
        <div className="mt-3 flex flex-col gap-3">
          {connectorsByGroup().map((g) => {
            const Icon = GROUP_ICON[g.group] || Code2;
            return (
              <div key={g.group}>
                <p className="text-3xs font-semibold uppercase tracking-wide text-tertiary inline-flex items-center gap-1.5">
                  <Icon className="w-3 h-3" /> {g.group}
                </p>
                <div className="mt-1.5 grid sm:grid-cols-2 gap-1.5">
                  {g.items.map((c) => (
                    <button key={c.id} onClick={() => { setPicked(c); setUrl(''); }} disabled={!canEdit}
                      className="text-left rounded-lg bg-surface-sunken ring-1 ring-subtle p-2.5 hover:bg-surface-hover disabled:opacity-40">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-primary">{c.name}</span>
                        {!c.direct && (
                          <span className="text-3xs text-warning bg-warning/10 rounded px-1 py-0.5">via a relay</span>
                        )}
                      </div>
                      <p className="text-3xs text-tertiary mt-0.5">{c.blurb}</p>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-3">
          <button onClick={() => setPicked(null)} className="text-2xs text-tertiary hover:text-primary">← all apps</button>
          <h4 className="mt-2 text-sm font-medium text-primary">{picked.name}</h4>
          <p className="mt-0.5 text-2xs text-secondary">{picked.blurb}</p>

          <div className="mt-3 rounded-lg bg-surface-sunken ring-1 ring-subtle p-3">
            <p className="text-3xs font-semibold uppercase tracking-wide text-tertiary">Where to get the URL</p>
            <p className="mt-1 text-2xs text-secondary">{picked.where}</p>
          </div>

          {!picked.direct && (
            <div className="mt-2 rounded-lg bg-warning/10 ring-1 ring-warning/30 p-3">
              <p className="text-2xs text-secondary">
                <b className="text-primary">This one needs a relay.</b> {picked.note}
              </p>
            </div>
          )}
          {picked.direct && picked.note && (
            <p className="mt-2 text-2xs text-tertiary">{picked.note}</p>
          )}

          {!connId ? (
            <form onSubmit={(e) => { e.preventDefault(); save(); }} className="mt-3 flex flex-col gap-2">
              <label className="block">
                <span className="text-2xs text-secondary">Webhook URL</span>
                <input value={url} onChange={(e) => setUrl(e.target.value)} autoFocus type="url"
                  placeholder="https://…" aria-label={`${picked.name} webhook URL`}
                  className="mt-1 w-full h-9 px-3 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary font-mono" />
              </label>
              {warn && <p className="text-2xs text-warning">{warn}</p>}
              {err && <p className="text-2xs text-danger">{err}</p>}
              <button type="submit" disabled={!url.trim() || busy || !canEdit}
                className="self-start h-8 px-3 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
                {busy ? 'Connecting…' : 'Connect'}
              </button>
            </form>
          ) : done ? (
            <div className="mt-3 rounded-lg bg-success/10 ring-1 ring-success/30 p-3">
              <p className="text-sm text-primary inline-flex items-center gap-1.5">
                <Check className="w-4 h-4 text-success" /> {picked.name} is connected.
              </p>
              <p className="mt-1 text-2xs text-secondary">
                {chosen.size === 0
                  ? 'No alerts switched on — you can add them any time in Automate → Automations.'
                  : `${chosen.size} alert${chosen.size === 1 ? '' : 's'} switched on. Edit them in Automate → Automations.`}
              </p>
              <button onClick={onClose} className="mt-2 h-8 px-3 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">
                Done
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <p className="text-sm text-primary inline-flex items-center gap-1.5">
                <Check className="w-4 h-4 text-success" /> Connected. Now: what should it tell you about?
              </p>
              <p className="mt-0.5 text-2xs text-tertiary">
                Each one becomes an ordinary automation you can edit or switch off later.
              </p>

              <div className="mt-2 grid sm:grid-cols-2 gap-1.5">
                {NOTIFY_RECIPES.map((r) => (
                  <label key={r.id}
                    className={`flex items-start gap-2 rounded-lg p-2.5 cursor-pointer ring-1 ${chosen.has(r.id)
                      ? 'bg-accent/5 ring-accent/30' : 'bg-surface-sunken ring-subtle hover:bg-surface-hover'}`}>
                    <input type="checkbox" checked={chosen.has(r.id)} onChange={() => toggle(r.id)}
                      className="mt-0.5 h-3.5 w-3.5 accent-[hsl(var(--accent))]" />
                    <span className="min-w-0">
                      <span className="block text-xs text-primary">{r.label}</span>
                      <span className="block text-3xs text-tertiary">{r.detail}</span>
                    </span>
                  </label>
                ))}
              </div>

              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <button onClick={finish} disabled={busy}
                  className="h-8 px-3 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
                  {busy ? 'Setting up…' : chosen.size ? `Turn on ${chosen.size}` : 'Skip for now'}
                </button>
                {/* Testing here rather than back in the list: the one moment
                    somebody wants proof it works is the moment they paste the
                    URL, not after they have navigated away. */}
                <button onClick={runTest} disabled={busy}
                  className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm text-secondary ring-1 ring-subtle hover:bg-surface-sunken disabled:opacity-40">
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send a test
                </button>
                {test && (
                  <span className={`text-2xs font-semibold ${test.ok ? 'text-success' : 'text-danger'}`}>{test.text}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
