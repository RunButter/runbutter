'use client';

import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Check, Copy, Loader2, ExternalLink } from 'lucide-react';
import AppLoading from '@/components/ui/AppLoading';
import SupportChat from '@/components/support/SupportChat';
import { getWorkspace } from '@/lib/crm/data';
import { loadWidget, saveWidget, embedSnippet, type SupportWidget } from '@/lib/support/client';

/**
 * Settings for the chat widget (0131): switch it on, make it look like yours,
 * copy one line onto your site. The preview on the right is the REAL visitor
 * component in preview mode, so what you see is what a visitor gets.
 *
 * A widget starts OFF. Nothing appears on anybody's website until a person
 * presses the switch here — and switching it off removes the button from every
 * site at once, because the launcher asks the server before it draws itself.
 */

const SWATCHES = ['#18181b', '#2563eb', '#16a34a', '#9333ea', '#e11d48', '#ea580c'];

export default function WidgetSettingsPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const [ws, setWs] = useState<{ id: string; name: string } | null>(null);
  const [w, setW] = useState<SupportWidget | null>(null);
  const [draft, setDraft] = useState<Partial<SupportWidget>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const [origin, setOrigin] = useState('');

  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => {
    if (!privy) return;
    getWorkspace(privy).then(async (x) => {
      if (!x?.id) return;
      setWs({ id: x.id, name: x.name });
      const r = await loadWidget(privy, x.id);
      if (r.widget) { setW(r.widget); setDraft(r.widget); } else setError(r.error || 'Could not load the widget.');
    });
  }, [privy]);

  if (!ready) return <AppLoading />;
  if (!privy) return <div className="page-pad text-sm text-tertiary">Sign in to set up the chat widget.</div>;
  if (!w) return error ? <div className="page-pad text-sm text-danger">{error}</div> : <AppLoading />;

  const v = { ...w, ...draft } as SupportWidget;
  const dirty = (['enabled', 'title', 'greeting', 'color', 'ask_email', 'notify_email'] as const).some((k) => (draft as any)[k] !== (w as any)[k]);
  const canEdit = w.can_edit;

  const save = async (patch?: Partial<SupportWidget>) => {
    setBusy(true); setError('');
    const r = await saveWidget(privy, ws!.id, patch ?? draft);
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setW(r.widget!); setDraft(r.widget!);
  };
  const copy = async (text: string, key: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1500); } catch {}
  };

  const snippet = embedSnippet(origin, w.id);
  const link = `${origin}/support/${w.id}`;
  const field = 'w-full h-9 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60';

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="h-16 shrink-0 flex items-center gap-3 page-x">
        <h1 className="text-md font-medium text-primary">Chat widget</h1>
        <span className={`text-2xs font-semibold rounded-full px-2 py-0.5 ${w.enabled ? 'bg-success/10 text-success' : 'bg-surface-hover text-tertiary'}`}>{w.enabled ? 'Live' : 'Off'}</span>
        <div className="ml-auto flex items-center gap-2">
          {dirty && canEdit && (
            <button onClick={() => save()} disabled={busy}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
            </button>
          )}
          {canEdit && (
            <button onClick={() => save({ enabled: !w.enabled })} disabled={busy}
              className="h-8 px-3 rounded-lg text-sm font-medium ring-1 ring-subtle text-secondary hover:bg-surface-hover disabled:opacity-40">
              {w.enabled ? 'Turn off' : 'Turn on'}
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto page-pad">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
          <div className="space-y-4 min-w-0">
            {!canEdit && <p className="text-sm text-secondary">Only an owner or admin can change the widget.</p>}
            {error && <p className="text-sm text-danger">{error}</p>}

            <section className="card-surface p-5 space-y-4">
              <h2 className="text-sm font-medium text-primary">Look</h2>
              <label className="block">
                <span className="block text-xs font-semibold text-secondary mb-1">Title</span>
                <input value={v.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} disabled={!canEdit} maxLength={60} className={field} />
              </label>
              <label className="block">
                <span className="block text-xs font-semibold text-secondary mb-1">Greeting</span>
                <textarea value={v.greeting} onChange={(e) => setDraft({ ...draft, greeting: e.target.value })} disabled={!canEdit} maxLength={300} rows={2}
                  className={`${field} h-auto py-2 resize-none`} />
              </label>
              <div>
                <span className="block text-xs font-semibold text-secondary mb-1.5">Colour</span>
                <div className="flex items-center gap-2 flex-wrap">
                  {SWATCHES.map((c) => (
                    <button key={c} onClick={() => setDraft({ ...draft, color: c })} disabled={!canEdit} aria-label={`Colour ${c}`}
                      className={`w-7 h-7 rounded-full ring-offset-2 ring-offset-surface ${v.color.toLowerCase() === c ? 'ring-2 ring-accent' : 'ring-1 ring-subtle'}`}
                      style={{ background: c }} />
                  ))}
                  <input type="color" value={v.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} disabled={!canEdit}
                    aria-label="Custom colour" className="w-9 h-7 rounded-md bg-transparent cursor-pointer" />
                  <span className="text-2xs font-mono text-tertiary">{v.color}</span>
                </div>
              </div>
            </section>

            <section className="card-surface p-5 space-y-4">
              <h2 className="text-sm font-medium text-primary">Conversations</h2>
              <label className="flex items-start gap-2.5">
                <input type="checkbox" checked={v.ask_email} onChange={(e) => setDraft({ ...draft, ask_email: e.target.checked })} disabled={!canEdit} className="mt-0.5" />
                <span>
                  <span className="block text-sm text-primary">Ask for an email before the first message</span>
                  <span className="block text-2xs text-tertiary">So a reply can reach them after they leave. Every visitor who gives one becomes a contact in People.</span>
                </span>
              </label>
              <label className="block">
                <span className="block text-xs font-semibold text-secondary mb-1">Email the team about new conversations</span>
                <input value={v.notify_email || ''} onChange={(e) => setDraft({ ...draft, notify_email: e.target.value })} disabled={!canEdit}
                  type="email" placeholder="support@yourcompany.com — optional" className={field} />
              </label>
            </section>

            <section className="card-surface p-5 space-y-3">
              <h2 className="text-sm font-medium text-primary">Put it on your website</h2>
              <p className="text-xs text-tertiary">Paste this before <code className="bg-surface-hover rounded px-1">&lt;/body&gt;</code> on every page. {w.enabled ? '' : 'The button appears once the widget is turned on.'}</p>
              <div className="flex items-stretch gap-2">
                <code className="flex-1 min-w-0 text-xs font-mono bg-inverse text-inverse-fg rounded-lg px-3 py-2.5 overflow-x-auto whitespace-nowrap">{snippet}</code>
                <button onClick={() => copy(snippet, 'snippet')} className="shrink-0 h-auto px-3 inline-flex items-center gap-1.5 rounded-lg text-xs ring-1 ring-subtle text-secondary hover:bg-surface-hover">
                  {copied === 'snippet' ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />} Copy
                </button>
              </div>
              <p className="text-xs text-tertiary">No website? Share the chat as a link:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 text-xs font-mono bg-surface-sunken rounded-lg px-3 py-2 truncate">{link}</code>
                <button onClick={() => copy(link, 'link')} className="shrink-0 h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs ring-1 ring-subtle text-secondary hover:bg-surface-hover">
                  {copied === 'link' ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />} Copy
                </button>
                {w.enabled && (
                  <a href={link} target="_blank" rel="noreferrer noopener" className="shrink-0 h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs ring-1 ring-subtle text-secondary hover:bg-surface-hover">
                    <ExternalLink className="w-3.5 h-3.5" /> Open
                  </a>
                )}
              </div>
            </section>
          </div>

          <div className="lg:sticky lg:top-0">
            <p className="text-2xs font-medium uppercase tracking-wider text-tertiary mb-2">Preview</p>
            <SupportChat preview widget={{ id: w.id, title: v.title, greeting: v.greeting, color: v.color, ask_email: v.ask_email, company: ws?.name || null, logo: null }} />
          </div>
        </div>
      </div>
    </div>
  );
}
