import Link from 'next/link';
import { ArrowLeft, Cookie } from 'lucide-react';
import Logo from '@/components/Logo';

export const metadata = {
  title: 'Cookie Policy — RunButter',
  description: 'The short list of cookies RunButter sets, and why. There is no analytics cookie.',
};

/**
 * The previous version listed "Analytical Cookies" and "Functional Cookies …
 * such as your selected language or dashboard theme". None of that is true:
 * the analytics pipeline sets no cookie at all, the theme lives in
 * localStorage, and there is no language setting.
 *
 * Over-declaring is not the safe direction. Claiming analytics cookies implies
 * a consent obligation this product does not have, and it contradicts the
 * cookieless analytics the product is sold on. So this page now names every
 * cookie that is actually set.
 */

const Row = ({ name, purpose, life }: { name: string; purpose: string; life: string }) => (
  <tr className="border-t border-subtle align-top">
    <td className="py-3 pr-4 font-mono text-2xs text-primary whitespace-nowrap">{name}</td>
    <td className="py-3 pr-4 text-sm text-secondary leading-relaxed">{purpose}</td>
    <td className="py-3 text-2xs text-tertiary whitespace-nowrap">{life}</td>
  </tr>
);

export default function CookiesPage() {
  return (
    <div className="min-h-screen bg-surface-sunken py-12 px-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <Link href="/" className="flex items-center gap-2 text-accent hover:opacity-80 transition-opacity">
            <ArrowLeft className="w-4 h-4" />
            <span>Back to home</span>
          </Link>
          <Logo iconOnly />
        </div>

        <div className="bg-surface rounded-2xl shadow-sm ring-1 ring-subtle p-8 md:p-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-accent-soft rounded-lg flex items-center justify-center">
              <Cookie className="w-6 h-6 text-accent" />
            </div>
            <h1 className="text-3xl font-medium text-primary">Cookie Policy</h1>
          </div>

          <p className="text-secondary mb-8 pb-8 border-b border-subtle">
            <strong>Last updated:</strong> 1 August 2026
          </p>

          <section className="mb-8">
            <h2 className="text-xl font-medium text-primary mb-4">The short version</h2>
            <p className="text-secondary leading-relaxed">
              RunButter sets cookies only where something would not work without them: signing in,
              and protecting the sign-in flow itself. <strong>We set no analytics cookie and no
              advertising cookie</strong>, and we do not share anything with an ad network. That is
              why you are not being asked to dismiss a consent banner.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-medium text-primary mb-4">Every cookie we set</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th className="pb-2 pr-4 text-2xs font-medium uppercase tracking-wider text-tertiary">Name</th>
                    <th className="pb-2 pr-4 text-2xs font-medium uppercase tracking-wider text-tertiary">Purpose</th>
                    <th className="pb-2 text-2xs font-medium uppercase tracking-wider text-tertiary">Lifetime</th>
                  </tr>
                </thead>
                <tbody>
                  <Row
                    name="privy-token"
                    purpose="Keeps you signed in. Set by Privy, our authentication provider. Without it you would be logged out on every page load."
                    life="Session"
                  />
                  <Row
                    name="g_oauth_state"
                    purpose="A single-use random value that proves a Google Calendar connection was started by you. It is what stops someone else's account being attached to your workspace."
                    life="10 minutes"
                  />
                  <Row
                    name="ms_oauth_state"
                    purpose="The same protection for connecting a Microsoft account for the Excel sync."
                    life="10 minutes"
                  />
                </tbody>
              </table>
            </div>
            <p className="text-2xs text-tertiary mt-3">
              Both OAuth cookies are httpOnly, are deleted as soon as the connection completes, and
              are only ever set if you start connecting an account.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-medium text-primary mb-4">Things that are not cookies</h2>
            <ul className="list-disc pl-5 space-y-2 text-secondary leading-relaxed">
              <li>
                <strong>Your light/dark preference</strong> is kept in your browser&rsquo;s local
                storage. It never leaves your device and is never sent to us.
              </li>
              <li>
                <strong>Our web analytics is cookieless.</strong> It records a page view without
                storing anything on your device; IP addresses are hashed with a rotating salt rather
                than stored, and approximate country comes from network headers, not an IP-lookup
                service.
              </li>
              <li>
                <strong>Newsletter tracking is not a cookie either.</strong> If a workspace emails
                you, that message may contain a tracking pixel and rewritten links — that happens in
                the email, not in your browser. See the{' '}
                <Link href="/privacy" className="text-accent underline">Privacy Policy</Link> for
                what is recorded and how to opt out.
              </li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-medium text-primary mb-4">Blocking them</h2>
            <p className="text-secondary leading-relaxed">
              Every browser can block or clear cookies. Because the only ones we set are essential,
              blocking them means you will not be able to sign in or connect an integration — but
              nothing is tracking you either way.
            </p>
          </section>

          <section className="mt-12 pt-8 border-t border-subtle">
            <p className="text-secondary">
              Questions:{' '}
              <a href="mailto:hello@runbutter.app" className="text-accent font-semibold hover:underline">
                hello@runbutter.app
              </a>
            </p>
          </section>
        </div>

        <div className="mt-8 text-center text-secondary text-sm">
          © 2026 runbutter.app
        </div>
      </div>
    </div>
  );
}
