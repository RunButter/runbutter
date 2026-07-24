'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy, getAccessToken } from '@privy-io/react-auth';
import { MessageCircle, Loader2, Plus, X, Trash2, Check, Send, Info } from 'lucide-react';
import { getWorkspace, type WorkspaceContext } from '@/lib/crm/data';
import { rpc } from '@/lib/rpc';
import { useDialog } from '@/components/ui/Dialog';

interface Channel { id: string; platform: string; webhook_token: string; has_token: boolean; allowed_senders: string[]; autonomy: 'suggest' | 'auto'; enabled: boolean }

export default function AssistantPage() {
  const { confirm: confirmDialog, notify } = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [ws, setWs] = useState<WorkspaceContext | null>(null);
  const [rows, setRows] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Channel> | null>(null);

  const canManage = ws?.role === 'owner' || ws?.role === 'admin';

  const load = useCallback(async () => {
    if (!privy) { setLoading(false); return; }
    const w = await getWorkspace(privy);
    setWs(w);
    if (w) { const { data } = await rpc('get_assistant_channels', { p_privy: privy, p_workspace: w.id }); setRows(Array.isArray(data) ? data : []); }
    setLoading(false);
  }, [privy]);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  const remove = async (c: Channel) => {
    if (!privy || !ws) return;
    if (!await confirmDialog({ title: 'Disconnect this bot?', body: 'The bot stops responding immediately.', danger: true, confirmLabel: 'Disconnect' })) return;
    await rpc('delete_assistant_channel', { p_privy: privy, p_workspace: ws.id, p_id: c.id });
    load();
  };

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-subtle">
        <h1 className="text-sm font-semibold text-primary flex items-center gap-2"><MessageCircle className="w-4 h-4 text-accent" /> Assistant</h1>
        <span className="text-[11px] font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{rows.length}</span>
        {canManage && (
          <button onClick={() => setEditing({ platform: 'telegram', autonomy: 'auto', enabled: true, allowed_senders: [] })}
            className="ml-auto h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm">
            <Plus className="w-3.5 h-3.5" /> Connect a bot
          </button>
        )}
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl space-y-4">
          <p className="text-[13px] text-secondary -mt-1">
            Chat with your workspace from Telegram — ask questions and create offers, invoices or people right from a DM. Runs on your workspace AI key; only people you allow can use it.
          </p>

          {loading ? (
            <div className="h-32 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-subtle p-12 text-center">
              <MessageCircle className="w-8 h-8 text-tertiary mx-auto mb-3" />
              <h3 className="text-sm font-medium text-secondary">No assistant connected</h3>
              <p className="text-[12px] text-tertiary mt-1">Connect a Telegram bot to chat with your workspace.</p>
            </div>
          ) : (
            <div className="rounded-xl ring-1 ring-subtle bg-surface divide-y divide-subtle">
              {rows.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${c.enabled && c.has_token ? 'bg-success' : 'bg-tertiary'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-primary capitalize">{c.platform} {!c.has_token && <span className="text-warning font-normal text-[12px]">· token needed</span>}</div>
                    <div className="text-[12px] text-tertiary truncate">
                      {c.allowed_senders.length} allowed sender{c.allowed_senders.length === 1 ? '' : 's'} · {c.autonomy === 'auto' ? 'can make changes' : 'read-only'}
                    </div>
                  </div>
                  {canManage && <>
                    <button onClick={() => setEditing(c)} className="h-7 px-2.5 text-[12px] font-semibold rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-sunken">Edit</button>
                    <button onClick={() => remove(c)} aria-label="Disconnect" className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10"><Trash2 className="w-4 h-4" /></button>
                  </>}
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-subtle bg-surface-sunken p-3 text-[12px] text-secondary">
            <div className="flex items-center gap-1.5 font-semibold text-primary mb-1"><Info className="w-3.5 h-3.5 text-accent" /> Slack &amp; WhatsApp</div>
            Slack is next (create an app + signing secret). WhatsApp needs a Meta Business account and app review — it&rsquo;ll follow. They use the same assistant under the hood.
          </div>
        </div>
      </div>

      {editing && <ConnectModal channel={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} notify={notify} />}
    </>
  );
}

function ConnectModal({ channel, onClose, onDone, notify }: { channel: Partial<Channel>; onClose: () => void; onDone: () => void; notify: (m: string) => void }) {
  const [botToken, setBotToken] = useState('');
  const [senders, setSenders] = useState((channel.allowed_senders || []).join(', '));
  const [autonomy, setAutonomy] = useState<'suggest' | 'auto'>(channel.autonomy || 'auto');
  const [enabled, setEnabled] = useState(channel.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!channel.id && !botToken.trim()) { setErr('Paste your Telegram bot token.'); return; }
    setBusy(true); setErr('');
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch('/api/assistant/save', {
        method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
        body: JSON.stringify({
          id: channel.id ?? null, platform: 'telegram', botToken,
          allowedSenders: senders.split(',').map((s) => s.trim()).filter(Boolean),
          autonomy, enabled,
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setErr(j?.error || 'Could not save.'); return; }
      if (j.registerError) { setErr('Saved, but Telegram rejected the webhook: ' + j.registerError); return; }
      notify(j.webhookRegistered ? 'Connected — message your bot to test it.' : 'Saved.');
      onDone();
    } finally { setBusy(false); }
  };

  const input = 'w-full h-9 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] flex flex-col bg-surface rounded-xl ring-1 ring-subtle shadow-popover" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-subtle">
          <h3 className="text-sm font-semibold text-primary">{channel.id ? 'Edit assistant' : 'Connect a Telegram bot'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {!channel.id && (
            <ol className="text-[12px] text-secondary space-y-1.5 rounded-lg bg-surface-sunken ring-1 ring-subtle p-3 list-decimal pl-5">
              <li>In Telegram, message <span className="font-mono text-primary">@BotFather</span> → <span className="font-mono">/newbot</span>, pick a name.</li>
              <li>Copy the <b>bot token</b> it gives you and paste it below.</li>
              <li>Save — we register the webhook automatically.</li>
              <li>Open your new bot and send it any message. It&rsquo;ll reply with <b>your Telegram ID</b>.</li>
              <li>Add that ID to <b>Allowed senders</b> here, save again — then chat.</li>
            </ol>
          )}
          {err && <div className="rounded-lg bg-danger/10 ring-1 ring-danger/30 px-3 py-2 text-[12px] text-danger">{err}</div>}

          <label className="block">
            <span className="block text-[12px] font-semibold text-secondary mb-1">Bot token {channel.has_token && <span className="text-success">— set</span>}</span>
            <input value={botToken} onChange={(e) => setBotToken(e.target.value)} type="password"
              placeholder={channel.has_token ? 'Leave blank to keep current' : '123456:ABC-DEF…'} className={input + ' font-mono text-[12px]'} />
          </label>

          <label className="block">
            <span className="block text-[12px] font-semibold text-secondary mb-1">Allowed senders <span className="text-tertiary">— Telegram IDs, comma-separated</span></span>
            <input value={senders} onChange={(e) => setSenders(e.target.value)} placeholder="835192001, 274839120" className={input + ' font-mono text-[12px]'} />
            <span className="block mt-1 text-[11px] text-tertiary">Only these people can use the assistant. Message the bot once to learn your ID.</span>
          </label>

          <label className="block">
            <span className="block text-[12px] font-semibold text-secondary mb-1">Permissions</span>
            <select value={autonomy} onChange={(e) => setAutonomy(e.target.value as any)} className={input}>
              <option value="auto">Can make changes — create offers, invoices, people…</option>
              <option value="suggest">Read-only — answer questions, never change data</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-[12px] font-medium text-secondary">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="rounded border-subtle accent-accent" /> Active
          </label>
        </div>

        <div className="h-14 shrink-0 flex items-center justify-end gap-2 px-4 border-t border-subtle">
          <button onClick={onClose} className="h-8 px-3 rounded-md text-[13px] font-medium text-secondary hover:bg-surface-hover">Cancel</button>
          <button onClick={submit} disabled={busy} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-[13px] font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} {channel.id ? 'Save' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
