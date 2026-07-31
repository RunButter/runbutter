'use client';

import { getAccessToken } from '@privy-io/react-auth';
import { rpc } from '@/lib/rpc';

export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  suggested_tools: string[];
  source: 'local' | 'github';
  source_url: string;
  updated_at?: string;
}

/** What /api/skills/import returns: parsed, NOT saved. */
export interface SkillPreview {
  name: string;
  description: string;
  instructions: string;
  suggested_tools: string[];
  path: string;
}

export async function listSkills(privy: string, ws: string): Promise<Skill[]> {
  const { data } = await rpc('get_skills', { p_privy: privy, p_workspace: ws });
  return Array.isArray(data) ? data : [];
}

export async function saveSkill(
  privy: string, ws: string, s: Partial<Skill> & { id?: string | null }
): Promise<{ id: string | null; error: any }> {
  const { data, error } = await rpc('save_skill', {
    p_privy: privy, p_workspace: ws, p_id: s.id ?? null,
    p_name: s.name || 'New skill', p_description: s.description || '',
    p_instructions: s.instructions || '', p_suggested_tools: s.suggested_tools || [],
    p_source: s.source || 'local', p_source_url: s.source_url || '',
  });
  return { id: data ?? null, error };
}

export async function deleteSkill(privy: string, ws: string, id: string) {
  return rpc('delete_skill', { p_privy: privy, p_workspace: ws, p_id: id });
}

/**
 * Fetch and parse SKILL.md files from a public GitHub repo. Returns a PREVIEW —
 * nothing is written. Importing third-party text that ends up inside a system
 * prompt is a decision a human makes per skill, so the caller saves what they
 * picked; this only reads.
 */
export async function importSkillsFromGithub(url: string): Promise<{ source_url: string; skills: SkillPreview[] }> {
  const token = await getAccessToken().catch(() => null);
  const res = await fetch('/api/skills/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
    body: JSON.stringify({ url }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error || `Import failed (${res.status})`);
  return j;
}
