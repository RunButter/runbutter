import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-static';

/**
 * /robots.txt — which did not exist, so it 404'd.
 *
 * A missing robots.txt is not a block: crawlers assume permission. What it
 * costs is the sitemap pointer, which is the cheapest way to tell a search
 * engine about pages nothing links to prominently — every one of the developer
 * docs, in our case.
 *
 * ── AI CRAWLERS ARE ALLOWED, DELIBERATELY ───────────────────────────────────
 * The reflex in 2026 is to block GPTBot, ClaudeBot, PerplexityBot and the rest.
 * That reflex is for publishers whose business IS the words on the page. Ours is
 * not: an answer engine describing RunButter accurately to somebody asking
 * "open source CRM I can self-host" is free distribution to exactly the person
 * we want. Blocking them would remove us from the fastest-growing way software
 * gets discovered, to protect marketing copy we would happily hand out.
 *
 * The app itself is a different question, hence the disallow list below — it is
 * all authenticated or machine-facing, and none of it belongs in an index.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',            // machine endpoints; several are cron-authenticated
          '/dashboard/',      // the HR app — behind login, and thin without it
          '/auth/',
          '/settings/',
          '/objects/',
          '/pipelines/',
          '/documents/',
          '/sign/',           // one-time signing links
          '/review/',
          '/l/',              // short-link redirects: the destination is what matters
          '/f/',              // hosted forms belong to the workspace, not to us
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
