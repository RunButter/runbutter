import { createAdminClient } from '@/lib/supabase';
import { normalizeTokens, type DesignTokens } from '@/lib/design/tokens';

/**
 * Reading the public style library, server-side.
 *
 * ── NOTHING HERE IS ANON-CALLABLE, AND IT DOES NOT NEED TO BE ───────────────
 * The library is public content, so the obvious move is an anon grant on the
 * read functions — the way the careers pages work, because a candidate has no
 * session. These pages have no browser caller at all: they are server
 * components, so the read happens with the service role behind our own
 * process, and no function has to be added to `keep_public`. Fewer
 * anon-reachable DEFINER functions is strictly better; 0105 exists because that
 * list grew by accident for sixty migrations.
 *
 * ── A LIBRARY OUTAGE IS A 404, NEVER A 500 ─────────────────────────────────
 * Every failure resolves to "not found" or an empty list. A marketing page that
 * returns a stack trace because the database blinked is a worse answer than a
 * page that says there is nothing here yet.
 */

export interface StyleCard {
  slug: string;
  name: string;
  essence?: string | null;
  blurb?: string | null;
  group_key: string;
  author?: string | null;
  heading?: string | null;
  body?: string | null;
  colors: { name: string; hex: string }[];
  created_at: string;
}

export interface PublishedStyle {
  id: string;
  slug: string;
  name: string;
  essence?: string | null;
  blurb?: string | null;
  group_key: string;
  tokens: DesignTokens;
  author?: string | null;
  author_url?: string | null;
  created_at: string;
  updated_at: string;
}

export async function listPublishedStyles(limit = 60, offset = 0): Promise<StyleCard[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('list_design_styles', { p_limit: limit, p_offset: offset });
    if (error || !Array.isArray(data)) return [];
    return data as StyleCard[];
  } catch {
    return [];
  }
}

export async function getPublishedStyle(slug: string): Promise<PublishedStyle | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('get_design_style', { p_slug: slug });
    if (error || !data) return null;
    const row = data as any;
    // Normalised on the way out, so a spec published before a token-model change
    // still renders. The stored snapshot is left exactly as it was published.
    return { ...row, tokens: normalizeTokens(row.tokens) } as PublishedStyle;
  } catch {
    return null;
  }
}
