'use client';

import { rpc } from '@/lib/rpc';

export type SequenceStep =
  | { kind: 'wait'; days: string }
  | { kind: 'email'; newsletter_id: string };

export interface Sequence {
  id: string; name: string; description: string; enabled: boolean;
  entry_list: string | null; entry_segment: string | null;
  steps: SequenceStep[];
  active_count: number; completed_count: number;
  updated_at?: string;
}

export async function listSequences(privy: string, ws: string): Promise<Sequence[]> {
  const { data } = await rpc('get_sequences', { p_privy: privy, p_workspace: ws });
  return Array.isArray(data) ? data : [];
}

const STEP_ERRORS: [RegExp, string][] = [
  [/BAD_STEP_KIND/, 'A step must be either a wait or an email.'],
  [/BAD_WAIT/, 'A wait must be a whole number of days between 0 and 365.'],
  [/BAD_EMAIL_STEP/, 'An email step must point at a newsletter in this workspace.'],
  [/BAD_ENTRY/, 'The entry list or segment no longer exists.'],
  [/TOO_MANY_STEPS/, 'A sequence can hold at most 30 steps.'],
  [/BAD_STEPS/, 'Those steps could not be saved.'],
];

export async function saveSequence(
  privy: string, ws: string, s: Partial<Sequence> & { id?: string | null },
): Promise<{ id: string | null; error?: string }> {
  const { data, error } = await rpc('save_sequence', {
    p_privy: privy, p_workspace: ws, p_id: s.id ?? null,
    p_name: s.name || 'New sequence', p_description: s.description || '',
    p_entry_list: s.entry_list ?? null, p_entry_segment: s.entry_segment ?? null,
    p_steps: s.steps ?? [],
  });
  if (!error) return { id: (data as any) ?? null };
  for (const [re, msg] of STEP_ERRORS) if (re.test(error.message)) return { id: null, error: msg };
  return { id: null, error: error.message };
}

export const setSequenceEnabled = (privy: string, ws: string, id: string, enabled: boolean) =>
  rpc('set_sequence_enabled', { p_privy: privy, p_workspace: ws, p_id: id, p_enabled: enabled });

export const deleteSequence = (privy: string, ws: string, id: string) =>
  rpc('delete_sequence', { p_privy: privy, p_workspace: ws, p_id: id });

export async function getSequenceStats(privy: string, ws: string, id: string): Promise<Record<string, number>> {
  const { data } = await rpc('get_sequence_stats', { p_privy: privy, p_workspace: ws, p_id: id });
  return (data as any) || {};
}

/**
 * Total elapsed days across the wait steps — what the UI shows as the length of
 * the drip. Email steps are instant, so only waits contribute.
 */
export function sequenceLengthDays(steps: SequenceStep[]): number {
  return steps.reduce((a, s) => (s.kind === 'wait' ? a + (Number(s.days) || 0) : a), 0);
}
