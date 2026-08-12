'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { ArrowLeft, Loader2, Send, Save, Eye, Plus, Trash2, Clock, Sparkles, Monitor, Smartphone } from 'lucide-react';
import { getWorkspace, type WorkspaceContext } from '@/lib/crm/data';
import {
  getNewsletter, saveNewsletter, queueNewsletter, listNewsletterLists, draftNewsletter,
  type NewsletterFull, type NewsletterList,
} from '@/lib/crm/newsletters';
import {
  TEMPLATE_META,
  type TemplateKey, type NewsletterContent, type DigestItem,
} from '@/lib/marketing/newsletter-templates';
import { renderEmail, normalizeDoc, type EmailDoc } from '@/lib/marketing/email-doc';
import EmailDesigner from '@/components/marketing/EmailDesigner';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { useDialog } from '@/components/ui/Dialog';
import AppLoading from '@/components/ui/AppLoading';

/**
 * Compose one newsletter, preview it, and send it.
 *
 * The preview renders with the SAME function the sender uses, in an iframe with
 * a srcDoc. Two reasons it is an iframe and not a div: email HTML carries its
 * own <body> styling that would leak into the app, and the app's stylesheet
 * would otherwise leak into the preview and make it look better here than it
 * does in an inbox — which is the one thing a preview must never do.
 */
export default function NewsletterComposer({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { confirm: confirmDialog, notify } = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [ws, setWs] = useState<WorkspaceContext | null>(null);
  const [n, setN] = useState<NewsletterFull | null>(null);
  const [lists, setLists] = useState<NewsletterList[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [brief, setBrief] = useState('');
  // Most newsletters are read on a phone. The toggle is a width, not a second
  // render: the email is one document and a narrow viewport is exactly what a
  // phone gives it.
  const [narrow, setNarrow] = useState(false);
  /**
   * The preview is CLIENT-ONLY.
   *
   * EmailBuilder.js emits a `<head></head>` in the browser and not under
   * react-dom/server, so an srcDoc computed during SSR and again after
   * hydration is two different strings and React logs a mismatch on every
   * newsletter that is opened. Nothing about a preview needs to be server
   * rendered, so the honest fix is not to.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [drafting, setDrafting] = useState(false);

  const load = useCallback(async (w: WorkspaceContext, p: string) => {
    const [row, ls] = await Promise.all([getNewsletter(p, w.id, params.id), listNewsletterLists(p, w.id)]);
    setN(row); setLists(ls); setLoading(false);
  }, [params.id]);

  useEffect(() => {
    if (!ready) return;
    if (!privy) { setLoading(false); return; }
    getWorkspace(privy).then((w) => { if (w) { setWs(w); load(w, privy); } else setLoading(false); });
  }, [ready, privy, load]);

  const locked = !!n && (n.status === 'sending' || n.status === 'sent');

  const set = <K extends keyof NewsletterFull>(k: K, v: NewsletterFull[K]) =>
    setN((p) => (p ? { ...p, [k]: v } : p));
  const setContent = (patch: Partial<NewsletterContent>) =>
    setN((p) => (p ? { ...p, content: { ...(p.content || {}), ...patch } } : p));

  const save = async (): Promise<boolean> => {
    if (!n || !ws || !privy) return false;
    setSaving(true);
    const { error } = await saveNewsletter(privy, ws.id, { ...n, id: n.id });
    setSaving(false);
    if (error) { notify(error); return false; }
    return true;
  };

  const draft = async () => {
    if (!n || !ws || !privy || !brief.trim()) return;
    setDrafting(true);
    const { draft: d, error } = await draftNewsletter(privy, ws.id, (n.template || 'plain') as TemplateKey, brief);
    setDrafting(false);
    if (error || !d) return notify(error || 'No draft returned.');
    // Merged into the existing draft, not swapped for it: the list selection,
    // from-name and reply-to are the user's and must survive a re-draft.
    setN((p) => (p ? {
      ...p,
      subject: d.subject || p.subject,
      preheader: d.preheader || p.preheader,
      content: { ...(p.content || {}), ...d.content },
    } : p));
  };

  const send = async () => {
    if (!n || !ws || !privy) return;
    if (!n.list_ids?.length) return notify('Choose at least one list before sending.');
    if (!n.subject.trim()) return notify('A newsletter needs a subject line.');
    if (!(await save())) return;

    const reach = lists.filter((l) => n.list_ids.includes(l.id)).reduce((a, l) => a + l.subscriber_count, 0);
    const ok = await confirmDialog(
      `Send "${n.subject}" to ${reach} subscriber${reach === 1 ? '' : 's'}? This cannot be undone once delivery starts.`,
    );
    if (!ok) return;

    const { queued, error } = await queueNewsletter(privy, ws.id, n.id, null);
    if (error) return notify(error);
    notify(`Queued for ${queued} recipient${queued === 1 ? '' : 's'}. Delivery starts on the next send tick.`);
    load(ws, privy);
  };

  // Preview uses a stand-in brand: the real logo and colours come from the
  // workspace at SEND time, and fetching them here just to decorate a preview
  // would imply they are part of this newsletter rather than of the workspace.
  const previewHtml = useMemo(() => {
    if (!n || !mounted) return '';
    // The SAME dispatcher the send cron uses, so the preview cannot be a
    // preview of a different email than the one that goes out.
    return renderEmail(n.template || 'plain', {
      subject: n.subject || '(no subject)',
      preheader: n.preheader,
      brand: { name: ws?.name || 'Your company', accent: null, address: 'Your registered address', footer: null },
      content: n.content || {},
      unsubscribeUrl: '#',
      trackLink: (u) => u,
    });
  }, [n, ws?.name, mounted]);

  if (!ready || loading) {
    return <AppLoading />;
  }
  if (!n) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-tertiary">
        <p className="text-sm">This newsletter no longer exists.</p>
        <Button size="sm" variant="ghost" onClick={() => router.push('/marketing/newsletters')}>Back to newsletters</Button>
      </div>
    );
  }

  const items: DigestItem[] = n.content?.items || [];
  // Normalised on read, not on write: `content` is free-form jsonb that an
  // agent, an import or an older client may have written, and anything without
  // a usable root becomes an empty document rather than an exception.
  const doc: EmailDoc = normalizeDoc(n.content?.doc);

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 px-5 lg:px-7">
        <button onClick={() => router.push('/marketing/newsletters')} className="p-1.5 -ml-1.5 rounded-md text-tertiary hover:bg-surface-hover">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-md font-medium tracking-tight text-primary truncate">{n.subject || 'Untitled newsletter'}</h1>
        <Badge tone={n.status === 'sent' ? 'success' : n.status === 'draft' ? 'neutral' : 'warning'}>{n.status}</Badge>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setShowPreview((s) => !s)}>
            <Eye className="w-3.5 h-3.5" /> {showPreview ? 'Hide' : 'Preview'}
          </Button>
          {!locked && (
            <>
              <Button size="sm" variant="ghost" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
              </Button>
              <Button size="sm" variant="primary" onClick={send} disabled={saving}><Send className="w-3.5 h-3.5" /> Send</Button>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto px-5 lg:px-7 pb-8">
        <div className="grid lg:grid-cols-2 gap-4 max-w-6xl items-start">
          {/* ── Editor ───────────────────────────────────────────────────── */}
          <div className="rounded-xl bg-surface shadow-card p-5 space-y-4">
            {locked && (
              <p className="rounded-lg bg-warning/10 text-warning text-xs px-3 py-2">
                This newsletter has started sending, so it can no longer be edited. Its content is kept
                exactly as delivered.
              </p>
            )}

            {!locked && (
              <div className="rounded-lg bg-surface-sunken p-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                  <span className="text-xs font-medium text-primary">Draft with AI</span>
                  <span className="ml-auto text-3xs text-tertiary">your own key</span>
                </div>
                <textarea
                  value={brief} onChange={(e) => setBrief(e.target.value)} rows={2}
                  className="input-field !h-auto py-2 resize-y"
                  placeholder="What should this say? e.g. announce the new board view, invite people to try it"
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={draft} disabled={drafting || !brief.trim()}>
                    {drafting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {n.subject || n.content?.body ? 'Redraft' : 'Draft'}
                  </Button>
                  {/* Said plainly: a draft that silently overwrote a finished
                      newsletter would be the worst possible surprise here. */}
                  <span className="text-3xs text-tertiary">Fills subject and body below. Nothing is sent.</span>
                </div>
              </div>
            )}

            <Field label="Subject">
              <input value={n.subject} disabled={locked} onChange={(e) => set('subject', e.target.value)}
                className="input-field" placeholder="What lands in the inbox" />
            </Field>

            <Field label="Preheader" hint="The grey line most clients show after the subject. Left blank, they scrape your first line instead.">
              <input value={n.preheader} disabled={locked} onChange={(e) => set('preheader', e.target.value)}
                className="input-field" placeholder="One line of context" />
            </Field>

            <Field label="Template">
              <div className="grid gap-2">
                {TEMPLATE_META.map((t) => (
                  <button key={t.key} disabled={locked} onClick={() => set('template', t.key)}
                    className={`text-left rounded-lg border p-2.5 transition-colors disabled:opacity-60 ${
                      n.template === t.key ? 'border-accent bg-accent/5' : 'border-subtle hover:border-strong'}`}>
                    <div className="text-xs font-medium text-primary">{t.name}</div>
                    <div className="text-2xs text-tertiary mt-0.5">{t.description}</div>
                  </button>
                ))}
              </div>
            </Field>

            {n.template === 'blocks' ? (
              <Field label="Design">
                <EmailDesigner doc={doc} disabled={locked}
                  onChange={(next) => setContent({ doc: next })} />
              </Field>
            ) : (
            <Field label="Heading">
              <input value={n.content?.heading || ''} disabled={locked} onChange={(e) => setContent({ heading: e.target.value })}
                className="input-field" />
            </Field>
            )}

            {n.template === 'announcement' && (
              <Field label="Hero image URL">
                <input value={n.content?.imageUrl || ''} disabled={locked} onChange={(e) => setContent({ imageUrl: e.target.value })}
                  className="input-field font-mono text-2xs" placeholder="https://…" />
              </Field>
            )}

            {n.template === 'digest' ? (
              <>
                <Field label="Intro">
                  <textarea value={n.content?.intro || ''} disabled={locked} onChange={(e) => setContent({ intro: e.target.value })}
                    rows={2} className="input-field !h-auto py-2 resize-y" />
                </Field>
                <Field label="Items">
                  <div className="space-y-2">
                    {items.map((it, i) => (
                      <div key={i} className="rounded-lg border border-subtle p-2.5 space-y-1.5">
                        <div className="flex gap-1.5">
                          <input value={it.title} disabled={locked} placeholder="Title"
                            onChange={(e) => setContent({ items: items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
                            className="input-field flex-1" />
                          <button disabled={locked} onClick={() => setContent({ items: items.filter((_, j) => j !== i) })}
                            className="p-2 rounded-md text-tertiary hover:bg-surface-hover"><Trash2 className="w-3.5 h-3.5 text-danger" /></button>
                        </div>
                        <input value={it.blurb || ''} disabled={locked} placeholder="Blurb"
                          onChange={(e) => setContent({ items: items.map((x, j) => (j === i ? { ...x, blurb: e.target.value } : x)) })}
                          className="input-field" />
                        <input value={it.url || ''} disabled={locked} placeholder="https://…"
                          onChange={(e) => setContent({ items: items.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })}
                          className="input-field font-mono text-2xs" />
                      </div>
                    ))}
                    {!locked && (
                      <Button size="sm" variant="ghost" onClick={() => setContent({ items: [...items, { title: '' }] })}>
                        <Plus className="w-3.5 h-3.5" /> Add item
                      </Button>
                    )}
                  </div>
                </Field>
              </>
            ) : n.template === 'blocks' ? null : (
              <Field label="Body" hint="Blank lines separate paragraphs.">
                <textarea value={n.content?.body || ''} disabled={locked} onChange={(e) => setContent({ body: e.target.value })}
                  rows={8} className="input-field !h-auto py-2 resize-y" />
              </Field>
            )}

            {n.template !== 'digest' && n.template !== 'blocks' && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Button label">
                  <input value={n.content?.ctaLabel || ''} disabled={locked} onChange={(e) => setContent({ ctaLabel: e.target.value })}
                    className="input-field" />
                </Field>
                <Field label="Button link">
                  <input value={n.content?.ctaUrl || ''} disabled={locked} onChange={(e) => setContent({ ctaUrl: e.target.value })}
                    className="input-field font-mono text-2xs" placeholder="https://…" />
                </Field>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Field label="From name" hint="Blank uses your workspace name.">
                <input value={n.from_name} disabled={locked} onChange={(e) => set('from_name', e.target.value)} className="input-field" />
              </Field>
              <Field label="Reply-to">
                <input value={n.reply_to} disabled={locked} onChange={(e) => set('reply_to', e.target.value)} className="input-field" />
              </Field>
            </div>

            <Field label="Send to">
              {lists.length === 0 ? (
                <p className="text-xs text-tertiary">No lists yet — create one on the Newsletters page first.</p>
              ) : (
                <div className="space-y-1">
                  {lists.map((l) => {
                    const on = n.list_ids?.includes(l.id);
                    return (
                      <label key={l.id} className={`flex items-center gap-2 rounded-lg border p-2 cursor-pointer transition-colors ${
                        on ? 'border-accent bg-accent/5' : 'border-subtle hover:border-strong'} ${locked ? 'opacity-60 pointer-events-none' : ''}`}>
                        <input type="checkbox" checked={!!on} disabled={locked} className="rounded border-strong accent-accent"
                          onChange={() => set('list_ids', on ? n.list_ids.filter((x) => x !== l.id) : [...(n.list_ids || []), l.id])} />
                        <span className="text-xs text-primary flex-1 truncate">{l.name}</span>
                        <span className="text-2xs text-tertiary tabular-nums">{l.subscriber_count}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </Field>

            {n.status === 'sent' && (
              <div className="rounded-lg bg-surface-sunken p-3 text-xs text-secondary">
                {n.sent_count} delivered · {n.open_count} opened · {n.click_count} clicked
                {n.finished_at && <span className="text-tertiary"> · finished {new Date(n.finished_at).toLocaleString()}</span>}
              </div>
            )}
            {n.status === 'scheduled' && (
              <p className="text-xs text-tertiary flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Queued. Delivery runs on the send cron.
              </p>
            )}
          </div>

          {/* ── Preview ──────────────────────────────────────────────────── */}
          {showPreview && (
            <div className="rounded-xl bg-surface shadow-card overflow-hidden lg:sticky lg:top-4">
              <div className="h-10 flex items-center gap-2 px-4 border-b border-subtle">
                <span className="text-2xs font-medium uppercase tracking-wider text-tertiary">Preview</span>
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={() => setNarrow(false)} aria-label="Desktop width" aria-pressed={!narrow}
                    className={`p-1 rounded ${narrow ? 'text-tertiary hover:text-primary' : 'bg-surface-sunken text-primary'}`}>
                    <Monitor className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setNarrow(true)} aria-label="Phone width" aria-pressed={narrow}
                    className={`p-1 rounded ${narrow ? 'bg-surface-sunken text-primary' : 'text-tertiary hover:text-primary'}`}>
                    <Smartphone className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className={`bg-canvas ${narrow ? 'flex justify-center py-3' : ''}`}>
                <iframe
                  title="Newsletter preview"
                  srcDoc={previewHtml}
                  // Sandboxed with no allow-scripts: the preview is email HTML and
                  // must never be able to run anything in the app's origin. That
                  // matters more since 0098 — a Custom HTML block puts somebody
                  // else's markup in here, and the stripping in the renderer is
                  // the other half of the same pair of braces.
                  sandbox=""
                  className={`h-[70vh] bg-canvas border-0 ${narrow ? 'w-[390px] max-w-full rounded-lg ring-1 ring-subtle' : 'w-full'}`}
                />
              </div>
              <p className="px-4 py-2 text-2xs text-tertiary border-t border-subtle">
                Your logo and colours are applied when it sends.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-secondary block mb-1">{label}</span>
      {children}
      {hint && <span className="text-2xs text-tertiary block mt-1">{hint}</span>}
    </label>
  );
}
