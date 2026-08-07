import { SITE_URL, abs } from '@/lib/site';
import { PLANS, PLAN_ORDER } from '@/lib/plans';
import { REPO_URL } from './MarketingChrome';

/**
 * JSON-LD for the landing page.
 *
 * The careers pages have had `JobPosting` since 0063 — which is what makes them
 * eligible for Google Jobs — and the marketing side had nothing at all. So a
 * search engine and an answer engine both had to infer what RunButter is, what
 * it costs and who makes it from prose. They are usually right, and "usually"
 * is a poor way to publish your own pricing.
 *
 * THREE TYPES, EACH EARNING ITS PLACE:
 *
 *   SoftwareApplication  what the product is and what it costs. The offers come
 *                        from lib/plans.ts, the same file that gates features.
 *   Organization         who publishes it, so the entity is not guessed at.
 *   FAQPage              the FAQ is real, visible on the page, and answers the
 *                        questions people actually type. It is also one of the
 *                        few rich results Google still renders.
 *
 * ── THE RULE THAT MATTERS ───────────────────────────────────────────────────
 * Structured data must describe what a human can SEE on the page. Google treats
 * an FAQPage whose questions are not on screen as spam, and it is right to —
 * the entire value of the format is that it is a machine-readable copy of the
 * truth, not a second, better version of it for robots. So `faq` is passed in
 * from the page's own array rather than duplicated here, and if a question is
 * ever removed from the page it leaves this at the same time.
 */
export default function StructuredData({ faq }: { faq: { q: string; a: string }[] }) {
  const offers = PLAN_ORDER
    // Enterprise has no number, and an Offer with no price is worse than no
    // Offer: it is an empty claim in a field a search engine may surface.
    .filter((id) => PLANS[id].priceValue > 0 || id === 'free')
    .map((id) => ({
      '@type': 'Offer',
      name: PLANS[id].name,
      price: String(PLANS[id].priceValue),
      priceCurrency: 'USD',
      ...(PLANS[id].perSeat
        ? { priceSpecification: { '@type': 'UnitPriceSpecification', price: String(PLANS[id].priceValue), priceCurrency: 'USD', unitText: 'seat per month' } }
        : {}),
      url: abs('/#pricing'),
    }));

  const graph = [
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE_URL}/#software`,
      name: 'RunButter',
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'CRM, ERP, Accounting, Recruiting',
      operatingSystem: 'Web, Docker, Linux',
      url: SITE_URL,
      description:
        'An open-source company OS: sales, finance, marketing, projects and hiring on one relational Postgres core, with AI agents that run on your own API key.',
      license: 'https://opensource.org/licenses/MIT',
      isAccessibleForFree: true,
      softwareHelp: abs('/developers'),
      codeRepository: REPO_URL,
      offers,
      // No aggregateRating. There are no reviews, and inventing a star count is
      // the exact kind of claim this whole codebase refuses to make.
    },
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#org`,
      name: 'RunButter',
      url: SITE_URL,
      logo: abs('/icon.svg'),
      sameAs: [REPO_URL],
    },
    {
      '@type': 'FAQPage',
      '@id': `${SITE_URL}/#faq`,
      mainEntity: faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ];

  return (
    <script
      type="application/ld+json"
      // The content is ours and built from typed constants — no user input
      // reaches it. `<` is still escaped because a literal `</script>` inside a
      // JSON string ends the tag early and breaks the page.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c'),
      }}
    />
  );
}
