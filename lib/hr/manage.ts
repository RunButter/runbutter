'use client';

import { getAccessToken } from '@privy-io/react-auth';
import { rpc } from '@/lib/rpc';

// HR management (interviews + candidates).
//  • Reads + candidate add/delete go through the /api/rpc proxy (hr_* DEFINER
//    RPCs, migration 0044).
//  • Interview schedule/edit/cancel go through /api/hr/interviews (migration
//    0045) because they orchestrate Google Meet + the candidate email around
//    the DB write — identity comes from the verified Privy token, not an arg.

export interface Interview {
  id: string; candidate_id: string; candidate_name: string; candidate_email: string;
  position_title: string | null; scheduled_at: string; duration_minutes: number;
  status: string; notes: string | null; meet_link: string | null;
}
export interface PositionMin { id: string; title: string }
export interface CandidateLite { id: string; full_name: string; email: string }

async function hrFetch(path: string, method: string, body?: any): Promise<{ data: any; error: string | null }> {
  try {
    const token = await getAccessToken().catch(() => null);
    const res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) return { data: null, error: j?.error || `Request failed (HTTP ${res.status})` };
    return { data: j, error: null };
  } catch (e: any) {
    return { data: null, error: e?.message || 'Network error' };
  }
}

// ── Interviews ────────────────────────────────────────────────────────────────
export async function listInterviews(privy: string): Promise<Interview[]> {
  const { data } = await rpc('hr_list_interviews', { p_privy: privy });
  return Array.isArray(data) ? data : [];
}

export interface ScheduleResult { id: string | null; meetLink: string | null; meet: boolean; emailed: boolean; error: string | null }

export async function scheduleInterview(
  candidateId: string, scheduledAt: string, durationMinutes: number, notes: string,
): Promise<ScheduleResult> {
  const { data, error } = await hrFetch('/api/hr/interviews', 'POST', {
    candidateId, scheduledAt, durationMinutes, notes,
  });
  return {
    id: data?.id ?? null, meetLink: data?.meetLink ?? null,
    meet: !!data?.meet, emailed: !!data?.emailed, error,
  };
}

export async function updateInterview(
  id: string, scheduledAt: string, durationMinutes: number, notes: string,
): Promise<{ ok: boolean; emailed: boolean; error: string | null }> {
  const { data, error } = await hrFetch(`/api/hr/interviews/${id}`, 'PATCH', { scheduledAt, durationMinutes, notes });
  return { ok: !!data?.ok, emailed: !!data?.emailed, error };
}

export async function cancelInterview(id: string): Promise<{ error: string | null }> {
  const { error } = await hrFetch(`/api/hr/interviews/${id}`, 'DELETE');
  return { error };
}

export async function isGoogleConnected(privy: string): Promise<boolean> {
  const { data } = await rpc('hr_google_connected', { p_privy: privy });
  return data === true;
}

// ── Candidate pickers + add/delete ────────────────────────────────────────────
export async function searchCandidatesLite(privy: string, query: string): Promise<CandidateLite[]> {
  const { data } = await rpc('search_candidates_for_recruiter', { p_privy_user_id: privy, p_query: query || null });
  return (Array.isArray(data) ? data : []).map((c: any) => ({ id: c.id, full_name: c.full_name, email: c.email }));
}

export async function listPositionsMin(privy: string): Promise<PositionMin[]> {
  const { data } = await rpc('hr_list_positions_min', { p_privy: privy });
  return Array.isArray(data) ? data : [];
}

export async function createCandidate(
  privy: string, fullName: string, email: string, phone: string, linkedin: string, positionId: string | null,
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await rpc('hr_create_candidate', {
    p_privy: privy, p_full_name: fullName, p_email: email,
    p_phone: phone, p_linkedin: linkedin, p_position_id: positionId,
  });
  return { id: data ?? null, error: error?.message ?? null };
}

export async function deleteCandidate(privy: string, id: string): Promise<{ error: string | null }> {
  const { error } = await rpc('hr_delete_candidate', { p_privy: privy, p_id: id });
  return { error: error?.message ?? null };
}
