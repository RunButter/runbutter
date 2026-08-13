'use client';

import { getAccessToken } from '@privy-io/react-auth';
import { rpc } from '@/lib/rpc';

export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  suggested_tools: string[];
  /** 0103 added `copilot`: a skill the copilot wrote is neither hand-written nor imported. */
  source: 'local' | 'github' | 'copilot';
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

/**
 * Write a skill from a description, in the app, into this workspace.
 *
 * The same route the public builder at /plugins uses — it generates, lints the
 * draft, and hands the findings back to the model until they are gone. It
 * returns a DRAFT and saves nothing: the caller opens it in the editor so a
 * person reads it before it becomes a skill agents will follow.
 *
 * Identity comes from the signed Privy cookie, not the body, which is why this
 * needs no arguments beyond the description.
 */
export async function generateSkill(description: string): Promise<{ skill?: Partial<Skill>; remaining?: string[]; error?: string; signin?: boolean }> {
  const res = await fetch('/api/plugins/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.skill) return { error: body?.error || 'Could not write that skill.', signin: !!body?.signin };
  const g = body.skill;
  return {
    // `resources` are dropped on purpose: an in-app skill is a single
    // instruction pack (0068) with no place to put supporting files. Their
    // content is folded into the body so nothing the model wrote is lost —
    // silently discarding half a generated skill would be worse than a long one.
    skill: {
      name: g.name,
      description: g.description,
      instructions: [g.instructions, ...(g.resources || []).map((r: any) => `\n\n## ${r.path}\n\n${r.content}`)].join(''),
      suggested_tools: [],
    },
    remaining: body.remaining || [],
  };
}
