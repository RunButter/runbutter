'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ExternalLink, Check, Globe2, AlertTriangle } from 'lucide-react';
import { rpc } from '@/lib/rpc';

/**
 * Claim the public careers URL for a workspace.
 *
 * The slug is validated the same way Postgres validates it (0060), because it
 * has to be a legal DNS label: once wildcard DNS is live this same value
 * becomes <slug>.runbutter.app, and a slug that's fine in a path but illegal in
 * a hostname would work today and break at the DNS flip.
 */
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

function slugProblem(slug: string): string | null {
  if (!slug) return null;                       // empty = page taken down
  if (slug.length < 2) return 'Too short — use at least 2 characters.';
  if (slug.length > 40) return 'Too long — 40 characters max.';
  if (!SLUG_RE.test(slug)) return 'Lowercase letters, numbers and hyphens only, and it can’t start or end with a hyphen.';
  if (slug.includes('--')) return 'Two hyphens in a row aren’t allowed.';
  return null;
}

export default function CareersPageCard({ privyUserId, workspaceId }: { privyUserId: string | null; workspaceId: string | null }) {
  const [slug, setSlug] = useState('');
  const [headline, setHeadline] = useState('');
  const [about, setAbout] = useState('');
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [origin, setOrigin] = useState('https://runbutter.app');

  useEffect(() => { setOrigin(window.location.origin); }, []);

  const load = useCallback(async () => {
    if (!privyUserId || !workspaceId) { setLoading(false); return; }
    const { data, error: e } = await rpc('get_careers_settings', { p_privy: privyUserId, p_company: workspaceId });
    if (!e && data) {
      const d = data as any;
      setSlug(d.slug || ''); setSavedSlug(d.slug || null);
      setHeadline(d.headline || ''); setAbout(d.about || '');
    }
    setLoading(false);
  }, [privyUserId, workspaceId]);

  useEffect(() => { load(); }, [load]);

  const problem = slugProblem(slug);

  const save = async () => {
    if (!privyUserId || !workspaceId) { setError('Sign in to publish a careers page.'); return; }
    if (problem) { setError(problem); return; }
    setSaving(true); setError(''); setSaved(false);
    const { data, error: e } = await rpc('set_careers_page', {
      p_privy: privyUserId, p_company: workspaceId,
      p_slug: slug, p_headline: headline || null, p_about: about || null,
    });
    setSaving(false);
    if (e) {
      // Postgres owns the final word on slugs — surface its verdicts plainly.
      setError(
        /SLUG_RESERVED/.test(e.message) ? 'That name is reserved for the platform — pick another.'
        : /SLUG_TAKEN/.test(e.message) ? 'Another workspace already uses that address.'
        : /SLUG_INVALID/.test(e.message) ? 'That address isn’t valid — lowercase letters, numbers and hyphens only.'
        : /does not exist|schema cache/i.test(e.message) ? 'Run migration 0060 first.'
        : e.message,
      );
      return;
    }
    setSavedSlug((data as any)?.slug ?? null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) {
    return <div className="card-surface p-5 flex items-center gap-2 text-sm text-tertiary">
      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading careers page…
    </div>;
  }

  return (
    <div className="card-surface p-5 space-y-3.5">
      <div className="flex items-center gap-2">
        <Globe2 className="w-4 h-4 text-accent" />
        <h2 className="text-base font-medium text-primary">Public careers page</h2>
      </div>
      <p className="text-xs text-tertiary">
        One branded page listing every open role, using the logo and accent colour above.
        Nothing is public until you set an address here.
      </p>

      <div>
        <label className="block text-xs font-semibold text-secondary mb-1">Address</label>
        <div className="flex items-stretch">
          <span className="inline-flex items-center px-2.5 rounded-l-md bg-surface-sunken ring-1 ring-subtle text-xs text-tertiary">
            {origin.replace(/^https?:\/\//, '')}/careers/
          </span>
          <input value={slug} onChange={(e) => { setSlug(e.target.value.toLowerCase().trim()); setError(''); }}
            placeholder="your-company"
            className={`flex-1 h-9 px-2.5 text-sm rounded-r-md bg-surface ring-1 shadow-sm outline-none focus:ring-2 ${
              problem ? 'ring-danger/40 focus:ring-danger/30' : 'ring-subtle focus:ring-accent/30'
            }`} />
        </div>
        {problem && (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-danger">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /><span>{problem}</span>
          </p>
        )}
        <p className="mt-1.5 text-2xs text-tertiary">
          Leave empty to take the page offline. This also becomes your subdomain
          (<span className="tabular-nums">{slug || 'your-company'}.runbutter.app</span>) once we enable those, so it follows domain-name rules.
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-secondary mb-1">Headline</label>
        <input value={headline} onChange={(e) => setHeadline(e.target.value)}
          placeholder="Build the tools companies actually run on."
          className="w-full h-9 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none" />
      </div>

      <div>
        <label className="block text-xs font-semibold text-secondary mb-1">About</label>
        <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3}
          placeholder="A short paragraph about the team, how you work, where you're based…"
          className="w-full px-2.5 py-2 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none" />
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving || !!problem || !privyUserId}
          className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm disabled:opacity-50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : null}
          {saved ? 'Saved' : 'Save careers page'}
        </button>
        {savedSlug && (
          <a href={`/careers/${savedSlug}`} target="_blank" rel="noopener noreferrer"
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-secondary ring-1 ring-subtle hover:bg-surface-sunken">
            <ExternalLink className="w-3.5 h-3.5" /> View page
          </a>
        )}
      </div>
    </div>
  );
}
