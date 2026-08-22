import type { Metadata } from 'next';
import { MarketingHeader, MarketingFooter } from '@/components/landing/MarketingChrome';
import ToolFooter from '@/components/landing/ToolFooter';
import { SITE_URL } from '@/lib/site';

/**
 * The PDF toolkit, as a public page.
 *
 * ── IT WAS INSIDE THE SIGNED-IN APP, AND THAT WAS COSTING REAL VISITORS ─────
 * `app/(crm)/pdf` renders behind the workspace shell: a nav rail, a Privy mount
 * and "Getting your workspace ready" — for a tool that uses no account, touches
 * no database and imports Privy nowhere. So the README, the footer and the
 * sitemap all advertised a free tool that greeted a stranger with somebody
 * else's application chrome and a loading spinner, and `PUBLIC_PREFIXES` listed
 * `/pdf-tools`, a route that does not exist, so it loaded the auth SDK too.
 *
 * The page itself is unchanged — it was already pure client code. Only where it
 * lives changed.
 *
 * A LAYOUT rather than a wrapper component, because the page is `'use client'`
 * and a client module cannot export `metadata`. Without that export the tool
 * has no title, no description and no canonical, which for a page whose entire
 * job is to be found by search is most of the point.
 */

const TITLE = 'Free PDF toolkit — merge, split, rotate, watermark';
const DESCRIPTION =
  'Merge, split, rotate, delete pages, watermark, images to PDF, PDF to images and PDF to Markdown. Everything runs in your browser — your files are never uploaded. Free, no account, MIT.';

export const metadata: Metadata = {
  title: `${TITLE} — RunButter`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/pdf` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${SITE_URL}/pdf`, type: 'website' },
};

export default function PdfLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-primary antialiased">
      <MarketingHeader />
      <div className="max-w-6xl mx-auto px-6 pt-24 md:pt-28">{children}</div>
      <ToolFooter
        current="/pdf"
        headline="The same PDF engine renders your invoices"
        body="This page uses the exact code RunButter uses to produce branded invoices, offers and signed contracts — which is why it never uploads anything. RunButter is the rest of it: the invoice that becomes the PDF, the client it goes to, the payment that reconciles it, and an AI agent that can read the contract you just merged."
      />
      <MarketingFooter />
    </div>
  );
}
