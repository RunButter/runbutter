/**
 * The site's own absolute URL, in one place.
 *
 * It was a `const` inside app/layout.tsx, which was fine while only the
 * metadata needed it. robots.txt, the sitemap and llms.txt all need the same
 * answer, and three copies of an `||` chain is how one of them ends up pointing
 * at localhost in production and nobody notices for a month.
 *
 * NEXT_PUBLIC_APP_URL first (what layout.tsx already used), then
 * NEXT_PUBLIC_SITE_URL, which is the variable the newsletter and OAuth code
 * reads. Accepting both is deliberate: a deployment that set only one of them
 * should not get a sitemap full of the wrong host.
 *
 * The trailing slash is stripped because every caller concatenates a path onto
 * it, and `https://runbutter.app//sitemap.xml` is a different URL to a crawler.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  'https://runbutter.app'
).replace(/\/+$/, '');

/** `https://runbutter.app/x` from `/x` or `x`. */
export const abs = (path = '/') => `${SITE_URL}/${String(path).replace(/^\/+/, '')}`;
