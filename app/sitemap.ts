import type { MetadataRoute } from 'next';
import { abs } from '@/lib/site';
import { ALL_DOC_SLUGS } from '@/lib/docs-nav';

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
