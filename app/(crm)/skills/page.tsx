'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { ArrowRight, Palette } from 'lucide-react';
import { getWorkspace, type WorkspaceContext } from '@/lib/crm/data';
import { listSkills, type Skill } from '@/lib/crm/skills';
import SkillsSection from '@/components/crm/SkillsSection';
import PluginExport from '@/components/crm/PluginExport';
import PageHeader from '@/components/dashboard/PageHeader';
import AppLoading from '@/components/ui/AppLoading';

/**
 * Skills has its own route rather than living only inside Agents. It is a
 * library, not a setting on one agent: a skill outlives the agent that first
 * used it and is usually attached to several, so it needs somewhere to be found
 * when you are not already editing an agent. The Agents page still renders the
 * same component, so there is one implementation and no drift between them.
 */
export default function SkillsPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const [ws, setWs] = useState<WorkspaceContext | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (w: WorkspaceContext, p: string) => {
    setSkills(await listSkills(p, w.id));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!privy) { setLoading(false); return; }
    getWorkspace(privy).then((w) => { if (w) { setWs(w); reload(w, privy); } else setLoading(false); });
  }, [ready, privy, reload]);

  if (!ready || loading) {
    return <AppLoading />;
  }

  return (
    <>
      <PageHeader title="Skills" count={skills.length} />
      <div className="flex-1 overflow-auto p-5 2xl:p-7 lg:p-6">
        <div className="max-w-5xl mx-auto">
          {privy && ws ? (
            <div className="space-y-4">
              {/* A design spec IS a skill — the studio just knows the shape, so
                  the values come out of a logo and a PDF instead of being typed
                  into a text box. Linked from here because this is where
                  somebody looks when they want their agents to stay on brand. */}
              <a href="/design" className="card-surface p-3 flex items-center gap-3 hover:bg-surface-hover">
                <span className="w-8 h-8 rounded-lg bg-accent/10 text-accent grid place-items-center shrink-0">
                  <Palette className="w-4 h-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-primary">Writing a brand skill? Use the design studio</span>
                  <span className="block text-2xs text-tertiary">
                    Upload a logo and your guidelines, see a live preview, and save it here as a
                    <code className="bg-surface-hover rounded px-1 mx-1">design</code> skill every agent carries.
                  </span>
                </span>
                <ArrowRight className="w-4 h-4 text-tertiary shrink-0" />
              </a>
              <SkillsSection skills={skills} ws={ws.id} privy={privy} onChange={() => ws && privy && reload(ws, privy)} />
              {/* Below the library, not above it: exporting is what you do
                  after you have skills worth exporting. */}
              <PluginExport privy={privy} ws={ws.id} skills={skills} />
            </div>
          ) : (
            <div className="rounded-lg border border-subtle bg-surface-sunken p-4 text-sm text-secondary">
              Sign in to create and import skills.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
