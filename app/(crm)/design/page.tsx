'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Check, Loader2, Save, Sparkles } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import AppLoading from '@/components/ui/AppLoading';
import { getWorkspace, loadBranding, type WorkspaceContext } from '@/lib/crm/data';
import { listSkills, saveSkill } from '@/lib/crm/skills';
import type { DesignTokens } from '@/lib/design/tokens';
import { loadDesign, saveDesign, seedFrom } from '@/lib/design/store';
import { designSkill } from '@/lib/design/export';
import DesignStudio from '@/components/design/DesignStudio';

/**
 * The design studio, signed in.
 *
 * ── WHY THIS IS A PRODUCT SCREEN AND NOT A DOCS PAGE ────────────────────────
 * "Write a DESIGN.md and your AI will stay on brand" is good advice that almost
 * nobody follows, because writing one means retyping values out of a PDF into a
 * format you are guessing at, with no way to tell whether it worked. Both
 * halves are fixable: the values can be READ out of the files that already hold
 * them, and "did it work" is a preview.
 *
 * The studio itself is `components/design/DesignStudio`, shared verbatim with
 * the free public tool at /brand. Everything this page adds is the two things
 * a workspace makes possible — storing the spec, and handing it to the agents.
 *
 * ── SAVING AND PUBLISHING ARE TWO ACTS ──────────────────────────────────────
 * Save writes the document. "Save as a skill" writes a SKILL every agent then
 * carries into its system prompt. Deliberately separate: editing a draft
 * palette must not silently change what a scheduled agent is doing at three in
 * the morning.
 */

export default function DesignPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [ws, setWs] = useState<WorkspaceContext | null>(null);
  const [t, setT] = useState<DesignTokens | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeded, setSeeded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!privy) { setLoading(false); return; }
    (async () => {
      const w = await getWorkspace(privy);
      if (!w) { setLoading(false); return; }
      setWs(w);
      const [stored, branding] = await Promise.all([loadDesign(privy, w.id), loadBranding(privy, w.id)]);
      if (stored.error) setErr(stored.error);
      if (stored.saved) {
        setT(stored.tokens);
      } else {
        // Seeded from what the workspace already branded itself with, so the
        // studio opens on something correct rather than something empty.
        setT(seedFrom(branding?.name || w.name || '', branding?.accent_color));
        setSeeded(true);
      }
      if (branding?.logo_url) setLogoUrl(branding.logo_url);
      setLoading(false);
    })();
  }, [ready, privy]);

  const set = useCallback((fn: (prev: DesignTokens) => DesignTokens) => {
    setT((prev) => (prev ? fn(prev) : prev));
    setDirty(true); setNote('');
  }, []);

  const save = async () => {
    if (!privy || !ws || !t) return;
    setBusy('save'); setErr(''); setNote('');
    const { error } = await saveDesign(privy, ws.id, t);
    setBusy('');
    if (error) { setErr(error); return; }
    setDirty(false); setSeeded(false); setNote('Saved.');
  };

  /** Publish to the agents. Updates the existing `design` skill rather than adding a second. */
  const publishSkill = async () => {
    if (!privy || !ws || !t) return;
    setBusy('skill'); setErr(''); setNote('');
    const existing = (await listSkills(privy, ws.id)).find((s) => /^design$/i.test(s.name));
    const s = designSkill(t);
    const { error } = await saveSkill(privy, ws.id, {
      id: existing?.id, name: 'design', description: s.description,
      instructions: s.instructions, suggested_tools: existing?.suggested_tools || [], source: 'local',
    });
    setBusy('');
    if (error) { setErr(error.message || 'Could not save the skill.'); return; }
    setNote(existing ? 'Updated the design skill — every agent carries it.' : 'Saved as a skill — every agent carries it now.');
  };

  if (!ready || loading) return <AppLoading />;

  if (!privy || !ws || !t) {
    return (
      <>
        <PageHeader title="Design" />
        <div className="flex-1 overflow-auto p-6">
          <div className="page-body rounded-lg ring-1 ring-subtle bg-surface-sunken p-4 text-sm text-secondary">
            Sign in to build a design spec — or use the free version at{' '}
            <a href="/brand" className="text-accent hover:underline">/brand</a>, which needs no account.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Design">
        {dirty && <span className="text-2xs text-tertiary">Unsaved</span>}
        {note && !dirty && <span className="text-2xs text-success inline-flex items-center gap-1"><Check className="w-3 h-3" />{note}</span>}
        <button onClick={save} disabled={busy === 'save'}
          className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
          {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
        </button>
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-6 2xl:p-8 max-w-[1600px] mx-auto w-full flex flex-col gap-4">
          {err && <p className="text-2xs text-danger">{err}</p>}

          <DesignStudio
            t={t} set={set} logoUrl={logoUrl}
            intro={
              <>
                <h2 className="text-sm font-medium text-primary">
                  {seeded ? 'Start from what you already have' : 'Add to it'}
                </h2>
                <p className="mt-0.5 text-2xs text-tertiary">
                  {seeded
                    ? 'This is seeded from your workspace branding. Drop in a logo and your guidelines and the exact values come out of them — nothing is uploaded, it all happens in this tab.'
                    : 'Upload a logo or a brand document at any time. Everything found is shown before it is applied.'}
                </p>
              </>
            }
            sidebar={
              <div className="card-surface p-4">
                <h2 className="text-sm font-medium text-primary">Give it to the agents</h2>
                <p className="mt-0.5 text-2xs text-tertiary">
                  Saves this as a skill called <code className="bg-surface-hover rounded px-1">design</code>.
                  Every agent in the workspace carries it, so "write the launch email" and "draft the
                  invoice note" come out in your colours and your words without being told each time.
                </p>
                <button onClick={publishSkill} disabled={busy === 'skill'}
                  className="mt-2.5 h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
                  {busy === 'skill' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  Save as a skill
                </button>
              </div>
            }
          />
        </div>
      </div>
    </>
  );
}
