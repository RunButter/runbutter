'use client';

import { getAccessToken } from '@privy-io/react-auth';
import { rpc } from '@/lib/rpc';

// Client side of sanctions screening (migration 0058). Screening itself is a
// local Postgres lookup against the ingested OFAC lists, so there is no
// third-party call here and no per-query cost — see the migration header.

export interface SanctionsMatch {
  id: number;
  name: string;
  source: string;
  entity_type: string | null;
  programs: string[];
  countries: string[];
  aliases: string[];
  addresses: string[];
  remarks: string | null;
  score: number;
}

export interface ScreeningResult {
  /** 'no_data' means no list has been imported — NOT that the name is clear. */
  status: 'clear' | 'review' | 'no_data';
  query: string;
  normalized: string;
  match_count: number;
  top_score: number | null;
  matches: SanctionsMatch[];
  screened_at: string;
}

export interface SanctionsSource {
  source: string;
  label: string;
  url: string | null;
  entity_count: number;
  synced_at: string | null;
  last_error: string | null;
}

export interface SanctionsStatus {
  total: number;
  sources: SanctionsSource[];
}

/** Screen a name and record the check. Returns an error string, never throws. */
export async function screenName(
  privyUserId: string, workspaceId: string, query: string,
  object?: string | null, recordId?: string | null,
): Promise<{ result?: ScreeningResult; error?: string }> {
  const { data, error } = await rpc('screen_sanctions', {
    p_privy: privyUserId, p_workspace: workspaceId, p_query: query,
    p_object: object ?? null, p_record: recordId ?? null,
  });
  if (error) {
    if (/QUERY_TOO_SHORT/.test(error.message)) return { error: 'Enter at least three characters to screen.' };
    if (/NOT_A_MEMBER/.test(error.message)) return { error: 'You are not a member of this workspace.' };
    // The RPC is missing until 0058 is run by hand in the SQL editor.
    if (/does not exist|schema cache/i.test(error.message)) {
      return { error: 'Screening is not set up yet — run migration 0058 in Supabase.' };
    }
    return { error: error.message };
  }
  return { result: data as ScreeningResult };
}

/** How big the imported list is and when each source last synced. */
export async function loadSanctionsStatus(privyUserId: string, workspaceId: string): Promise<SanctionsStatus | null> {
  const { data, error } = await rpc('get_sanctions_status', { p_privy: privyUserId, p_workspace: workspaceId });
  if (error || !data) return null;
  return data as SanctionsStatus;
}

/** Past screenings — all of them, or just one record's. */
export async function loadScreenings(privyUserId: string, workspaceId: string, recordId?: string | null) {
  const { data, error } = await rpc('get_sanctions_screenings', {
    p_privy: privyUserId, p_workspace: workspaceId, p_record: recordId ?? null,
  });
  return error || !Array.isArray(data) ? [] : data;
}

/** Re-download the OFAC lists. Slow (tens of thousands of rows) — show a spinner. */
export async function refreshSanctionsList(): Promise<{ ok?: boolean; sources?: any[]; error?: string }> {
  try {
    const token = await getAccessToken().catch(() => null);
    const res = await fetch('/api/sanctions/refresh', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body?.error || `Update failed (HTTP ${res.status}).` };
    return body;
  } catch (e: any) {
    return { error: e?.message || 'Update failed.' };
  }
}
