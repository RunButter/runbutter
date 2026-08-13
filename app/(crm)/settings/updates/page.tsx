'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Check, ArrowUpRight, Loader2, Terminal, WifiOff } from 'lucide-react';
import AppLoading from '@/components/ui/AppLoading';

/**
 * Settings → Updates.
 *
 * Answers three questions a self-hoster has and currently has to answer with
 * `git log`: what am I running, is there something newer, and what do I type.
 *
 * Nothing here updates anything. An in-app "update now" button would mean the
 * app writing to its own source tree and restarting itself — different on every
 * host, unrecoverable when it goes wrong, and a remote code execution primitive
 * if the release check were ever spoofed. The commands are shown instead, and
 * they are the same ones in docs/updating.md.
 */

interface Info {
  current: string;
  commit: string | null;
  latest: string | null;
  release: { name: string; url: string; published_at: string; notes: string } | null;
  updateAvailable: boolean;
  checked: boolean;
}

const CMDS = {
  node: ['git pull', 'npm ci', 'npm run migrate', 'npm run build && npm start'],
  docker: ['git pull', 'docker compose build', 'docker compose up -d'],
};

export default function UpdatesPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(true);
  const [how, setHow] = useState<'node' | 'docker'>('node');
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      setInfo(await res.json());
    } catch {
      setInfo(null);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const script = CMDS[how].join('\n');
  const copy = async () => {
    try { await navigator.clipboard.writeText(script); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard denied */ }
  };

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 px-5 lg:px-7">
        <h1 className="text-md font-medium text-primary">Updates</h1>
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm text-secondary hover:text-primary hover:bg-surface-hover disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Check again
        </button>
      </header>

      <div className="flex-1 overflow-auto p-6 2xl:p-8 page-body">
        <div className="max-w-3xl space-y-4">

          {loading && !info ? (
            <AppLoading />
          ) : (
            <>
              {/* ── Version ─────────────────────────────────────────────── */}
              <div className="rounded-xl ring-1 ring-subtle bg-surface shadow-card p-5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-2xs uppercase tracking-wider text-tertiary">You are running</span>
                  <span className="font-mono text-lg text-primary">{info?.current ?? '—'}</span>
                  {info?.commit && <span className="font-mono text-xs text-tertiary">({info.commit})</span>}
                </div>

                <div className="mt-4 pt-4 border-t border-subtle">
                  {!info?.checked ? (
                    <div className="flex items-start gap-2.5 text-sm text-secondary">
                      <WifiOff className="w-4 h-4 text-tertiary shrink-0 mt-0.5" />
                      <div>
                        Could not reach GitHub to check for a newer release.
                        <p className="text-xs text-tertiary mt-1">
                          Expected if this server has no outbound internet. It says so rather than
                          claiming you are up to date.
                        </p>
                      </div>
                    </div>
                  ) : info.updateAvailable ? (
                    <div className="flex items-start gap-2.5">
                      <ArrowUpRight className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm text-primary">
                          <span className="font-medium">{info.latest}</span> is available
                          {info.release?.published_at && (
                            <span className="text-secondary"> — released {new Date(info.release.published_at).toLocaleDateString('en-GB')}</span>
                          )}
                        </p>
                        {info.release?.url && (
                          <a href={info.release.url} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-secondary hover:text-primary underline underline-offset-2">
                            Read the release notes
                          </a>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5 text-sm text-secondary">
                      <Check className="w-4 h-4 text-success shrink-0" />
                      You are on the latest release.
                    </div>
                  )}
                </div>

                <p className="mt-4 text-2xs text-tertiary leading-relaxed">
                  The check asks GitHub for the public release list and sends nothing about this
                  instance — no id, no version, no domain. There is no telemetry in RunButter.
                </p>
              </div>

              {/* ── How to update ───────────────────────────────────────── */}
              <div className="rounded-xl ring-1 ring-subtle bg-surface shadow-card overflow-hidden">
                <div className="px-5 py-3 border-b border-subtle flex items-center gap-3">
                  <Terminal className="w-4 h-4 text-tertiary" />
                  <h2 className="text-sm font-medium text-primary">How to update</h2>
                  <div className="ml-auto flex gap-1">
                    {(['node', 'docker'] as const).map((k) => (
                      <button key={k} onClick={() => setHow(k)}
                        className={`h-7 px-2.5 rounded-md text-2xs font-medium transition-colors ${
                          how === k ? 'bg-inverse text-inverse-fg' : 'text-secondary hover:bg-surface-hover'}`}>
                        {k === 'node' ? 'Node' : 'Docker'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-5">
                  <pre className="rounded-lg bg-surface-sunken ring-1 ring-subtle p-3.5 overflow-x-auto text-xs font-mono text-primary leading-relaxed">{script}</pre>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button onClick={copy}
                      className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-medium bg-surface-hover text-primary hover:bg-surface-sunken">
                      {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : 'Copy'}
                    </button>
                    <a href="/developers/updating" target="_blank" rel="noopener noreferrer"
                      className="text-xs text-secondary hover:text-primary underline underline-offset-2">
                      Full guide
                    </a>
                  </div>

                  <p className="mt-4 text-xs text-secondary leading-relaxed">
                    Code first, then schema — a migration usually assumes the app that ships with it.
                    <br />
                    <span className="text-tertiary">
                      Take a backup before a big one. Every change here is designed to be safe, which
                      is not the same as your data, on your machine, on a Tuesday.
                    </span>
                  </p>
                </div>
              </div>

              {/* ── What changed ────────────────────────────────────────── */}
              {info?.updateAvailable && info.release?.notes && (
                <div className="rounded-xl ring-1 ring-subtle bg-surface shadow-card p-5">
                  <h2 className="text-sm font-medium text-primary mb-2">
                    What&rsquo;s in {info.release.name || info.latest}
                  </h2>
                  {/* Release notes are markdown from GitHub — shown as text, never
                      rendered as HTML. Someone else writes them; that is enough
                      reason not to hand them a renderer. */}
                  <pre className="text-xs text-secondary leading-relaxed whitespace-pre-wrap font-sans max-h-80 overflow-auto">{info.release.notes}</pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
