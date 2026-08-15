import Link from 'next/link';
import Script from 'next/script';
import { ArrowRight, Check, Sparkles, Target, Wallet, FolderKanban, Heart, Megaphone, FileText, Building2, Table2, ShieldCheck, Zap, Plug, Database, Terminal, Bot, PenLine, FileInput, Link2, FileBarChart, Mail, MessagesSquare, FileSearch, Scale, FileStack, Puzzle, NotebookPen, KeyRound, CalendarDays, LineChart } from 'lucide-react';
import { Github } from '@/components/ui/BrandIcons';

// Self-tracking (dogfooding our own web analytics). Env-only so a self-host
// never reports into someone else's stats; production only. Site ids are public
// by nature (they appear in any tracked page's HTML).
const ANALYTICS_SITE_ID = process.env.NEXT_PUBLIC_ANALYTICS_SITE_ID || '';
const TRACK = process.env.NODE_ENV === 'production' && !!ANALYTICS_SITE_ID;
import AsciiField from '@/components/landing/AsciiField';
import ProductPreview from '@/components/landing/ProductPreview';
import Showcase from '@/components/landing/Showcase';
import Comparison from '@/components/landing/Comparison';
import SavingsCalculator from '@/components/landing/SavingsCalculator';
import FeatureWindows from '@/components/landing/FeatureWindows';
import AgentDemo from '@/components/landing/AgentDemo';
import Reveal from '@/components/landing/Reveal';
import CopyCommand from '@/components/landing/CopyCommand';
import ObjectMarquee from '@/components/landing/ObjectMarquee';
import StructuredData from '@/components/landing/StructuredData';
import BorderBeam from '@/components/ui/BorderBeam';
import CopilotDemo from '@/components/landing/CopilotDemo';
import { MarketingHeader, MarketingFooter, REPO_URL } from '@/components/landing/MarketingChrome';
import { PLANS, PLAN_ORDER, formatLimit, type SubscriptionPlan } from '@/lib/plans';

// Monochrome ASCII: greys read on both canvases; the drift shifts between them.
const MONO = ['113,113,122', '161,161,170', '82,82,91'];

const MODULES = [
  { icon: Target, name: 'Sales CRM', body: 'Companies, people, and a drag-and-drop deal pipeline on one relational core.' },
  { icon: Wallet, name: 'Finance', body: 'Invoices, expenses, a reconciling bank ledger, collections KPIs, and a cash forecast you can push on.' },
  { icon: Megaphone, name: 'Marketing', body: 'Newsletters and drip sequences, a post studio, and cookieless analytics with goals and funnels.' },
  { icon: FolderKanban, name: 'Projects', body: 'Projects and issues on a clean board, with a Gantt-lite roadmap.' },
  { icon: Heart, name: 'Recruiting & HR', body: 'Skills + personality hiring, onboarding checklists, and team pulse.' },
];

// Cross-cutting capabilities, shown as a bento with rhythm. Monochrome
// throughout — no hue.
// 23 tiles, five of them spanning two columns: exactly 28 cells, so the
// 4-column grid fills seven clean rows with no ragged gap at the end. Keep that
// arithmetic true when editing — an odd tile leaves a hole in the last row.
// The sum is `tiles + wideTiles`, and it has to stay a multiple of four; adding
// one wide tile therefore costs two normal ones, not zero.
const CAPS: { icon: any; name: string; body: string; wide?: boolean; href?: string; cta?: string; beam?: boolean }[] = [
  // The one tile with a page of its own behind it — agents are the hardest
  // thing here to believe from a single sentence.
  { icon: Bot, beam: true, name: 'AI agents', body: 'A role, scoped tools, your own AI key. It asks before it writes.', wide: true, href: '/ai-agents', cta: 'See how agents work' },
  // Wide, and early, because it is the answer to "but my business is not a
  // software company" — the objection every vertical-shaped buyer arrives with.
  { icon: Table2, name: 'Your own record types', body: 'Vehicles, patients, shipments, kilns. Describe what you track and it gets a table, a form, search and agent access.', wide: true },
  { icon: Mail, name: 'Newsletters and drip sequences', body: 'Campaigns, live segments and drips that follow up on their own. Opens, bounces and unsubscribes handled.', wide: true },
  { icon: Table2, name: 'Excel, both ways', body: 'A live link, or a real two-way sync so edits in the sheet come back.' },
  { icon: MessagesSquare, name: 'Team chat', body: 'Channels next to the work. Your agents post there too.' },
  { icon: Zap, name: 'Automations', body: 'When something happens, do something.' },
  { icon: PenLine, name: 'E-signatures', body: 'They sign in the browser. No account, no extra seat.' },
  { icon: FileInput, name: 'Custom forms', body: 'Every answer lands as a record.' },
  { icon: FileSearch, name: 'Files that become data', body: 'Contracts and CVs, indexed next to the ledger.' },
  { icon: Link2, name: 'Short links', body: 'Your own shortener, with click tracking.' },
  { icon: FileBarChart, name: 'Scheduled reports', body: 'The numbers that matter, in the right inboxes on Monday.' },
  { icon: Plug, name: 'REST API and MCP', body: 'Point Claude, Cursor or Zapier at the same endpoints.' },
  { icon: FileText, name: 'e-Invoicing (KSeF)', body: 'Compliant FA(3) e-invoices for Poland.' },
  { icon: Building2, name: 'Company lookup', body: 'Autofill a client from its VAT or NIP.' },
  // Both of these are free public data doing work a vendor usually meters.
  { icon: Scale, name: 'Sanctions screening', body: 'OFAC lists, matched in Postgres. No per-query fee.' },
  { icon: FileStack, name: 'PDF toolkit', body: 'Merge, split, watermark. The files never leave your machine.', href: '/pdf', cta: 'Open the PDF tools' },
  { icon: ShieldCheck, name: 'GDPR and privacy', body: 'Consent logs, anonymization, cookieless analytics.' },
  // Both of these were only ever in the flat inventory further down, which is
  // the section people skim last.
  { icon: NotebookPen, name: 'Docs and mind maps', body: 'Write next to the records, with boards for planning.' },
  { icon: KeyRound, name: 'Roles and permissions', body: 'Owner, admin, member. Audit log on Enterprise.' },
  { icon: Puzzle, beam: true, name: 'Agent skills, portable', body: 'Write a skill once, package it as an Agent Plugin. Import from GitHub, export yours back out.', wide: true, href: '/plugins', cta: 'Open the free skill builder' },
  // The calendar is the clearest demonstration of the one-database claim, so it
  // gets a tile rather than a line in the inventory nobody reads twice.
  { icon: CalendarDays, name: 'One company calendar', body: 'Invoices due, interviews, scheduled posts, campaign windows and bookings — on one grid, from one query.', wide: true },
  { icon: LineChart, name: 'Cash forecast', body: 'Hire two people, lose your biggest client, get paid three weeks late. Watch what happens to the money.' },
  { icon: KeyRound, name: 'Encrypted team vault', body: 'Shared logins your own server cannot read. Free password generator, no account.', href: '/password', cta: 'Open the generator' },
];

// Prices, names and limits are DERIVED from lib/plans.ts — the same file that
// actually gates features — rather than restated here. This used to be a
// hand-kept copy "in step with" that file, which is exactly how the numbers in
// CLAUDE.md drifted a whole pricing model behind reality. Marketing copy stays
// local because it is curated; anything a customer could hold us to is read.
const TIER_COPY: Record<SubscriptionPlan, { sub: string; features: string[]; cta: string; href: string; highlight: boolean }> = {
  free: {
    sub: 'self-host, or start here',
    features: ['Every core module', 'Pipelines, invoices, docs', 'CSV and Google Sheets import'],
    cta: 'Start free', href: '/auth/register?plan=free', highlight: false,
  },
  team: {
    sub: 'per seat / month',
    features: ['Everything in Free', 'Newsletters and sequences', 'Automations and webhooks', 'E-signatures, forms, short links'],
    cta: 'Start free', href: '/auth/register?plan=team', highlight: true,
  },
  business: {
    sub: 'per seat / month',
    features: ['Everything in Team', 'AI agents on your own key', 'REST API, MCP and Excel sync', 'Attribution and scheduled reports'],
    cta: 'Start free', href: '/auth/register?plan=business', highlight: false,
  },
  enterprise: {
    sub: 'for organizations',
    features: ['Everything in Business', 'SSO / SAML and audit log', 'Unlimited everything', 'Dedicated support and SLA'],
    cta: 'Contact sales', href: '/contact', highlight: false,
  },
};

// The seats/records line is generated, so it can never claim a limit the
// entitlement code does not enforce.
const limitLine = (plan: SubscriptionPlan) => {
  const { maxSeats, maxRecords } = PLANS[plan].limits;
  const seats = maxSeats === Infinity ? 'Unlimited seats' : `${maxSeats} seats`;
  return `${seats}, ${formatLimit(maxRecords).toLowerCase()} records`;
};

const PLAN_CARDS = PLAN_ORDER.map((id) => ({
  // Spread FIRST: with it last it silently overwrote the composed feature list
  // below and dropped the generated limit line. tsc flagged the duplicate key.
  ...TIER_COPY[id],
  id,
  name: PLANS[id].name,
  price: PLANS[id].price,
  features: [limitLine(id), ...TIER_COPY[id].features],
}));

// `open` renders that entry expanded on load. The Google Calendar answer uses it
// because OAuth verification requires the homepage to visibly explain why we ask
// for user data — a reviewer should not have to click an accordion to find it.
const FAQ: { q: string; a: string; open?: boolean }[] = [
  { q: 'Is it really one workspace for everything?', a: 'Yes. A company, a person, a deal, a campaign and an invoice are connected records in one database, not separate apps you glue together. That is what makes "which contracts auto-renew, for clients who owe us money" a single query instead of an afternoon.' },
  { q: 'What does it cost to run at scale?', a: 'The price on this page is the price. Everything runs in Postgres, so there is no usage meter underneath: no per-task automation billing, no per-contact marketing tier, no AI tokens on our bill.' },
  { q: 'Is it open source?', a: 'Yes, MIT — not "open core" with the useful half held back. Self-host everything including the agents, the API and the MCP server, or use the hosted version and skip the setup.' },
  { q: 'My business is not deals and invoices. Does this fit?', a: 'That is what custom objects are for. Describe what you actually track — vehicles, patients, shipments, machines, cases — and RunButter proposes the record types and fields, or you build them by hand. Each one immediately gets a table, a form, search, CSV import and export, API access and agent access, and you decide which sidebar section it appears in. Rows are stored in a typed JSONB column rather than a generated table, so adding a record type is not a database migration and cannot affect anyone else’s data.' },
  { q: 'What happens to my data if I stop paying?', a: 'You export it, or you keep running it. Every list exports to CSV, the API returns everything, and the code is MIT — so the exit is "point the same code at your own Postgres", not a support ticket.' },
  { q: 'How do I update a self-hosted install?', a: 'Pull the new code, then apply any new migrations — in that order, because the app is written to tolerate a schema that is one step behind, not one step ahead. Migrations are numbered, idempotent and safe to re-run, `npm run migrate:status` tells you what is pending, and the Updates screen in Settings shows which version you are on. The full procedure is in the docs under Updating.' },
  { q: 'Do I pay per AI token?', a: 'Never. Search, matching and reporting run in the database. AI writing and agents use your own API key, so there is no per-token markup from us.' },
  { q: 'Can AI agents actually do work for me?', a: 'Yes. Give an agent a role and scoped tools, and it reads and updates records through the same verified endpoints the app uses. By default it proposes changes for you to approve.' },
  { q: 'Does it handle invoicing and taxes?', a: 'Branded PDF invoices and offers, one-click quote-to-invoice, and KSeF FA(3) export for Poland. A bank ledger reconciles incoming payments automatically.' },
  { q: 'Can I bring my existing data?', a: 'Import from CSV or a published Google Sheet, with automatic column matching. Export any list back with one click.' },
  { q: 'My team lives in Excel. Do we have to stop?', a: 'No, and there are two ways to keep working the way you already do. The simple one is a live link you paste into Excel once (Data → Get Data → From Web); after that, Refresh All pulls today’s numbers, and the link is read-only so it cannot change anything. The second is a real two-way sync with a workbook in OneDrive or SharePoint: edits people make in the sheet come back into RunButter, and the sheet is refreshed to match. Rows you delete in Excel are never deleted here — a filter or a sort looks identical to a deletion over Microsoft’s API, so deleting stays something you do deliberately in the app.' },
  { q: 'Is there a calendar?', a: 'One, over everything. Invoices due, bills to pay, issue deadlines, scheduled posts and newsletters, campaign start and end dates, interviews and Cal.com bookings all appear on the same grid — not because they were synced from five apps, but because they are rows in one database. Money coming in and money going out are deliberately different colours. It reads only: an interview is still created in Hiring, a post is still scheduled in Marketing.' },
  { q: 'Where do we keep shared passwords?', a: 'In the vault, and the point of it is that we cannot read it. The registrar login, the analytics account, the shared social inbox — they normally live in a spreadsheet, because buying a fifth subscription to hold six passwords is a worse trade. Items here are encrypted in your browser with a key built from a workspace passphrase that is never sent anywhere, so the database holds ciphertext and no title column. There is no reset, which is what makes the rest of that sentence true. It is not a replacement for 1Password — no per-user keys, no browser extension — it replaces the spreadsheet.' },
  { q: 'Is my data private and secure?', a: 'Every workspace is isolated and access runs through audited server-side functions that verify your session token. Analytics are first-party and cookieless.' },
  { q: 'How does the Google Calendar integration work?', open: true, a: 'It is optional, and connected per recruiter. Link your own Google account and RunButter creates a calendar event for each interview you schedule, generates a Google Meet link, invites the candidate, and emails them the details, then keeps the event in sync if you reschedule or cancel. It only touches events RunButter creates; it never reads the rest of your calendar, and you can disconnect at any time.' },
];

// The full inventory, grouped by module. Grouped chunks rather than one long
// flat list: a buyer scans for the module they care about, not 35 bullets.
const INCLUDED: { group: string; items: string[] }[] = [
  { group: 'Sales', items: ['Deal pipeline', 'Companies and people', 'Product catalogue', 'Offers, accepted to invoice', 'VAT and NIP autofill'] },
  { group: 'Finance', items: ['Invoices and expenses', 'Branded PDF documents', 'Bank transaction ledger', 'Automatic reconciliation', 'Collections KPIs and AR ageing', 'Cash forecast with scenarios', 'E-signatures', 'KSeF e-invoicing'] },
  { group: 'Marketing', items: ['Campaigns and budgets', 'Newsletters with AI drafting', 'Live segments and lead scoring', 'Drip sequences', 'Post studio with real previews', 'Short links', 'Custom forms', 'Cookieless web analytics', 'Goals, funnels and live visitors', 'Source attribution'] },
  { group: 'Projects', items: ['Projects and issues', 'Kanban board', 'Roadmap timeline', 'Docs with an AI toolbar', 'Mind maps and content boards'] },
  { group: 'Hiring', items: ['Positions and apply pages', 'Skills and Big-5 assessments', 'Talent Treasury', 'Team Fit simulator', 'Interviews via Google Calendar', 'Email templates', 'Onboarding and pulse checks'] },
  { group: 'Platform', items: ['Custom record types', 'AI workspace builder', 'AI agents on your own key', 'Reusable agent skills', 'Team chat', 'Automations and webhooks', 'REST API and MCP server', 'Excel and Google Sheets sync', 'Full-text file search', 'Scheduled PDF reports', 'PDF toolkit, in the browser', 'Company calendar', 'Encrypted team vault', 'Password generator', 'Sanctions screening (OFAC)', 'Roles and permissions', 'GDPR controls'] },
];

const MCP_SNIPPET = `{
  "mcpServers": {
    "runbutter": {
      "type": "http",
      "url": "https://runbutter.app/api/mcp",
      "headers": { "Authorization": "Bearer hb_..." }
    }
  }
}`;

/** Beams a card only when it is the one being recommended. */
function BeamIf({ on, children }: { on: boolean; children: React.ReactNode }) {
  if (!on) return <>{children}</>;
  return <BorderBeam size="md" colorVariant="ocean" strength={0.7} className="flex w-full">{children}</BorderBeam>;
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-canvas text-primary antialiased">
      {TRACK && <Script defer src="/t.js" data-site={ANALYTICS_SITE_ID} strategy="afterInteractive" />}
      {/* FAQ is passed in rather than duplicated: structured data has to
          describe what is actually on the page, and sharing the array is what
          guarantees it still will be after the next edit. */}
      <StructuredData faq={FAQ} />

      <MarketingHeader home />

      {/* ── Hero ─────────────────────────────────────────────────────────────
          Taller than a standard hero: the type sits high, then a big
          interactive product window is the centrepiece and breaks into the
          page below.

          The Flammarion engraving (1888, public domain) is now BOTH layers:
          the real plate, full-bleed and visible, and the height bias for the
          ASCII field drawn over it — so glyphs cluster on the ink and the
          cursor's glow and ripples travel through the same picture you can
          actually see. Width-fit at every viewport: 'contain' flipped to side
          margins on ultrawide screens, which read as a crop. */}
      <section className="relative overflow-hidden">
        {/* The plate itself: whole composition, edge to edge, top-anchored,
            with a slight deliberate overscan (.hero-art) past both sides.
            multiply drops the paper onto the canvas; dark mode inverts to
            white ink and screens it over the dark canvas. The bottom mask
            dissolves it into the page before the product window. */}
        <div className="hero-art absolute inset-x-0 top-0 pointer-events-none" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/flammarion-1400.webp"
            srcSet="/flammarion-800.webp 800w, /flammarion-1400.webp 1400w"
            sizes="100vw"
            width={1376}
            height={768}
            alt=""
            fetchPriority="high"
            decoding="async"
            className="w-full h-auto select-none mix-blend-multiply opacity-[0.55] dark:invert dark:mix-blend-screen dark:opacity-[0.4]
                       [mask-image:linear-gradient(to_bottom,black_60%,transparent_98%)]
                       [-webkit-mask-image:linear-gradient(to_bottom,black_60%,transparent_98%)]"
          />
        </div>
        <div className="absolute inset-0">
          <AsciiField
            colors={MONO}
            baseAlpha={0.1}
            peakAlpha={0.5}
            image="/flammarion.jpg"
            /* Lighter than before: the real image now carries the picture, so
               the field is the shimmer and the interaction, not the render. */
            imageWeight={0.42}
            imageFit="width"
            focalX={0.5}
            focalY={0}
            imageScale={1}
            /* The centre-calming contour is what keeps the plain field quiet;
               with artwork it would erase the picture exactly where it matters. */
            edgeBias={0.18}
            cell={8}
          />
        </div>
        {/* Two scrims instead of one. A full-width top gradient was the simple
            option and it erased the engraving exactly where it is worth seeing.
            This protects only the band the type actually occupies, and lets the
            artwork survive at the edges and below. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(56% 44% at 50% 28%, hsl(var(--canvas)/0.94) 38%, hsl(var(--canvas)/0.62) 68%, transparent 100%)' }}
        />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-canvas to-transparent pointer-events-none" />

        {/* pt-16 on a phone: 96px of empty canvas above the badge pushed the
            headline most of the way down the first screen. */}
        <div className="relative z-10 max-w-3xl mx-auto px-6 pt-20 md:pt-44 pb-16 md:pb-24 text-center">
          {/* Two ranks, and the difference is COLOUR and SIZE, not weight —
              the design rule the rest of the app follows. "Build beyond" is the
              line the engraving is arguing for; the butter line stays because
              it is the one people repeat back to you. */}
          <h1 className="text-[2.6rem] leading-[1.04] md:text-[4.5rem] md:leading-[0.98] font-medium tracking-[-0.03em] text-primary">
            Explore further.<br />
            <span className="text-secondary">Build beyond.</span>
          </h1>
          <p className="mt-7 text-base md:text-lg text-primary max-w-xl mx-auto leading-relaxed">
            Run your whole company, smooth as butter.
          </p>
          <p className="mt-2.5 text-sm md:text-base text-secondary max-w-xl mx-auto leading-relaxed">
            Sales, invoicing, marketing, projects and hiring on one core — plus agents on your own key.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <div className="hidden sm:block"><CopyCommand command={`git clone ${REPO_URL}.git`} /></div>
            <Link href="/auth/register" className="inline-flex items-center justify-center gap-1.5 h-10 px-5 rounded-md bg-inverse text-inverse-fg text-sm font-medium hover:opacity-90 transition-opacity">
              Start free <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* the big product window breaks out of the hero into the page */}
        <div id="product" className="relative z-20 max-w-6xl mx-auto px-4 sm:px-6 -mb-24 md:-mb-40">
          {/* A quiet halo behind the window lifts it off the artwork without
              adding a colour. It has to be -z-[1] and the window's own wrapper
              `relative`: Reveal's transform ends when the animation does, which
              drops ProductPreview out of its own stacking context and lets this
              blur paint OVER the window — it read as a washed-out screenshot. */}
          <div aria-hidden className="absolute -z-[1] -inset-x-4 -top-10 bottom-0 rounded-[3rem] bg-canvas/60 blur-2xl pointer-events-none" />
          {/* The beam rides the hero window because that is the one thing the
              page wants you to look at. --beam-radius matches the window's own
              rounding, or the ring corners cut across the card.

              MONO, not sunset. This page is deliberately hueless (see the note
              on the bento above), and an orange-to-pink rim on it read as a
              stray magenta line rather than as light travelling the edge. The
              sunset variant exists and is one word away for a page that wants
              colour; this one does not. */}
          <Reveal variant="zoom" className="relative">
            <BorderBeam size="pulse-inner" colorVariant="mono" strength={0.55} staticColors>
              <ProductPreview />
            </BorderBeam>
          </Reveal>
        </div>
      </section>

      {/* Modules strip (top padding clears the overlapping window) */}
      <section className="pt-36 md:pt-56">
        <div className="max-w-6xl mx-auto px-6 pb-8">
          <p className="text-center text-xs text-tertiary mb-10">Switch tabs in the window above. It is the real interface, on sample data.</p>
          <div className="grid grid-cols-2 md:grid-cols-5 border border-subtle rounded-xl divide-y md:divide-y-0 md:divide-x divide-subtle overflow-hidden">
            {MODULES.map((m) => (
              <div key={m.name} className="p-5 hover:bg-surface-hover transition-colors">
                <m.icon className="w-4 h-4 text-primary mb-3" />
                <div className="text-sm font-medium text-primary">{m.name}</div>
                <p className="text-xs text-secondary mt-1 leading-relaxed">{m.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features bento ──────────────────────────────────────────────── */}
      <section id="features" className="border-t border-subtle mt-12">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <div className="max-w-2xl">
              <h2 className="text-2xl md:text-4xl font-medium tracking-tight">Everything else, already in the box</h2>
              <p className="text-secondary mt-3 leading-relaxed">Five more subscriptions, built in and on the same records.</p>
            </div>
          </Reveal>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {CAPS.map((c, i) => {
              {/* Icon inline with the title rather than stacked above it:
                  on a phone these stack one per row, and a stacked icon made
                  fourteen tiles into a very long scroll for no extra clarity. */}
              const tile = (
                <div className="group h-full rounded-xl bg-surface border border-subtle p-4 sm:p-5 transition-all duration-200 hover:border-strong hover:-translate-y-0.5 hover:shadow-card">
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-surface-sunken border border-subtle flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110">
                      <c.icon className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <h3 className="text-sm font-medium text-primary">{c.name}</h3>
                  </div>
                  <p className="text-xs text-secondary leading-relaxed max-w-[42ch]">{c.body}</p>
                  {/* The label used to be the string "See how agents work",
                      hardcoded, because agents were the only linked tile. A
                      second one made that a lie on its own card. */}
                  {c.href && (
                    <span className="mt-3 inline-flex items-center gap-1 text-xs text-primary font-medium">
                      {c.cta} <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                    </span>
                  )}
                </div>
              );
              const linked = c.href ? <Link href={c.href} className="block h-full">{tile}</Link> : tile;
              return (
                <Reveal key={c.name} delay={i * 40} className={c.wide ? 'sm:col-span-2' : ''}>
                  {/* Two tiles beam: AI agents and the skill builder. Both are
                      the ones with a page behind them, so the beam points at
                      somewhere to go. Beaming all twenty would be a texture. */}
                  {c.beam
                    ? <BorderBeam size="md" colorVariant="ocean" strength={0.7} className="block h-full">{linked}</BorderBeam>
                    : linked}
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Agents, shown rather than claimed ────────────────────────────────
          The first bento tile says an agent reads and writes your workspace and
          asks before it writes. That is the least believable sentence on the
          page from a tile, and a screenshot cannot help, because the part worth
          seeing is the ORDER: the question, the tools it picked, and a write
          that stops for approval. So it plays. */}
      {/* The Copilot gets its own section, above agents, because it is the
          thing somebody meets first. Agents are the same machinery running
          unattended, so they read as the follow-on rather than the headline. */}
      <section id="copilot" className="border-t border-subtle cv-auto">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <Reveal>
              <div>
                <span className="inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-accent-text">
                  <Sparkles className="w-3.5 h-3.5" /> Copilot
                </span>
                <h2 className="text-2xl md:text-4xl font-medium tracking-tight mt-3">
                  It works the way you do, on the screen you are already on
                </h2>
                <p className="text-secondary mt-4 leading-relaxed">
                  Docked beside your work, so &ldquo;chase these&rdquo; means the invoices you are
                  looking at. It reads and writes across the whole workspace &mdash; deals, invoices,
                  documents, the hiring pipeline, team chat &mdash; through the same functions the
                  screens use, so it can never reach further than you can.
                </p>
                <ul className="mt-6 space-y-2.5 text-sm text-secondary">
                  <li className="flex gap-2.5">
                    <Check className="w-4 h-4 text-accent-text shrink-0 mt-0.5" />
                    <span><b className="text-primary font-medium">Changes wait for you.</b> It proposes; you press Apply. Switch a conversation to Auto when you trust it.</span>
                  </li>
                  <li className="flex gap-2.5">
                    <Check className="w-4 h-4 text-accent-text shrink-0 mt-0.5" />
                    <span><b className="text-primary font-medium">Every step is on the record.</b> Which tools it called, what came back, what it cost in tokens.</span>
                  </li>
                  <li className="flex gap-2.5">
                    <Check className="w-4 h-4 text-accent-text shrink-0 mt-0.5" />
                    <span><b className="text-primary font-medium">Your key, your model.</b> Claude, GPT, Gemini, or a local model when you self-host. We add nothing per token.</span>
                  </li>
                </ul>
              </div>
            </Reveal>
            <Reveal>
              <CopilotDemo />
            </Reveal>
          </div>
        </div>
      </section>

      <section id="agents" className="border-t border-subtle cv-auto">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <Reveal>
            <div className="max-w-2xl">
              <h2 className="text-2xl md:text-4xl font-medium tracking-tight">Ask your workspace a real question</h2>
              <p className="text-secondary mt-3 leading-relaxed">
                One database, so an agent answers across all of it in a single pass — on your own AI key. Writes wait for you.
              </p>
            </div>
          </Reveal>
          {/* Inside the Reveal on purpose: the transcript's CSS animations are
              paused until .reveal-in lands, which is what stops the whole
              conversation playing out while it is still below the fold. */}
          <Reveal delay={60} className="mt-12 md:mt-14">
            <AgentDemo />
          </Reveal>
          <Reveal delay={120}>
            <p className="mt-6 text-xs text-tertiary">
              Sample workspace. Every tool named above is a real one —{' '}
              <Link href="/ai-agents" className="text-primary font-medium hover:underline">see the full list and how scoping works</Link>.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── Custom objects ───────────────────────────────────────────────────
          Its own section rather than one more tile in the bento, because it is
          the answer to the objection almost every non-software business brings:
          "our work does not look like deals and invoices". The strip is the
          argument — a wall of things nobody would expect a CRM to hold. */}
      <section className="border-t border-subtle cv-auto">
        <div className="py-20">
          <div className="max-w-6xl mx-auto px-6">
            <Reveal>
              <div className="max-w-2xl">
                <h2 className="text-2xl md:text-4xl font-medium tracking-tight">It also tracks whatever you track</h2>
                <p className="text-secondary mt-3 leading-relaxed">
                  Describe your business in a sentence and RunButter proposes the record types — or build them by hand. Each one gets a table, a form, search and agent access immediately.
                </p>
              </div>
            </Reveal>
          </div>

          <Reveal variant="fade" className="mt-10">
            <ObjectMarquee />
          </Reveal>

          <div className="max-w-6xl mx-auto px-6 mt-10">
            <Reveal delay={80}>
              <div className="grid sm:grid-cols-3 gap-x-10 gap-y-6">
                {[
                  ['No migrations', 'Rows live in one JSONB column, so a new record type never touches the database structure.'],
                  ['Typed, not free text', 'Numbers, dates, currencies and relations are validated on the way in. A bad value is rejected.'],
                  ['Connected, not siloed', 'A relation field links Vehicles to the Companies you already have.'],
                ].map(([h, b]) => (
                  <div key={h} className="border-t border-strong pt-4">
                    <h3 className="text-sm font-medium text-primary">{h}</h3>
                    <p className="text-xs text-secondary mt-2 leading-relaxed">{b}</p>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Feature deep-dives (alternating rows with real mock UIs) */}
      <div className="border-t border-subtle cv-auto">
        <Showcase />
      </div>

      {/* The five modules the deep-dives skip. Sits after Showcase and before
          the flat inventory: someone scrolling has just seen the four big
          modules argued for, and this is the "and also" before the checklist. */}
      <div className="border-t border-subtle cv-auto">
        <FeatureWindows />
      </div>

      {/* ── The full inventory ───────────────────────────────────────────────
          Grouped index rather than a flat list: this is the section a buyer
          scans to check their own must-have is in the box. */}
      <section className="border-t border-subtle cv-auto">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <div className="max-w-2xl">
              <h2 className="text-2xl md:text-4xl font-medium tracking-tight">One workspace instead of five subscriptions</h2>
              <p className="text-secondary mt-3 leading-relaxed">
                A deal knows its company, an invoice knows its client, a candidate becomes a team member. Nothing to integrate.
              </p>
            </div>
          </Reveal>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-10">
            {INCLUDED.map((col, i) => (
              <Reveal key={col.group} delay={i * 50}>
                <div className="border-t border-strong pt-4">
                  <h3 className="text-sm font-medium text-primary">{col.group}</h3>
                  <ul className="mt-3 space-y-2">
                    {col.items.map((item) => (
                      <li key={item} className="text-sm text-secondary leading-relaxed">{item}</li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Developers / open source ─────────────────────────────────────── */}
      <section id="developers" className="border-t border-subtle bg-surface-sunken">
        {/* min-w-0 on the columns: a grid track is min-content by default, so a
            long unbreakable string (the clone command, the JSON) would set a
            floor wider than a phone and scroll the whole page sideways. */}
        <div className="max-w-6xl mx-auto px-6 py-20 grid lg:grid-cols-2 gap-12 items-center">
          <Reveal className="min-w-0">
            <div className="min-w-0">
              <h2 className="text-2xl md:text-4xl font-medium tracking-tight">Open, and built for agents</h2>
              <p className="text-secondary mt-4 leading-relaxed max-w-[52ch]">
                One REST API, signed webhooks and a native MCP server. Self-host it all, or start hosted.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  [Database, 'Native Postgres core. Search, matching and reporting run in the database, so there is no per-token AI cost.'],
                  [Terminal, 'REST API + MCP. Point Claude, Cursor, Zapier or your own scripts at the same verified endpoints the app uses.'],
                  [Github, 'MIT licensed. Clone it, run it against your own Supabase and Privy, own your data end to end.'],
                ].map(([Icon, text]: any) => (
                  <li key={text} className="flex items-start gap-3">
                    <Icon className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm text-secondary leading-relaxed">{text}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <CopyCommand command={`git clone ${REPO_URL}.git`} />
                <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md border border-subtle bg-surface text-primary text-sm font-medium hover:bg-surface-hover transition-colors">
                  <Github className="w-4 h-4" /> Star on GitHub
                </a>
              </div>
            </div>
          </Reveal>
          <Reveal delay={80} className="min-w-0">
            {/* Monochrome terminal card: the MCP config, mono on inverse. */}
            <div className="rounded-xl overflow-hidden border border-subtle shadow-popover min-w-0">
              <div className="h-9 flex items-center gap-2 px-3.5 bg-inverse/95">
                <span className="w-2.5 h-2.5 rounded-full bg-inverse-fg/25" />
                <span className="w-2.5 h-2.5 rounded-full bg-inverse-fg/25" />
                <span className="w-2.5 h-2.5 rounded-full bg-inverse-fg/25" />
                <span className="ml-2 text-2xs font-mono text-inverse-fg/60">.mcp.json</span>
              </div>
              <pre className="bg-inverse text-inverse-fg/90 text-xs font-mono leading-relaxed p-4 overflow-x-auto">{MCP_SNIPPET}</pre>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── What it replaces, in your own numbers ─────────────────────────
          Sits directly before the comparison table: the table says WHAT is
          replaced, this says what that is worth to you specifically. */}
      <section id="savings" className="border-t border-subtle cv-auto">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <Reveal>
            <div className="max-w-2xl">
              <h2 className="text-2xl md:text-4xl font-medium tracking-tight">Count what you are already paying</h2>
              <p className="text-secondary mt-3 leading-relaxed">
                Tick what you have and put in your own figures. We are not going to guess at anyone else&apos;s price list.
              </p>
            </div>
          </Reveal>
          <Reveal delay={60} className="mt-10">
            <SavingsCalculator />
          </Reveal>
        </div>
      </section>

      <Comparison />

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <section id="pricing" className="border-t border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto">
              <h2 className="text-2xl md:text-4xl font-medium tracking-tight">Simple, transparent pricing</h2>
              <p className="text-secondary mt-3">No credit card. No per-token AI bill, ever.</p>
            </div>
          </Reveal>
          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-4 gap-3">
            {PLAN_CARDS.map((pl, i) => (
              <Reveal key={pl.name} delay={i * 50} className="flex">
                <BeamIf on={pl.highlight}>
                <div className={`rounded-xl p-5 flex flex-col w-full bg-surface border transition-colors ${pl.highlight ? 'border-transparent' : 'border-subtle hover:border-strong'}`}>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-primary">{pl.name}</h3>
                    {pl.highlight && <span className="text-2xs font-medium bg-inverse text-inverse-fg rounded px-1.5 py-0.5">Popular</span>}
                  </div>
                  <div className="mt-3 mb-1 font-mono text-3xl text-primary">{pl.price}</div>
                  <div className="text-xs text-tertiary mb-5">{pl.sub}</div>
                  <ul className="space-y-2.5 mb-6 flex-grow">
                    {pl.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-xs text-secondary">
                        <Check className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />{f}
                      </li>
                    ))}
                  </ul>
                  <Link href={pl.href} className={`h-9 rounded-md text-sm font-medium text-center inline-flex items-center justify-center transition-opacity ${pl.highlight ? 'bg-inverse text-inverse-fg hover:opacity-90' : 'bg-surface border border-subtle text-primary hover:bg-surface-hover'}`}>{pl.cta}</Link>
                </div>
                </BeamIf>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className="border-t border-subtle cv-auto">
        <div className="max-w-3xl mx-auto px-6 py-20">
          <Reveal>
            <h2 className="text-2xl md:text-4xl font-medium tracking-tight text-center">Questions, answered</h2>
            <div className="mt-10 border-t border-subtle">
              {FAQ.map((f) => (
                <details key={f.q} open={f.open} className="group border-b border-subtle [&_summary]:cursor-pointer">
                  <summary className="flex items-center justify-between gap-4 list-none py-4 text-sm font-medium text-primary hover:text-secondary transition-colors">
                    {f.q}
                    <span className="text-tertiary text-lg leading-none transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="pb-4 -mt-1 text-sm text-secondary leading-relaxed max-w-[65ch]">{f.a}</p>
                </details>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="border-t border-subtle cv-auto">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <div className="relative overflow-hidden rounded-2xl bg-inverse px-8 py-20 text-center">
              <div className="absolute inset-0 opacity-40"><AsciiField colors={['160,160,168', '120,120,130']} baseAlpha={0.05} peakAlpha={0.4} /></div>
              <div className="relative pointer-events-none">
                <h2 className="text-3xl md:text-4xl font-medium tracking-tight text-inverse-fg">Everything, running smooth.</h2>
                <p className="mt-4 text-inverse-fg/70 max-w-lg mx-auto">One workspace for every team. Set it up in minutes.</p>
                <div className="pointer-events-auto mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                  <Link href="/auth/register" className="inline-flex items-center gap-1.5 h-10 px-5 rounded-md bg-inverse-fg text-inverse text-sm font-medium hover:opacity-90 transition-opacity">
                    Start free <ArrowRight className="w-4 h-4" />
                  </Link>
                  <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 h-10 px-5 rounded-md border border-inverse-fg/25 text-inverse-fg text-sm font-medium hover:bg-inverse-fg/10 transition-colors">
                    <Github className="w-4 h-4" /> View source
                  </a>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <MarketingFooter home />
    </div>
  );
}
