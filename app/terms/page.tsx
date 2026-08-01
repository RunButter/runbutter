import Link from 'next/link';
import { ArrowLeft, FileText } from 'lucide-react';
import Logo from '@/components/Logo';

export const metadata = {
  title: 'Terms of Service — RunButter',
  description: 'The rules for using the hosted RunButter service, including what you may send from it.',
};

/**
 * Updated from an ATS-only document. Two things were missing that matter
 * operationally, not just legally:
 *
 *  1. SENDING EMAIL. Workspaces now send bulk newsletters through our shared
 *     sending infrastructure and domain reputation. One customer mailing a
 *     purchased list degrades deliverability for every other customer, and
 *     there was no term permitting us to stop them.
 *  2. WRITE ACCESS TO CUSTOMER FILES. The Excel sync writes into a user's own
 *     OneDrive/SharePoint workbook, which needs its own allocation of
 *     responsibility.
 *
 * Also corrected the AI disclaimer, which described assessment scoring as
 * probabilistic AI output. It is deterministic arithmetic in the database —
 * see the same correction in the Privacy Policy.
 */

const Section = ({ n, title, children }: { n: string; title: string; children: React.ReactNode }) => (
  <section className="mb-8">
    <h2 className="text-xl font-medium text-primary mb-4">{n}. {title}</h2>
    {children}
  </section>
);

const P = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <p className={`text-secondary leading-relaxed ${className}`}>{children}</p>
);

const List = ({ children }: { children: React.ReactNode }) => (
  <ul className="list-disc pl-5 space-y-2 text-secondary leading-relaxed">{children}</ul>
);

export default function TermsPage() {
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
              <FileText className="w-6 h-6 text-accent" />
            </div>
            <h1 className="text-3xl font-medium text-primary">Terms of Service</h1>
          </div>

          <p className="text-secondary mb-8 pb-8 border-b border-subtle">
            <strong>Last updated:</strong> 1 August 2026
          </p>

          <Section n="1" title="What these terms cover">
            <P className="mb-4">
              These terms govern <strong>runbutter.app</strong>, the hosted service. RunButter is
              also open-source software under the MIT licence: if you self-host it, the MIT licence
              governs your use of the code and these terms do not apply — you are running your own
              service, on your own infrastructure, and are responsible for it.
            </P>
            <P>By creating an account you accept these terms on behalf of yourself and your organisation.</P>
          </Section>

          <Section n="2" title="Your data and your workspace">
            <List>
              <li>
                <strong>Your content is yours.</strong> We claim no ownership of what you put into a
                workspace, and you can export any list at any time.
              </li>
              <li>
                <strong>You are the controller of it.</strong> Where your workspace holds other
                people&rsquo;s personal data — candidates, contacts, subscribers — you decide what
                happens to it and are responsible for having a lawful basis. We process it on your
                instruction. See the{' '}
                <Link href="/privacy" className="text-accent underline">Privacy Policy</Link>.
              </li>
              <li>
                <strong>You are responsible for your members.</strong> Anyone you invite acts under
                your account.
              </li>
            </List>
          </Section>

          <Section n="3" title="Sending email from RunButter">
            <P className="mb-4">
              Newsletters and sequences send through shared infrastructure. One sender mailing people
              who never asked for it damages delivery for everyone else on the platform, so this
              section is enforced rather than decorative.
            </P>
            <List>
              <li>
                <strong>Only send to people who agreed to hear from you.</strong> Purchased,
                scraped, rented, or otherwise harvested lists are not permitted.
              </li>
              <li>
                <strong>Do not remove or obscure the unsubscribe link</strong>, and do not send to
                anyone who has opted out or previously bounced. The product enforces this; working
                around it is a breach of these terms.
              </li>
              <li>
                <strong>Identify yourself honestly.</strong> No misleading sender names, subject
                lines, or headers. You are the sender; RunButter is the tool.
              </li>
              <li>
                <strong>We may suspend sending</strong> — for one workspace or one campaign —
                if bounce or complaint rates threaten the platform&rsquo;s deliverability, or if we
                have reasonable grounds to believe a list was not consent-based. Where practical we
                will tell you first; where the risk is immediate we may act first and explain after.
              </li>
              <li>
                You remain responsible for complying with the law that applies to you — GDPR and
                ePrivacy in the EU, CAN-SPAM in the US, CASL in Canada, and any local equivalent.
              </li>
            </List>
          </Section>

          <Section n="4" title="Assessments and scoring">
            <List>
              <li>
                <strong>How scores are produced:</strong> deterministically, by arithmetic over the
                answers a candidate gives. They are not generated by a language model, and no
                cognitive or IQ measure exists in the product.
              </li>
              <li>
                <strong>What they are not:</strong> a professional psychological assessment or a
                diagnosis, and never a decision. They are one input for a human.
              </li>
              <li>
                <strong>Hiring decisions are yours.</strong> We are not responsible for decisions you
                make, or for how you interpret a score. Solely automated hiring decisions are
                prohibited.
              </li>
            </List>
          </Section>

          <Section n="5" title="AI features">
            <P>
              Where you use an AI feature — drafting, agents — it runs on{' '}
              <strong>your own provider API key</strong>, under that provider&rsquo;s terms, and at
              their cost. AI output is probabilistic and may be wrong; check anything that matters
              before relying on it. Agents act within the tools and permissions you grant them, and
              by default propose changes for a human to approve.
            </P>
          </Section>

          <Section n="6" title="Prohibited use">
            <List>
              <li>
                Discriminating against candidates on protected characteristics (race, religion, sex,
                age, disability and any other protected class) in violation of applicable labour law.
              </li>
              <li>Sending unsolicited bulk email, as described in section 3.</li>
              <li>Uploading malware, or content you have no right to hold or distribute.</li>
              <li>
                Attempting to reach another workspace&rsquo;s data, probe our infrastructure, or
                bypass the plan limits and permission checks.
              </li>
              <li>Reselling the hosted service as your own. (Self-hosting under the MIT licence is expressly fine.)</li>
            </List>
          </Section>

          <Section n="7" title="Connected accounts, including write access">
            <P className="mb-4">
              You may connect third-party accounts — Google Calendar for interviews, Microsoft for
              the Excel sync. All are optional and can be disconnected at any time.
            </P>
            <List>
              <li>You confirm you are authorised to connect the account you link.</li>
              <li>Your use of a connected service stays governed by that provider&rsquo;s own terms.</li>
              <li>
                <strong>The Excel sync writes into your workbook.</strong> You choose which workbook
                and which direction. Rows deleted in the spreadsheet are deliberately never deleted
                from RunButter, but a two-way link will otherwise overwrite the linked worksheet with
                workspace data — keep your own backups of anything irreplaceable.
              </li>
              <li>
                We are not responsible for outages or data loss caused by a third-party provider. If
                one is unavailable your data stays in RunButter; only the external side is delayed.
              </li>
            </List>
          </Section>

          <Section n="8" title="Availability, billing, and ending the service">
            <List>
              <li>
                <strong>Billing.</strong> Payments are processed by Stripe. Subscriptions bill in
                advance and auto-renew unless cancelled at least 24 hours before the renewal date.
              </li>
              <li>
                <strong>The free plan is provided as-is</strong>, with no availability commitment.
              </li>
              <li>
                <strong>Closing your account.</strong> You may close it at any time. Export what you
                need first — after closure we delete workspace data on our normal schedule, and
                deleted data is not recoverable.
              </li>
              <li>
                <strong>We may suspend or terminate</strong> an account that breaches these terms,
                and will give notice where it is practical to do so.
              </li>
            </List>
          </Section>

          <Section n="9" title="Warranties and liability">
            <P className="mb-4">
              The service is provided &ldquo;as is&rdquo;, without warranties of any kind to the
              extent the law allows.
            </P>
            <P>
              We are not liable for indirect or consequential loss, or for lost profits or data. Our
              total liability in any 12-month period is limited to what you paid us in that period.
              Nothing here excludes liability that cannot lawfully be excluded.
            </P>
          </Section>

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
