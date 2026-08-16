'use client';

import { useState } from 'react';
import { Zap, MessageCircle, Database, Code2, X, ExternalLink } from 'lucide-react';
import { connectorsByGroup, looksWrong, type Connector } from '@/lib/crm/connectors';

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

export default function ConnectorPicker({ onSave, onClose, canEdit }: {
  onSave: (label: string, url: string) => Promise<void>;
  onClose: () => void;
  canEdit: boolean;
}) {
  const [picked, setPicked] = useState<Connector | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const warn = picked ? looksWrong(picked, url) : null;

  const save = async () => {
    if (!picked || !url.trim()) return;
    setBusy(true);
    await onSave(picked.name, url.trim());
    setBusy(false);
  };

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

          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="mt-3 flex flex-col gap-2">
            <label className="block">
              <span className="text-2xs text-secondary">Webhook URL</span>
              <input value={url} onChange={(e) => setUrl(e.target.value)} autoFocus type="url"
                placeholder="https://…" aria-label={`${picked.name} webhook URL`}
                className="mt-1 w-full h-9 px-3 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary font-mono" />
            </label>
            {warn && <p className="text-2xs text-warning">{warn}</p>}
            <div className="flex items-center gap-2">
              <button type="submit" disabled={!url.trim() || busy || !canEdit}
                className="h-8 px-3 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
                {busy ? 'Connecting…' : 'Connect'}
              </button>
              <span className="text-3xs text-tertiary inline-flex items-center gap-1">
                Test it right after with the Test button <ExternalLink className="w-3 h-3" />
              </span>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
