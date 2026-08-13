'use client';

import { useState } from 'react';
import { getAccessToken } from '@privy-io/react-auth';
import { Package, Download, Loader2, Check, ChevronRight } from 'lucide-react';
import type { Skill } from '@/lib/crm/skills';
import { skillSlug } from '@/lib/plugins/agent-plugin';
import Button from '@/components/ui/Button';
import { PLATFORMS, losses, type PlatformId } from '@/lib/plugins/platforms';

/**
 * Export the workspace's skills as an Agent Plugin.
 *
 * Agent Plugins (agent-plugins.org, spec 1.0.0) is the vendor-neutral package
 * format agreed by Amazon, Cursor, Microsoft, OpenAI and Vercel: a directory
 * with a manifest, a `skills/` tree and an `mcp.json`. RunButter already reads
 * that format — `/api/skills/import` pulls SKILL.md files out of public repos —
 * so this closes the loop and makes the workspace a place skills are AUTHORED,
 * not only consumed.
 *
 * The zip is built server-side because the skills come from `get_skills`, which
 * is only reachable as service_role.
 */
export default function PluginExport({ privy, ws, skills }: {
  privy: string | null; ws: string | null; skills: Skill[];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [includeMcp, setIncludeMcp] = useState(true);
  // Same four targets the public builder offers, from the same PLATFORMS array.
  const [platform, setPlatform] = useState<PlatformId>('agent-plugin');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const chosen = picked.size ? skills.filter((s) => picked.has(s.id)) : skills;

  const toggle = (id: string) =>
    setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const download = async () => {
    if (!privy || !ws) return;
    setBusy(true); setError(''); setDone(false);
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch('/api/plugins/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
        body: JSON.stringify({
          privyUserId: privy, workspaceId: ws, includeMcp, platform,
          skillIds: picked.size ? [...picked] : undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error || 'Could not build the plugin.');
        return;
      }
      // The filename is on the response, not invented here — the server decides
      // the plugin's name and the zip should agree with the manifest inside it.
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'plugin.zip';
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      // Revoking immediately can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setDone(true);
    } catch (e: any) {
      setError(e?.message || 'Could not reach the server.');
    } finally { setBusy(false); }
  };

  if (!skills.length) return null;

  return (
    <section className="card-surface overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 px-4 h-12 text-left hover:bg-surface-hover transition-colors"
      >
        <Package className="w-4 h-4 text-accent shrink-0" />
        <span className="text-sm font-medium text-primary">Export as an Agent Plugin</span>
        <span className="text-2xs text-tertiary hidden sm:inline">agent-plugins.org · 1.0.0</span>
        <ChevronRight className={`w-4 h-4 text-tertiary ml-auto shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-subtle">
          <p className="text-xs text-secondary leading-relaxed max-w-[64ch]">
            Packages your skills in the open format agreed by Amazon, Cursor, Microsoft, OpenAI and
            Vercel, so they load in any client that supports it. Publish the folder as a repository
            and anyone can install it.
          </p>

          <div className="rounded-lg ring-1 ring-subtle bg-surface-sunken p-3">
            <div className="text-2xs font-medium uppercase tracking-wider text-tertiary mb-2">
              Skills — {picked.size ? `${picked.size} selected` : `all ${skills.length}`}
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
              {skills.map((s) => {
                const on = picked.size === 0 || picked.has(s.id);
                return (
                  <button
                    key={s.id} onClick={() => toggle(s.id)} aria-pressed={on}
                    title={`skills/${skillSlug(s.name)}/SKILL.md`}
                    className={`h-7 px-2.5 rounded-md text-xs transition-colors ${
                      on ? 'bg-inverse text-inverse-fg' : 'bg-surface text-secondary ring-1 ring-subtle hover:text-primary'}`}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
            {picked.size > 0 && (
              <button onClick={() => setPicked(new Set())} className="mt-2 text-2xs text-tertiary hover:text-primary">
                clear selection — export all
              </button>
            )}
          </div>

          <div>
            <div className="text-2xs font-medium uppercase tracking-wider text-tertiary mb-1.5">Format</div>
            <div className="grid sm:grid-cols-2 gap-1.5">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPlatform(p.id)}
                  className={`text-left rounded-lg px-2.5 py-2 ring-1 ${
                    platform === p.id ? 'ring-accent bg-accent-soft' : 'ring-subtle hover:bg-surface-hover'}`}
                >
                  <div className="text-xs font-semibold text-primary">{p.label}</div>
                  <div className="text-2xs text-tertiary">{p.blurb}</div>
                </button>
              ))}
            </div>
            {/* What this format CANNOT carry, said before the download rather
                than discovered afterwards. `losses` is the same function the
                public builder uses, so the two surfaces cannot disagree about
                what a layout drops. */}
            {(() => {
              const drops = losses(platform, { manifest: { name: 'x', version: '0.1.0' }, skills: [], mcpUrl: includeMcp ? 'x' : undefined });
              return drops.length ? (
                <ul className="mt-1.5 space-y-0.5">
                  {drops.map((d) => <li key={d} className="text-2xs text-warning">· {d}</li>)}
                </ul>
              ) : null;
            })()}
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={includeMcp} onChange={(e) => setIncludeMcp(e.target.checked)}
              className="mt-0.5 rounded border-strong accent-accent" />
            <span className="text-xs text-secondary leading-relaxed">
              Include <span className="font-mono text-primary">mcp.json</span> pointing at this
              workspace’s MCP endpoint, so an agent can read and write records as well as follow the
              skills.
            </span>
          </label>

          {/* Said here rather than only in the README, because this is the
              moment someone would otherwise assume the download is ready to
              use as-is and wonder why nothing connects. */}
          <p className="text-2xs text-tertiary leading-relaxed max-w-[64ch]">
            The package contains no API key. The specification forbids credentials in a plugin and
            clients do not expand environment variables into headers, so you add your key in your
            client after installing. Create one under Settings → Integrations.
          </p>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={download} disabled={busy || !privy || !ws}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : done ? <Check className="w-3.5 h-3.5" />
                  : <Download className="w-3.5 h-3.5" />}
              {done ? 'Downloaded' : `Download ${chosen.length} skill${chosen.length === 1 ? '' : 's'}`}
            </Button>
            <a href="https://agent-plugins.org" target="_blank" rel="noopener noreferrer"
              className="text-2xs text-tertiary hover:text-primary">What is an Agent Plugin?</a>
          </div>
        </div>
      )}
    </section>
  );
}
