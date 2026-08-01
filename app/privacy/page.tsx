import Link from 'next/link';
import { ArrowLeft, Shield } from 'lucide-react';
import Logo from '@/components/Logo';

export const metadata = {
  title: 'Privacy Policy — RunButter',
  description: 'What RunButter collects, why, who it is shared with, and how to get it deleted.',
};

/**
 * The previous version described an ATS only, and made two claims the software
 * does not support: that LLMs analyse "text and video inputs" to produce
 * psychometric profiles, and that candidate data is shared with OpenAI and
 * Anthropic for that analysis.
 *
 * Neither is true. Assessment scoring is deterministic and runs in Postgres —
 * that is the product's actual position ("no per-token AI bill"), and there is
 * no video capture anywhere in the codebase. A privacy policy that OVERSTATES
 * data sharing is not a safe error: candidates read it before deciding to
 * apply.
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

export default function PrivacyPage() {
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

        {/* `prose prose-slate` used to sit here doing nothing — the typography
            plugin is not installed. Spacing is explicit instead. */}
        <div className="bg-surface rounded-2xl shadow-sm ring-1 ring-subtle p-8 md:p-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-accent-soft rounded-lg flex items-center justify-center">
              <Shield className="w-6 h-6 text-accent" />
            </div>
            <h1 className="text-3xl font-medium text-primary">Privacy Policy</h1>
          </div>

          <p className="text-secondary mb-8 pb-8 border-b border-subtle">
            <strong>Last updated:</strong> 1 August 2026
          </p>

          <Section n="1" title="Who we are, and which hat we are wearing">
            <P className="mb-4">
              RunButter is a workspace where a company runs its sales, finance, marketing, projects
              and hiring on one database. This policy covers <strong>runbutter.app</strong>, the
              hosted service. If you self-host the open-source project, you run your own database
              and this policy does not apply to you — you are the operator.
            </P>
            <P className="mb-4">Two different relationships matter, because they carry different rights:</P>
            <List>
              <li>
                <strong>You have a RunButter account.</strong> We are the data controller for your
                account: your email, your workspace, your billing.
              </li>
              <li>
                <strong>Your data is inside someone else&rsquo;s workspace</strong> — you applied for
                a job, filled in a form, or are a contact in a company&rsquo;s CRM. That company is
                the controller and decides what happens to your data; we are their processor and act
                on their instructions. Requests about that data are answered fastest by contacting
                them, though you can always contact us and we will help.
              </li>
            </List>
          </Section>

          <Section n="2" title="Automated processing, stated plainly">
            <P className="mb-4">
              Assessment scores are computed <strong>deterministically</strong> — arithmetic over the
              answers you give, running in our database. No large language model reads your
              assessment, and your answers are not sent to any AI provider to produce them. We do not
              record or process video.
            </P>
            <List>
              <li>
                <strong>What the scores are:</strong> skills and work-style measures, plus a
                &ldquo;Big Five&rdquo; personality profile derived from your own answers.
              </li>
              <li>
                <strong>What they are not:</strong> a decision. They are one input a human recruiter
                sees. We prohibit solely automated hiring decisions, and no cognitive or IQ score
                exists in the product.
              </li>
              <li>
                <strong>Where AI is used at all:</strong> only where someone in a workspace asks for
                it — drafting a document, an email, or running an agent — and only using{' '}
                <strong>that workspace&rsquo;s own API key</strong> with their chosen provider. We do
                not hold a platform AI key, and nothing is sent to an AI provider in the background.
              </li>
              <li>
                <strong>Right to human review and explanation:</strong> you may ask for a human to
                review any score, and for an explanation of how it was produced.
              </li>
            </List>
          </Section>

          <Section n="3" title="What we collect">
            <List>
              <li><strong>Account data:</strong> name, email, and workspace membership.</li>
              <li>
                <strong>Candidate data:</strong> name, contact details, CV, and assessment answers
                and scores — held on behalf of the company you applied to.
              </li>
              <li>
                <strong>Workspace content:</strong> whatever the company puts in — contacts,
                invoices, projects, documents, messages in team chat, and uploaded files.
              </li>
              <li>
                <strong>Uploaded files:</strong> stored in a private bucket, and their{' '}
                <strong>text is extracted and indexed</strong> so the workspace can search inside
                contracts and CVs. Extraction runs on our own servers; no third-party OCR service is
                used unless the workspace operator configures one.
              </li>
              <li>
                <strong>Email engagement:</strong> if a workspace sends you a newsletter, we record
                whether it was delivered, opened, clicked, bounced, or reported as spam. See
                section 4.
              </li>
              <li>
                <strong>Technical data:</strong> IP address and browser type, for security and
                abuse prevention. Our built-in web analytics is{' '}
                <strong>cookieless and first-party</strong>: IP addresses are hashed with a rotating
                salt and are not stored raw, and approximate country comes from network headers
                rather than an IP-lookup service.
              </li>
            </List>
          </Section>

          <Section n="4" title="Marketing email, tracking, and scoring">
            <P className="mb-4">
              Workspaces can send newsletters to lists they have built. If you receive one:
            </P>
            <List>
              <li>
                <strong>Open and click tracking.</strong> Messages may contain a tracking pixel, and
                links may be rewritten to record the click before forwarding you on. This tells the
                sender that <em>you</em> opened or clicked, not merely that someone did.
              </li>
              <li>
                <strong>Engagement scoring.</strong> That activity is combined into a{' '}
                <strong>score that decays over time</strong>, which senders use to segment their
                audience — for example, to email only recently engaged people. This is profiling
                under the GDPR, and it uses newsletter activity only. We do not fold website
                browsing into it.
              </li>
              <li>
                <strong>Unsubscribing.</strong> Every message carries a one-click unsubscribe link
                and honours the List-Unsubscribe header. Opting out is recorded permanently:
                re-importing a list <strong>never</strong> re-subscribes an address that opted out.
              </li>
              <li>
                <strong>Bounces and complaints</strong> are recorded and suppress future sending to
                that address.
              </li>
            </List>
          </Section>

          <Section n="5" title="Connected accounts (Google and Microsoft)">
            <P className="mb-4">
              Both are optional, are started by a member of a workspace for their own account, and
              can be disconnected at any time in <strong>Settings → Integrations</strong>, which
              deletes the stored tokens. Access tokens are <strong>encrypted at rest</strong>.
            </P>

            <h3 className="text-base font-medium text-primary mt-6 mb-2">Google Calendar</h3>
            <List>
              <li>
                <strong>Permission requested:</strong> <code className="text-sm">calendar.events</code>{' '}
                only.
              </li>
              <li>
                <strong>What we do:</strong> create, update and cancel the interview events you
                schedule in RunButter, attach a Google Meet link, and invite the candidate.
              </li>
              <li>
                <strong>What we never do:</strong> read, scan, index or store the rest of your
                calendar; use Google data for advertising, profiling, or to train any AI model; or
                sell or transfer it.
              </li>
            </List>
            <P className="mt-4">
              RunButter&rsquo;s use and transfer of information received from Google APIs to any
              other app adheres to the{' '}
              <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-accent underline">
                Google API Services User Data Policy
              </a>, including the Limited Use requirements.
            </P>

            <h3 className="text-base font-medium text-primary mt-6 mb-2">Microsoft (Excel sync)</h3>
            <List>
              <li>
                <strong>Permission requested:</strong> <code className="text-sm">Files.ReadWrite</code>.
                Microsoft does not offer a single-file scope for this flow, so the token is broader
                than the workbooks you link. We therefore encrypt it at rest and use it only for the
                specific workbooks you choose.
              </li>
              <li>
                <strong>What we do:</strong> read and write the worksheet you linked, in the
                workbooks you picked.
              </li>
              <li>
                <strong>What we never do:</strong> browse, index, or store the contents of any other
                file in your OneDrive or SharePoint.
              </li>
            </List>
          </Section>

          <Section n="6" title="Sanctions screening">
            <P>
              Finance features can screen a name against published government sanctions lists (such
              as the U.S. OFAC lists). Screening runs <strong>inside our own database</strong>{' '}
              against a copy of those public lists — the name is not sent to any third-party
              screening provider. Each check is recorded for audit, as compliance requires. A match
              is an indication for a human to review, never a decision.
            </P>
          </Section>

          <Section n="7" title="Who we share data with">
            <P className="mb-4">
              We do not sell your data, and we do not use it to train AI models. We share it with:
            </P>
            <List>
              <li><strong>Supabase</strong> — database and file storage.</li>
              <li><strong>Privy</strong> — sign-in.</li>
              <li><strong>Resend</strong> — sending email (candidate updates, newsletters).</li>
              <li><strong>Stripe</strong> — billing, if a workspace is on a paid plan. We never see your card details.</li>
              <li><strong>Google / Microsoft</strong> — only for the optional integrations in section 5, and only for the accounts you connect.</li>
              <li>
                <strong>AI providers</strong> — only when a workspace member invokes an AI feature,
                and only through <strong>that workspace&rsquo;s own API key</strong> with the
                provider they chose. There is no platform-wide AI key and no background AI
                processing.
              </li>
            </List>
          </Section>

          <Section n="8" title="Keeping and deleting data">
            <List>
              <li>
                <strong>Deletion.</strong> You can ask for your data to be deleted at any time. If it
                sits inside a company&rsquo;s workspace, we will pass the request on and act on their
                instruction, as their processor.
              </li>
              <li>
                <strong>Candidate anonymisation.</strong> Workspaces can set candidate data to be
                anonymised automatically after a retention period.
              </li>
              <li>
                <strong>Access, correction, portability, objection.</strong> You have these rights
                under the GDPR, and the equivalent rights under the CCPA. Any list can be exported.
              </li>
              <li>
                <strong>Suppression lists are the deliberate exception:</strong> if you unsubscribe
                or report a message as spam, we keep the minimum record needed to make sure you are
                not emailed again.
              </li>
            </List>
          </Section>

          <section className="mt-12 pt-8 border-t border-subtle">
            <h2 className="text-xl font-medium text-primary mb-4">Contact</h2>
            <P>
              Questions about this policy, or a request about your data:{' '}
              <a href="mailto:hello@runbutter.app" className="text-accent font-semibold hover:underline">
                hello@runbutter.app
              </a>
            </P>
          </section>
        </div>

        <div className="mt-8 text-center text-secondary text-sm">
          © 2026 runbutter.app
        </div>
      </div>
    </div>
  );
}
