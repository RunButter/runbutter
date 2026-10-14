'use client';

import { rpc } from '@/lib/rpc';
import { authHeaders } from '@/lib/files/client';

// Customer surveys (0138), team side. Reads and settings through /api/rpc;
// sending through /api/surveys/send because it emails people.

export type SurveyKind = 'nps' | 'csat';
export interface Survey {
  id: string; name: string; kind: SurveyKind; question: string; followup_question: string | null; thank_you: string | null;
  enabled: boolean; created_at: string; invites?: number; responses?: number; promoters?: number; detractors?: number; average?: number | null;
}
export interface SurveyResponse {
  id: string; score: number; comment: string | null; bucket: 'promoter' | 'passive' | 'detractor'; source: 'email' | 'link';
  person_id: string | null; company_id: string | null; email: string | null; name: string | null; company: string | null; created_at: string;
}
export interface SurveyResults {
  survey: Survey; invites: number; distribution: Record<string, number>;
  trend: { month: string; responses: number; promoters: number; detractors: number; average: number }[];
  responses: SurveyResponse[];
}

const NOT_SET_UP = /survey|does not exist|PGRST202/i;
const explain = (m: string) => (/FORBIDDEN/.test(m) ? 'Viewers cannot change surveys.' : /NOT_FOUND/.test(m) ? 'Survey not found.' : NOT_SET_UP.test(m) && /does not exist|PGRST202/.test(m) ? 'Surveys need migration 0138 — run it in Supabase.' : m);

export async function loadSurveys(privy: string, ws: string) {
  const { data, error } = await rpc('get_surveys', { p_privy: privy, p_workspace: ws });
  return error ? { error: explain(error.message) } : { surveys: (data as Survey[]) || [] };
}
export async function saveSurvey(privy: string, ws: string, data: Partial<Survey>) {
  const { data: out, error } = await rpc('save_survey', { p_privy: privy, p_workspace: ws, p_data: data });
  return error ? { error: explain(error.message) } : { survey: out as Survey };
}
export async function deleteSurvey(privy: string, id: string) {
  const { error } = await rpc('delete_survey', { p_privy: privy, p_id: id });
  return error ? { error: explain(error.message) } : {};
}
export async function loadResults(privy: string, id: string, from: string | null, to: string | null) {
  const { data, error } = await rpc('get_survey_results', { p_privy: privy, p_id: id, p_from: from, p_to: to });
  return error ? { error: explain(error.message) } : { results: data as SurveyResults };
}
export async function sendSurvey(ws: string, surveyId: string, personIds: string[], force = false): Promise<{ data?: { created: number; sent: number; skipped: Record<string, number> }; error?: string }> {
  try {
    const res = await fetch('/api/surveys/send', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ workspaceId: ws, surveyId, personIds, force }) });
    const d = await res.json().catch(() => ({}));
    return res.ok ? { data: d } : { error: d.error || 'Could not send.' };
  } catch (e: any) { return { error: e?.message || 'Could not send.' }; }
}

/** NPS = % promoters − % detractors; CSAT = % satisfied (4–5). */
export function headline(kind: SurveyKind, promoters: number, detractors: number, total: number): { value: string; label: string } {
  if (!total) return { value: '—', label: kind === 'nps' ? 'NPS' : 'CSAT' };
  return kind === 'nps'
    ? { value: String(Math.round(((promoters - detractors) / total) * 100)), label: 'NPS' }
    : { value: `${Math.round((promoters / total) * 100)}%`, label: 'satisfied' };
}
