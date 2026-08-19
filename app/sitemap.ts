import type { MetadataRoute } from 'next';
import { abs } from '@/lib/site';
import { ALL_DOC_SLUGS } from '@/lib/docs-nav';
import { PRESETS } from '@/lib/design/presets';

export const dynamic = 'force-static';

/**
 * /sitemap.xml — which did not exist either.
 *
 * The marketing pages would be found eventually: they are linked from the
 * homepage and the homepage is linked from GitHub. The DOCS would not, or not
 * quickly — seventeen pages reachable only through a sidebar on one route, each
 * one answering a question somebody is typing into a search box right now
 * ("self-host CRM docker", "postgres MCP server"). Those are the pages worth
 * indexing, and they are the ones a crawler is least likely to reach.
 *
 * GENERATED FROM lib/docs-nav.ts, not listed by hand. A sitemap that is a
 * hand-kept copy of a route list is a sitemap that goes stale silently and then
 * advertises 404s, which is worse than not having one.
 *
 * Authenticated and per-workspace routes are absent on purpose: a careers page
 * belongs to the workspace that publishes it, and it is discoverable from that
 * workspace's own site, not from ours.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  // Marketing: what a stranger should land on, in the order we would rank them.
  const marketing: [string, number, MetadataRoute.Sitemap[number]['changeFrequency']][] = [
    ['/', 1, 'weekly'],
    ['/ai-agents', 0.9, 'monthly'],
    ['/developers', 0.9, 'weekly'],
    // Free tools: each is its own reason to visit, from a search that has
    // nothing to do with wanting a CRM.
    ['/plugins', 0.8, 'monthly'],
    // The agent cost calculator. Higher than the other tools because the search
    // it answers ('what does an AI agent cost') is one nobody else answers, and
    // whoever types it is exactly who this product is for.
    ['/ai-cost', 0.85, 'monthly'],
    // The DESIGN.md builder. Same priority as the skill builder: the search it
    // answers ('brand tokens from a logo', 'DESIGN.md for AI') is one nobody
    // else answers, and whoever types it is exactly who this is for.
    ['/brand', 0.8, 'monthly'],
    // The published library. Its entries are found by FOLLOWING links from this
    // page rather than enumerated here — a build-time sitemap of database rows
    // is stale the moment somebody publishes, and a stale sitemap advertises
    // pages that do not exist yet as readily as it lists ones that do.
    ['/brand/library', 0.7, 'daily'],
    ['/pdf', 0.7, 'monthly'],
    ['/contact', 0.4, 'yearly'],
    ['/privacy', 0.3, 'yearly'],
    ['/terms', 0.3, 'yearly'],
    ['/cookies', 0.3, 'yearly'],
  ];

  return [
    ...marketing.map(([path, priority, changeFrequency]) => ({
      url: abs(path),
      lastModified: now,
      changeFrequency,
      priority,
    })),
    // One page per DESIGN.md style, GENERATED from the same array the gallery
    // and the builder read. A hand-kept list of routes goes stale silently and
    // then advertises 404s, which is worse than having none.
    ...PRESETS.map((p) => ({
      url: abs(`/brand/style/${p.id}`),
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    // `index` is the /developers root, already listed above — including it
    // again would advertise two URLs for one page.
    ...ALL_DOC_SLUGS.filter((s) => s !== 'index').map((slug) => ({
      url: abs(`/developers/${slug}`),
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
  ];
}
