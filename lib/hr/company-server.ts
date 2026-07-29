import { createAdminClient } from '@/lib/supabase';

/**
 * Server-side twin of lib/hr/company.ts.
 *
 * Same defect being closed: `.eq('privy_user_id', id).limit(1)` has no ORDER BY,
 * so Postgres may return a different membership row per call. On a read that
 * shows an empty list; on /api/team/invite it silently sends the invitation to
 * whichever of the caller's companies came back — a coin flip for anyone who
 * owns two.
 *
 * Mirrors hr_company_id() (0051): the membership matching the ACTIVE workspace,
 * otherwise the OLDEST. Both branches are deterministic.
 *
 * Kept separate from the client helper because that one is 'use client' and
 * pulls in the Privy SDK; this runs as service_role with no session.
 */
export interface ServerHrCompany {
  companyId: string;
  membershipId: string | null;
  role: string | null;
}

export async function resolveHrCompanyServer(privyUserId: string): Promise<ServerHrCompany | null> {
  const admin = createAdminClient();

  // get_my_workspace is granted to service_role (0051) and resolves through
  // effective_workspace, so this is the same answer the UI sees.
  let activeId: string | null = null;
  const { data: ws, error: wsError } = await admin.rpc('get_my_workspace', { p_privy: privyUserId });
  if (!wsError && ws) activeId = (ws as any)?.id ?? null;

  if (activeId) {
    const { data } = await admin
      .from('company_users')
      .select('id, role, company_id')
      .eq('privy_user_id', privyUserId)
      .eq('company_id', activeId)
      .limit(1)
      .maybeSingle();
    if (data) return { companyId: data.company_id, membershipId: data.id, role: data.role ?? null };
  }

  // ORDER BY is the entire point of this fallback.
  const { data } = await admin
    .from('company_users')
    .select('id, role, company_id')
    .eq('privy_user_id', privyUserId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? { companyId: data.company_id, membershipId: data.id, role: data.role ?? null } : null;
}
