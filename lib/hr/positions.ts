'use client';

import { rpc } from '@/lib/rpc';

/**
 * Positions, through the verified proxy.
 *
 * The HR screens used to hold `supabase.from('positions')` directly. That
 * worked only because the anon role had a SELECT grant on the table — i.e. the
 * job list of every workspace was readable by anyone with the anon key, which
 * ships in the browser bundle. 0077 revoked it, correctly, and the screens went
 * blank ("my positions disappeared") while creating one failed with
 * `permission denied for table companies` from the plan check beside it.
 *
 * Everything here goes through /api/rpc, which verifies the Privy JWT and
 * OVERWRITES p_privy with the verified subject — so passing somebody else's id
 * is not a thing a caller can do.
 */

export interface HrPosition {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  department: string | null;
  location: string | null;
  employment_type: string | null;
  neuro_profile: string | null;
  is_active: boolean;
  is_published: boolean;
  created_at: string;
  updated_at: string | null;
  created_by: string | null;
  /** Present on list only. */
  applicant_count?: number;
}

export type PositionInput = Partial<Omit<HrPosition, 'id' | 'company_id' | 'created_at' | 'updated_at' | 'created_by' | 'applicant_count'>>;

export async function listPositions(privy: string): Promise<HrPosition[]> {
  const { data, error } = await rpc('hr_list_positions', { p_privy: privy });
  // Surfaced, never swallowed. The previous version of this read caught its own
  // error and rendered an empty list, which is how a grant revocation looked
  // exactly like somebody's roles having been deleted.
  if (error) throw new Error(error.message || 'Could not load positions');
  return Array.isArray(data) ? (data as HrPosition[]) : [];
}

export async function getPosition(privy: string, id: string): Promise<HrPosition | null> {
  const { data, error } = await rpc('hr_get_position', { p_privy: privy, p_id: id });
  if (error) throw new Error(error.message || 'Could not load that position');
  return (data as HrPosition) ?? null;
}

export interface AssessmentInput { name?: string; description?: string; questions: unknown[] }

/**
 * `id` null creates. Keys omitted from `input` are left alone on update.
 *
 * `assessment` is only honoured on CREATE, and it lands in the same transaction
 * — assessment_templates is behind the same revoked grant, and a position whose
 * assessment failed to write breaks the candidate flow with nothing on screen
 * to say so.
 */
export async function savePosition(
  privy: string, id: string | null, input: PositionInput, assessment?: AssessmentInput,
): Promise<HrPosition> {
  const { data, error } = await rpc('hr_save_position', {
    p_privy: privy, p_id: id, p_data: input, p_assessment: assessment ?? null,
  });
  if (error) throw new Error(friendly(error.message));
  return data as HrPosition;
}

export async function deletePosition(privy: string, id: string): Promise<boolean> {
  const { data, error } = await rpc('hr_delete_position', { p_privy: privy, p_id: id });
  if (error) throw new Error(friendly(error.message));
  return !!data;
}

/** The RPC raises machine tokens; a person should not read NO_COMPANY. */
function friendly(msg?: string): string {
  const m = msg || '';
  if (m.includes('NO_COMPANY')) return 'Your account is not linked to a company yet. Reload, or re-run onboarding.';
  if (m.includes('TITLE_REQUIRED')) return 'Give the role a title.';
  if (m.includes('NOT_FOUND')) return 'That role no longer exists, or it belongs to another workspace.';
  return m || 'Could not save that role';
}

// ── The default assessment template ─────────────────────────────────────────

export async function getAssessment(privy: string, positionId: string): Promise<any | null> {
  const { data, error } = await rpc('hr_get_assessment', { p_privy: privy, p_position: positionId });
  if (error) throw new Error(error.message || 'Could not load the assessment');
  return data ?? null;
}

export async function saveAssessment(
  privy: string, positionId: string, input: AssessmentInput,
): Promise<any> {
  const { data, error } = await rpc('hr_save_assessment', {
    p_privy: privy, p_position: positionId, p_data: input,
  });
  if (error) throw new Error(friendly(error.message));
  return data;
}
