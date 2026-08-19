'use client';

import { rpc } from '@/lib/rpc';
import { EMPTY_TOKENS, normalizeTokens, starterTokens, type DesignTokens } from '@/lib/design/tokens';

/**
 * Reading and writing the workspace's design spec.
 *
 * ── A MISSING SPEC IS SEEDED, NOT INVENTED ──────────────────────────────────
 * On a workspace that has never had one, the studio opens on `starterTokens`
 * carrying the accent and the name the workspace already branded itself with —
 * a starting point that is already correct rather than already empty, which is
 * the same reason the skills editor stopped opening a blank box. Nothing is
 * saved until somebody presses save, so an unopened workspace has no spec and
 * says so honestly rather than claiming a brand it never chose.
 */

export async function loadDesign(privy: string, ws: string): Promise<{ tokens: DesignTokens; saved: boolean; error?: string }> {
  const { data, error } = await rpc('get_design_tokens', { p_privy: privy, p_workspace: ws });
  if (error) {
    // Degrade rather than break: a workspace on an older schema still gets a
    // working studio, it just cannot save yet. The message names the migration
    // because "something went wrong" is not a thing anybody can act on.
    return {
      tokens: { ...EMPTY_TOKENS },
      saved: false,
      error: /Could not find the function|schema cache/i.test(error.message || '')
        ? 'Saving needs migration 0125 — run it in Supabase. Everything else on this screen works meanwhile.'
        : error.message,
    };
  }
  if (!data) return { tokens: { ...EMPTY_TOKENS }, saved: false };
  return { tokens: normalizeTokens(data), saved: true };
}

export async function saveDesign(privy: string, ws: string, t: DesignTokens): Promise<{ error?: string }> {
  const { error } = await rpc('save_design_tokens', { p_privy: privy, p_workspace: ws, p_data: t });
  if (!error) return {};
  const m = error.message || '';
  if (/TOO_LARGE/.test(m)) return { error: 'That is too long to store — around eighty pages is the limit. Shorten the prose; the values are never the problem.' };
  if (/Could not find the function|schema cache/i.test(m)) return { error: 'Saving needs migration 0125 — run it in Supabase.' };
  return { error: m };
}

/** The starting point for a workspace that has never had a spec. */
export const seedFrom = (name: string, accent?: string | null) => starterTokens(name, accent || '#4653CE');
