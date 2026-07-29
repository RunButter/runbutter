'use client';

import { supabase } from '@/lib/supabase';
import { getWorkspace } from '@/lib/crm/data';

/**
 * Which company the HR screens are looking at.
 *
 * This exists because "pick a company_users row for this Privy id" is the wrong
 * question the moment someone belongs to two companies, and several screens
 * were asking it directly:
 *
 *   .eq('privy_user_id', id).single()      → "multiple rows returned", hard fail
 *   .eq('privy_user_id', id).limit(1)      → an ARBITRARY company, silent wrong answer
 *
 * Postgres gives no ordering guarantee without ORDER BY, so the second form can
 * return a different company from one query to the next — which reads as
 * "my positions disappeared" while the same rows are plainly visible on the
 * public careers page (that resolves the company from its slug instead).
 *
 * The right answer is the ACTIVE workspace, so the workspace switcher actually
 * governs what HR shows. This mirrors hr_company_id() (0051) exactly: prefer
 * the membership matching the active workspace, otherwise the OLDEST membership
 * — deterministic either way. workspace_id == company_id (0005 sync trigger),
 * so the active workspace id IS the company id.
 */
export interface HrCompany {
  /** companies.id — also the workspace id. */
  companyId: string;
  /** company_users.id for this person in that company; needed for created_by. */
  membershipId: string | null;
  role: string | null;
}

export async function resolveHrCompany(privyUserId: string): Promise<HrCompany | null> {
  // 1. The active workspace, when this person is a member of it.
  const ws = await getWorkspace(privyUserId).catch(() => null);
  if (ws?.id) {
    const { data } = await supabase
      .from('company_users')
      .select('id, role, company_id')
      .eq('privy_user_id', privyUserId)
      .eq('company_id', ws.id)
      .limit(1)
      .maybeSingle();
    if (data) return { companyId: data.company_id, membershipId: data.id, role: data.role ?? null };
    // Membership row missing but the workspace resolved — the legacy ATS row
    // was never created. Still return the id so reads work; writes needing
    // membershipId can surface their own error.
    return { companyId: ws.id, membershipId: null, role: null };
  }

  // 2. Fallback: oldest membership. ORDER BY is the point — without it this is
  //    the very non-determinism described above.
  const { data } = await supabase
    .from('company_users')
    .select('id, role, company_id')
    .eq('privy_user_id', privyUserId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? { companyId: data.company_id, membershipId: data.id, role: data.role ?? null } : null;
}

/** Convenience for the many callers that only need the id. */
export async function resolveHrCompanyId(privyUserId: string): Promise<string | null> {
  return (await resolveHrCompany(privyUserId))?.companyId ?? null;
}
