'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, ExternalLink, Globe, Loader2, Trash2 } from 'lucide-react';
import { useDialog } from '@/components/ui/Dialog';
import { listMyStyles, publishStyle, unpublishStyle, type MyStyle } from '@/lib/design/library';
import type { DesignTokens } from '@/lib/design/tokens';

/**
 * Share the spec, as a page anyone can read.
 *
 * ── PUBLISHING TAKES A SNAPSHOT, AND THE PANEL SAYS SO ──────────────────────
 * The public page holds a COPY of the tokens as they were when the button was
 * pressed. Carrying on editing does not touch it — which is the right
 * behaviour and a genuine surprise, so the panel states it in one line rather
 * than leaving somebody to discover their published page never changes.
 * "Update" is the deliberate act that moves it forward.
 *
 * ── IT NEEDS AN ACCOUNT, AND THAT IS THE MODERATION ─────────────────────────
 * Anonymous publishing to an indexed page on our own domain is a spam funnel
 * with our reputation as the payload. A workspace member can publish, the
 * workspace is named, and ten per workspace is the ceiling. A real bar rather
 * than a captcha — and the free tool at /brand deliberately cannot do this.
 */

const GROUPS = ['Product', 'Marketing', 'Editorial', 'Studio', 'Other'] as const;
const field = 'h-8 px-2.5 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary placeholder:text-tertiary';

export default function PublishPanel({ privy, ws, tokens }: {
  privy: string; ws: string; tokens: DesignTokens;
}) {
  const { confirm } = useDialog();
  const [mine, setMine] = useState<MyStyle[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [justPublished, setJustPublished] = useState<string | null>(null);

  const [essence, setEssence] = useState('');
  const [blurb, setBlurb] = useState('');
  const [group, setGroup] = useState<string>('Product');
  const [author, setAuthor] = useState('');
  const [authorUrl, setAuthorUrl] = useState('');

  const reload = useCallback(async () => { setMine(await listMyStyles(privy, ws)); }, [privy, ws]);
  useEffect(() => { reload(); }, [reload]);

  const name = tokens.brand.name?.trim();

  const submit = async (id: string | null) => {
    if (!name) { setErr('Give the brand a name first — it becomes the page heading and the URL.'); return; }
    setBusy(id || 'new'); setErr('');
    const res = await publishStyle(privy, ws, id, {
      name,
      essence: essence.trim() || tokens.brand.tagline || undefined,
      blurb: blurb.trim() || tokens.brand.description || undefined,
      group_key: group,
      author: author.trim() || undefined,
      author_url: authorUrl.trim() || undefined,
    }, tokens);
    setBusy('');
    if (res.error) { setErr(res.error); return; }
    setJustPublished(res.slug ?? null);
    setOpen(false);
    reload();
  };

  const remove = async (s: MyStyle) => {
    if (!(await confirm({
      title: `Take “${s.name}” down?`,
      body: 'The page stops existing and its link 404s. Anything you have here in the studio is untouched.',
      confirmLabel: 'Take it down', danger: true,
    }))) return;
    setBusy(s.id);
    const { error } = await unpublishStyle(privy, ws, s.id);
    setBusy('');
    if (error) { setErr(error); return; }
    if (justPublished === s.slug) setJustPublished(null);
    reload();
  };

  return (
    <div className="card-surface p-4">
      <h2 className="text-sm font-medium text-primary inline-flex items-center gap-1.5">
        <Globe className="w-3.5 h-3.5 text-tertiary" /> Share it publicly
      </h2>
      <p className="mt-0.5 text-2xs text-tertiary">
        Publishes this spec as a page anyone can read and copy — colours, type levels, the whole
        DESIGN.md. It is a <b className="text-secondary">snapshot</b>: carrying on editing here does
        not change it until you press Update.
      </p>

      {justPublished && (
        <a href={`/brand/style/${justPublished}`} target="_blank" rel="noreferrer"
          className="mt-2 flex items-center gap-1.5 rounded-lg bg-success/10 ring-1 ring-success/30 px-2.5 py-2 text-2xs text-secondary hover:bg-success/15">
          <Check className="w-3.5 h-3.5 text-success shrink-0" />
          <span className="flex-1 min-w-0 truncate">Live at /brand/style/{justPublished}</span>
          <ExternalLink className="w-3 h-3 shrink-0" />
        </a>
      )}

      {err && <p className="mt-2 text-2xs text-danger">{err}</p>}

      {!!mine.length && (
        <div className="mt-2.5 flex flex-col gap-1">
          {mine.map((s) => (
            <div key={s.id} className="flex items-center gap-2 rounded-lg bg-surface-sunken ring-1 ring-subtle px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <a href={`/brand/style/${s.slug}`} target="_blank" rel="noreferrer"
                  className="block text-2xs text-primary truncate hover:underline">{s.name}</a>
                <span className="block text-3xs text-tertiary font-mono truncate">/brand/style/{s.slug}</span>
              </div>
              <button onClick={() => submit(s.id)} disabled={!!busy}
                className="h-6 px-2 shrink-0 rounded-md text-3xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-hover disabled:opacity-40">
                {busy === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Update'}
              </button>
              <button onClick={() => remove(s)} aria-label={`Take down ${s.name}`} disabled={!!busy}
                className="p-1 shrink-0 rounded-md text-tertiary hover:text-danger hover:bg-danger/10">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {!open ? (
        <button onClick={() => setOpen(true)}
          className="mt-2.5 h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">
          <Globe className="w-3.5 h-3.5" /> Publish {mine.length ? 'another' : 'to the library'}
        </button>
      ) : (
        <div className="mt-2.5 flex flex-col gap-2">
          <label className="block">
            <span className="text-3xs text-tertiary">The one line people remember</span>
            <input value={essence} onChange={(e) => setEssence(e.target.value)}
              placeholder={tokens.brand.tagline || 'A white room with a single blue switch.'}
              aria-label="Essence" className={`${field} mt-0.5 w-full`} />
          </label>
          <label className="block">
            <span className="text-3xs text-tertiary">Who it suits</span>
            <input value={blurb} onChange={(e) => setBlurb(e.target.value)}
              placeholder="Restrained SaaS UI. Hierarchy from size and colour, almost never from weight."
              aria-label="Blurb" className={`${field} mt-0.5 w-full`} />
          </label>
          <div className="grid sm:grid-cols-3 gap-2">
            <label className="block">
              <span className="text-3xs text-tertiary">Section</span>
              <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Section"
                className={`${field} mt-0.5 w-full`}>
                {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-3xs text-tertiary">Credit (optional)</span>
              <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Your name or studio"
                aria-label="Credit" className={`${field} mt-0.5 w-full`} />
            </label>
            <label className="block">
              <span className="text-3xs text-tertiary">Link (optional)</span>
              <input value={authorUrl} onChange={(e) => setAuthorUrl(e.target.value)} placeholder="https://…"
                aria-label="Link" className={`${field} mt-0.5 w-full`} />
            </label>
          </div>
          <p className="text-3xs text-tertiary">
            Published as <b className="text-secondary">{name || 'your brand name'}</b>. The page shows the
            palette, the type, the components and the rules — everything in the file. Take it down any
            time; the link 404s immediately.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => submit(null)} disabled={busy === 'new' || !name}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
              {busy === 'new' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
              Publish
            </button>
            <button onClick={() => { setOpen(false); setErr(''); }}
              className="h-8 px-3 rounded-lg text-sm font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-hover">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
