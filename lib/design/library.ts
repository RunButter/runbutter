'use client';

import { rpc } from '@/lib/rpc';
import { toDesignJson, type DesignTokens } from '@/lib/design/tokens';

/**
 * Publishing a spec to the public library, from the studio.
 *
 * ── WHAT IS SENT IS A COPY, AND THAT IS THE FEATURE ─────────────────────────
 * The tokens travel as a value. Nothing on the public page points at
 * `workspaces.design_tokens`, so editing a draft palette on a Tuesday cannot
 * silently rewrite a page strangers have bookmarked, and a scoping bug on the
 * public route cannot reach a workspace's unpublished brand. Publishing is a
 * decision with a date on it.
 */

export interface MyStyle {
  id: string; slug: string; name: string; essence?: string | null;
  group_key: string; created_at: string; updated_at: string;
}

export interface PublishInput {
  name: string;
  essence?: string;
  blurb?: string;
  group_key?: string;
  author?: string;
  author_url?: string;
}

export async function listMyStyles(privy: string, ws: string): Promise<MyStyle[]> {
  const { data, error } = await rpc('list_my_design_styles', { p_privy: privy, p_workspace: ws }, { quiet: true });
  if (error || !Array.isArray(data)) return [];
  return data as MyStyle[];
}

export async function publishStyle(
  privy: string, ws: string, id: string | null, input: PublishInput, tokens: DesignTokens,
): Promise<{ slug?: string; id?: string; error?: string }> {
  const { data, error } = await rpc('publish_design_style', {
    p_privy: privy, p_workspace: ws, p_id: id,
    p_data: { ...input, tokens },
  });
  if (error) return { error: friendly(error.message) };
  return { slug: (data as any)?.slug, id: (data as any)?.id };
}

export async function unpublishStyle(privy: string, ws: string, id: string): Promise<{ error?: string }> {
  const { error } = await rpc('unpublish_design_style', { p_privy: privy, p_workspace: ws, p_id: id });
  return error ? { error: friendly(error.message) } : {};
}

/** SQL raises for a person to read. The prefixes are for matching, not for showing. */
function friendly(m: string): string {
  if (/NAME_REQUIRED/.test(m)) return 'Give the style a name — it becomes its heading and its URL.';
  if (/TOKENS_REQUIRED/.test(m)) return 'There is nothing to publish yet. Add some colours and type first.';
  if (/BAD_URL/.test(m)) return 'The link has to start with http:// or https://.';
  if (/TOO_LARGE/.test(m)) return 'That spec is too long to publish. Shorten the prose; the values are never the problem.';
  if (/LIBRARY_LIMIT/.test(m)) return 'You have published ten styles, which is the limit. Remove one first.';
  if (/NOT_FOUND/.test(m)) return 'That style is not yours to change.';
  if (/Could not find the function|schema cache/i.test(m)) return 'Publishing needs migration 0127 — run it in Supabase.';
  return m;
}

/** A quick sanity read before publishing, so the preview and the page agree. */
export const publishedShape = (t: DesignTokens) => toDesignJson(t);
