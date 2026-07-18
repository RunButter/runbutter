'use client';

import { rpc } from '@/lib/rpc';

// HR add/delete management (interviews + candidates), all through the verified
// /api/rpc proxy → the hr_* DEFINER RPCs in migration 0044.

export interface Interview {
  id: string; candidate_id: string; candidate_name: string; candidate_email: string;
  position_title: string | null; scheduled_at: string; duration_minutes: number;
  status: string; notes: string | null; meet_link: string | null;
}
export interface PositionMin { id: string; title: string }
export interface CandidateLite { id: string; full_name: string; email: string }

// Lightweight candidate list for pickers (reuses the recruiter search RPC).
export async function searchCandidatesLite(privy: string, query: string): Promise<CandidateLite[]> {
  const { data } = await rpc('search_candidates_for_recruiter', { p_privy_user_id: privy, p_query: query || null });
  return (Array.isArray(data) ? data : []).map((c: any) => ({ id: c.id, full_name: c.full_name, email: c.email }));
}

export async function listInterviews(privy: string): Promise<Interview[]> {
  const { data } = await rpc('hr_list_interviews', { p_privy: privy });
  return Array.isArray(data) ? data : [];
}

export async function scheduleInterview(
  privy: string, candidateId: string, scheduledAt: string, durationMinutes: number, notes: string,
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await rpc('hr_schedule_interview', {
    p_privy: privy, p_candidate_id: candidateId, p_scheduled_at: scheduledAt,
    p_duration: durationMinutes, p_notes: notes,
  });
  return { id: data ?? null, error: error?.message ?? null };
}

export async function cancelInterview(privy: string, id: string): Promise<{ error: string | null }> {
  const { error } = await rpc('hr_cancel_interview', { p_privy: privy, p_id: id });
  return { error: error?.message ?? null };
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
