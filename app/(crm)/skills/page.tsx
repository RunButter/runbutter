'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Loader2 } from 'lucide-react';
import { getWorkspace, type WorkspaceContext } from '@/lib/crm/data';
import { listSkills, type Skill } from '@/lib/crm/skills';
import SkillsSection from '@/components/crm/SkillsSection';
import PageHeader from '@/components/dashboard/PageHeader';

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
    return <div className="h-full flex items-center justify-center text-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <>
      <PageHeader title="Skills" count={skills.length} />
      <div className="flex-1 overflow-auto p-5 2xl:p-7 lg:p-6">
        <div className="max-w-5xl mx-auto">
          {privy && ws ? (
            <SkillsSection skills={skills} ws={ws.id} privy={privy} onChange={() => ws && privy && reload(ws, privy)} />
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
