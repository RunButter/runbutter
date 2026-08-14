// Recording what an AI call cost (0101).
//
// ONE ENTRY POINT, because the failure mode this replaces was five callers each
// independently forgetting. `callAI` now returns `{ text, usage }` rather than a
// bare string, so the compiler makes every caller look at the usage — but
// looking at it and storing it are different things, and this is the second
// half.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Usage } from './providers';

/**
 * Where the spend came from.
 *
 * A stable slug per AI feature, never a display name: renaming a screen must
 * not split its history into two rows that nobody can add together afterwards.
 * `agents` is deliberately absent — agent spend lives on `agent_runs` and
 * `get_ai_usage` unions it in, so writing it here too would double-count every
 * run.
 */
export type AIFeature =
  | 'assistant'      // the writing helper: improve / shorten / rewrite
  | 'newsletter'     // the newsletter drafter
  | 'workspace'      // the workspace blueprint builder
  | 'skill'          // the skill / plugin generator
  | 'automation'     // an AI step inside an automation, run unattended
  | 'insights'       // a question turned into a chart spec (/api/insights/ask)
  | 'extract'        // a pasted document turned into form values (/api/records/extract)
  | 'investor';      // the prose around an investor update's real figures

export interface UsageRecord {
  workspace: string | null | undefined;
  privy?: string | null;
  feature: AIFeature;
  provider: string;
  model: string;
  usage: Usage;
  /** False when the call threw. A failed call still costs, and is usually the interesting one. */
  ok?: boolean;
}

/**
 * Record one AI call. Never throws, never blocks the answer.
 *
 * ACCOUNTING MUST NOT BE ABLE TO FAIL THE REQUEST THAT PRODUCED IT. The user
 * already has their draft in hand by the time this runs; turning a usage-write
 * problem into a 500 would trade the work for the bookkeeping. A workspace that
 * has not run 0101 has no table and lands here too, which is the same reason —
 * the feature keeps working and the numbers start appearing once the migration
 * does.
 *
 * `await`ed rather than fired and forgotten: a serverless function can be
 * frozen the moment it returns a response, and a floating promise is how you
 * get accounting that works locally and silently records nothing in production.
 */
export async function recordAIUsage(admin: SupabaseClient, rec: UsageRecord): Promise<void> {
  if (!rec.workspace) return;
  try {
    const { error } = await admin.rpc('record_ai_usage', {
      p_workspace: rec.workspace,
      p_privy: rec.privy || null,
      p_feature: rec.feature,
      p_provider: rec.provider || '',
      p_model: rec.model || '',
      p_input: rec.usage?.input ?? 0,
      p_output: rec.usage?.output ?? 0,
      p_cached: rec.usage?.cached ?? 0,
      p_ok: rec.ok !== false,
    });
    // `.rpc()` returns { data, error } and never throws, so an unchecked call
    // here would be a silent no-op forever — the exact bug CLAUDE.md warns
    // about. There is nothing useful to do with the error but not swallowing it
    // invisibly is why it is read at all.
    if (error && process.env.NODE_ENV !== 'production') {
      console.warn('[ai-usage] not recorded:', error.message);
    }
  } catch {
    /* accounting is never worth an exception in the caller's path */
  }
}
