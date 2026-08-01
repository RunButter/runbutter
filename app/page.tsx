import Link from 'next/link';
import Script from 'next/script';
import { ArrowRight, Check, Target, Wallet, FolderKanban, Heart, Megaphone, FileText, Building2, Table2, ShieldCheck, Zap, Plug, Github, Database, Terminal, Bot, PenLine, FileInput, Link2, FileBarChart, Mail, MessagesSquare, FileSearch } from 'lucide-react';

// Self-tracking (dogfooding our own web analytics). Env-only so a self-host
// never reports into someone else's stats; production only. Site ids are public
// by nature (they appear in any tracked page's HTML).
const ANALYTICS_SITE_ID = process.env.NEXT_PUBLIC_ANALYTICS_SITE_ID || '';
const TRACK = process.env.NODE_ENV === 'production' && !!ANALYTICS_SITE_ID;
import Logo from '@/components/Logo';
import AsciiField from '@/components/landing/AsciiField';
import ProductPreview from '@/components/landing/ProductPreview';
import Showcase from '@/components/landing/Showcase';
import Comparison from '@/components/landing/Comparison';
import Reveal from '@/components/landing/Reveal';
import ThemeToggle from '@/components/ui/ThemeToggle';
import CopyCommand from '@/components/landing/CopyCommand';
import { PLANS, PLAN_ORDER, formatLimit, type SubscriptionPlan } from '@/lib/plans';

const REPO_URL = 'https://github.com/RunButter/runbutter';
// Monochrome ASCII: greys read on both canvases; the drift shifts between them.
const MONO = ['113,113,122', '161,161,170', '82,82,91'];

const MODULES = [
  { icon: Target, name: 'Sales CRM', body: 'Companies, people, and a drag-and-drop deal pipeline on one relational core.' },
  { icon: Wallet, name: 'Finance', body: 'Invoices, expenses, a bank ledger that auto-reconciles, and live revenue KPIs.' },
  { icon: Megaphone, name: 'Marketing', body: 'Newsletters and drip sequences, a post studio, and cookieless first-party analytics.' },
  { icon: FolderKanban, name: 'Projects', body: 'Projects and issues on a clean board, with a Gantt-lite roadmap.' },
  { icon: Heart, name: 'Recruiting & HR', body: 'Skills + personality hiring, onboarding checklists, and team pulse.' },
];

// Cross-cutting capabilities, shown as a bento with rhythm. Monochrome
// throughout — no hue.
// 14 tiles, two of them spanning two columns: exactly 16 cells, so the
// 4-column grid fills four clean rows with no ragged gap at the end. Keep that
// arithmetic true when editing — an odd tile leaves a hole in the last row.
const CAPS = [
  { icon: Bot, name: 'AI agents', body: 'Give an agent a role and scoped tools. It reads and updates your workspace on your own AI key, and asks before it writes unless you let it run.', wide: true },
  { icon: Mail, name: 'Newsletters and drip sequences', body: 'Write a campaign, filter the list live by behaviour, and let a sequence follow up on its own. Opens, clicks, bounces and one-click unsubscribe are handled.', wide: true },
  { icon: Table2, name: 'Excel, both ways', body: 'A live link your team refreshes in Excel — or a real two-way sync, so edits in the sheet come back.' },
  { icon: MessagesSquare, name: 'Team chat', body: 'Channels next to the work, where your agents can post too. No fifth tab.' },
  { icon: Zap, name: 'Automations', body: 'When something happens, do something: fire webhooks, send email, create records.' },
  { icon: PenLine, name: 'E-signatures', body: 'Send a document, they sign in the browser. No account, no third-party seat.' },
  { icon: FileInput, name: 'Custom forms', body: 'Publish a form, every answer lands as a record in your workspace.' },
  { icon: FileSearch, name: 'Files that become data', body: 'Upload contracts and CVs; the text is indexed next to the ledger and searchable.' },
  { icon: Link2, name: 'Short links', body: 'Your own branded shortener, with click tracking on every campaign link.' },
  { icon: FileBarChart, name: 'Scheduled reports', body: 'A PDF of the numbers that matter, in the right inboxes every Monday.' },
  { icon: Plug, name: 'REST API and MCP', body: 'Point Claude, Cursor or Zapier at the same endpoints the app uses.' },
  { icon: FileText, name: 'e-Invoicing (KSeF)', body: 'Compliant FA(3) e-invoices for Poland, straight from your documents.' },
  { icon: Building2, name: 'Company lookup', body: 'Autofill a client from its VAT or NIP, via VIES and Biała lista.' },
  { icon: ShieldCheck, name: 'GDPR and privacy', body: 'Consent logging, anonymization, cookieless analytics.' },
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
  { q: 'Is it really one workspace for everything?', a: 'Yes. Sales, finance, marketing, projects, and recruiting share one relational core. A company, a person, a deal, a campaign, and an invoice are all connected records, not separate apps you glue together. That is what makes a question like "which contracts auto-renew, for clients who owe us money" a single query instead of an afternoon.' },
  { q: 'What does it cost to run at scale?', a: 'The price on this page is the price. Search, matching, reconciliation, segmentation and reporting all run in Postgres, so there is no usage meter underneath — no per-task automation billing, no per-contact marketing tier, and no AI tokens on our bill. If you self-host, your only cost is the database and a Node process.' },
  { q: 'Is it open source?', a: 'Yes, MIT licensed. Clone the repo, run it against your own Supabase and Privy, and self-host for free. Or use the hosted version and skip the setup.' },
  { q: 'Do I pay per AI token?', a: 'Never. The core runs on native Postgres: search, matching, reconciliation, and reporting all run in the database. AI writing and agents use your own API key, so there is no per-token markup from us.' },
  { q: 'Can AI agents actually do work for me?', a: 'Yes. Define an agent with a role and a scoped set of tools, then run it on a task. It reads and updates records through the same verified endpoints the app uses, on your own AI key. By default it proposes changes for you to approve; you can let trusted agents run on their own within a step limit.' },
  { q: 'Does it handle invoicing and taxes?', a: 'Create branded PDF invoices and offers, convert an accepted quote to an invoice in one click, and export KSeF FA(3) e-invoices for Poland. A bank-transaction ledger reconciles incoming payments to the right invoice automatically.' },
  { q: 'Can I bring my existing data?', a: 'Import from CSV or a published Google Sheet in seconds, with automatic column matching. Export any list back to CSV with one click. Your data is always yours.' },
  { q: 'My team lives in Excel. Do we have to stop?', a: 'No, and there are two ways to keep working the way you already do. The simple one is a live link you paste into Excel once (Data → Get Data → From Web); after that, Refresh All pulls today’s numbers, and the link is read-only so it cannot change anything. The second is a real two-way sync with a workbook in OneDrive or SharePoint: edits people make in the sheet come back into RunButter, and the sheet is refreshed to match. Rows you delete in Excel are never deleted here — a filter or a sort looks identical to a deletion over Microsoft’s API, so deleting stays something you do deliberately in the app.' },
  { q: 'Is my data private and secure?', a: 'Every workspace is isolated, access runs through audited server-side functions that verify your session token, and GDPR controls are built in on higher plans. Analytics are first-party and cookieless.' },
  { q: 'How does the Google Calendar integration work?', open: true, a: 'It is optional, and connected per recruiter. Link your own Google account and RunButter creates a calendar event for each interview you schedule, generates a Google Meet link, invites the candidate, and emails them the details, then keeps the event in sync if you reschedule or cancel. It only touches events RunButter creates; it never reads the rest of your calendar, and you can disconnect at any time.' },
];

// The full inventory, grouped by module. Grouped chunks rather than one long
// flat list: a buyer scans for the module they care about, not 35 bullets.
const INCLUDED: { group: string; items: string[] }[] = [
  { group: 'Sales', items: ['Deal pipeline', 'Companies and people', 'Product catalogue', 'Offers, accepted to invoice', 'VAT and NIP autofill'] },
  { group: 'Finance', items: ['Invoices and expenses', 'Branded PDF documents', 'Bank transaction ledger', 'Automatic reconciliation', 'E-signatures', 'KSeF e-invoicing'] },
  { group: 'Marketing', items: ['Campaigns and budgets', 'Newsletters with AI drafting', 'Live segments and lead scoring', 'Drip sequences', 'Post studio with real previews', 'Short links', 'Custom forms', 'Cookieless web analytics', 'Source attribution'] },
  { group: 'Projects', items: ['Projects and issues', 'Kanban board', 'Roadmap timeline', 'Docs with an AI toolbar', 'Mind maps and content boards'] },
  { group: 'Hiring', items: ['Positions and apply pages', 'Skills and Big-5 assessments', 'Talent Treasury', 'Team Fit simulator', 'Interviews via Google Calendar', 'Email templates', 'Onboarding and pulse checks'] },
  { group: 'Platform', items: ['AI agents on your own key', 'Reusable agent skills', 'Team chat', 'Automations and webhooks', 'REST API and MCP server', 'Excel and Google Sheets sync', 'Full-text file search', 'Scheduled PDF reports', 'Roles and permissions', 'GDPR controls'] },
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

export default function HomePage() {
  return (
    <div className="min-h-screen bg-canvas text-primary antialiased">
      {TRACK && <Script defer src="/t.js" data-site={ANALYTICS_SITE_ID} strategy="afterInteractive" />}

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-subtle bg-canvas/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/"><Logo mono /></Link>
          <nav className="flex items-center gap-2 md:gap-6 text-sm text-secondary">
            <Link href="#features" className="hidden md:inline hover:text-primary transition-colors">Features</Link>
            <Link href="#developers" className="hidden md:inline hover:text-primary transition-colors">Developers</Link>
            <Link href="#compare" className="hidden md:inline hover:text-primary transition-colors">Compare</Link>
            <Link href="#pricing" className="hidden md:inline hover:text-primary transition-colors">Pricing</Link>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex items-center gap-1.5 hover:text-primary transition-colors"><Github className="w-4 h-4" /> GitHub</a>
            <ThemeToggle />
            <Link href="/auth/register" className="inline-flex items-center h-8 px-3 rounded-md bg-inverse text-inverse-fg text-sm font-medium hover:opacity-90 transition-opacity">Start free</Link>
          </nav>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────────
          Taller than a standard hero: the type sits high, then a big
          interactive product window is the centrepiece and breaks into the
          page below.

          The drifting ASCII terrain now carries the Flammarion engraving
          (1888, public domain) as a height bias — glyphs cluster where the ink
          is, so the figure pushing through the edge of the sky emerges out of
          the same field the cursor already disturbs. It is NOT an image layered
          behind an effect: the glow and the ripples travel through the picture,
          which is the only version worth having.

          focalY 0.42 puts the tear in the firmament and the reaching figure
          across the middle band — low enough to clear the headline, high enough
          not to be swallowed by the product window below. */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <AsciiField
            colors={MONO}
            baseAlpha={0.13}
            peakAlpha={0.6}
            image="/flammarion.jpg"
            imageWeight={0.5}
            focalX={0.86}
            focalY={0.46}
            imageScale={2.3}
            /* The centre-calming contour is what keeps the plain field quiet;
               with artwork it would erase the picture exactly where it matters. */
            edgeBias={0.22}
            cell={11}
          />
        </div>
        {/* Two scrims instead of one. A full-width top gradient was the simple
            option and it erased the engraving exactly where it is worth seeing.
            This protects only the band the type actually occupies, and lets the
            artwork survive at the edges and below. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(58% 42% at 50% 30%, hsl(var(--canvas)/0.97) 45%, hsl(var(--canvas)/0.72) 72%, transparent 100%)' }}
        />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-canvas to-transparent pointer-events-none" />

        {/* pt-16 on a phone: 96px of empty canvas above the badge pushed the
            headline most of the way down the first screen. */}
        <div className="relative z-10 max-w-3xl mx-auto px-6 pt-16 md:pt-32 pb-14 text-center">
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
            Sales, invoicing, marketing, projects and hiring on one relational core —
            plus AI agents that run on your own key.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <div className="hidden sm:block"><CopyCommand command={`git clone ${REPO_URL}.git`} /></div>
            <Link href="/auth/register" className="inline-flex items-center justify-center gap-1.5 h-10 px-5 rounded-md bg-inverse text-inverse-fg text-sm font-medium hover:opacity-90 transition-opacity">
              Start free <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* the big product window breaks out of the hero into the page */}
        <div id="product" className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 -mb-24 md:-mb-40">
          <Reveal><ProductPreview /></Reveal>
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
              <p className="text-secondary mt-3 leading-relaxed">The tools that usually mean five more subscriptions, built in and connected to the same records. Fast, keyboard-first, no extra cost.</p>
            </div>
          </Reveal>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {CAPS.map((c, i) => (
              <Reveal key={c.name} delay={i * 40} className={c.wide ? 'sm:col-span-2' : ''}>
                {/* Icon inline with the title rather than stacked above it:
                    on a phone these stack one per row, and a stacked icon made
                    fourteen tiles into a very long scroll for no extra clarity. */}
                <div className="h-full rounded-xl bg-surface border border-subtle p-4 sm:p-5 transition-colors hover:border-strong">
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-surface-sunken border border-subtle flex items-center justify-center shrink-0">
                      <c.icon className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <h3 className="text-sm font-medium text-primary">{c.name}</h3>
                  </div>
                  <p className="text-xs text-secondary leading-relaxed max-w-[42ch]">{c.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Feature deep-dives (alternating rows with real mock UIs) */}
      <div className="border-t border-subtle">
        <Showcase />
      </div>

      {/* ── The full inventory ───────────────────────────────────────────────
          Grouped index rather than a flat list: this is the section a buyer
          scans to check their own must-have is in the box. */}
      <section className="border-t border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <div className="max-w-2xl">
              <h2 className="text-2xl md:text-4xl font-medium tracking-tight">One workspace instead of five subscriptions</h2>
              <p className="text-secondary mt-3 leading-relaxed">
                Everything below is included and runs on the same records. A deal knows its company,
                an invoice knows its client, a candidate becomes a team member. Nothing to integrate.
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
                One REST API, signed webhooks, and a native MCP server so AI agents read and write your
                workspace directly. Self-host the whole thing, or start on the hosted plan.
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

      <Comparison />

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <section id="pricing" className="border-t border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto">
              <h2 className="text-2xl md:text-4xl font-medium tracking-tight">Simple, transparent pricing</h2>
              <p className="text-secondary mt-3">Start free with no credit card, upgrade as you grow. No per-token AI bill, ever.</p>
            </div>
          </Reveal>
          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-4 gap-3">
            {PLAN_CARDS.map((pl, i) => (
              <Reveal key={pl.name} delay={i * 50} className="flex">
                <div className={`rounded-xl p-5 flex flex-col w-full bg-surface border transition-colors ${pl.highlight ? 'border-strong ring-1 ring-strong' : 'border-subtle hover:border-strong'}`}>
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
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className="border-t border-subtle">
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
      <section className="border-t border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <div className="relative overflow-hidden rounded-2xl bg-inverse px-8 py-20 text-center">
              <div className="absolute inset-0 opacity-40"><AsciiField colors={['160,160,168', '120,120,130']} baseAlpha={0.05} peakAlpha={0.4} /></div>
              <div className="relative pointer-events-none">
                <h2 className="text-3xl md:text-4xl font-medium tracking-tight text-inverse-fg">Everything, running smooth.</h2>
                <p className="mt-4 text-inverse-fg/70 max-w-lg mx-auto">One workspace for every team, with AI agents doing the busywork. Set it up in minutes.</p>
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

      {/* Footer */}
      <footer className="border-t border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-12 grid gap-10 sm:grid-cols-3">
          <div>
            <Logo mono />
            <p className="mt-3 text-xs text-tertiary leading-relaxed max-w-[32ch]">
              The open company OS: sales, finance, marketing, projects, and people in one workspace.
            </p>
          </div>
          <div>
            <div className="text-2xs font-medium uppercase tracking-wider text-tertiary mb-3">Product</div>
            <ul className="space-y-2 text-xs text-secondary">
              <li><Link href="#features" className="hover:text-primary transition-colors">Features</Link></li>
              <li><Link href="#compare" className="hover:text-primary transition-colors">Compare</Link></li>
              <li><Link href="#pricing" className="hover:text-primary transition-colors">Pricing</Link></li>
              <li><a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">GitHub</a></li>
              <li><Link href="/auth/register" className="hover:text-primary transition-colors">Start free</Link></li>
            </ul>
          </div>
          <div>
            <div className="text-2xs font-medium uppercase tracking-wider text-tertiary mb-3">Company</div>
            <ul className="space-y-2 text-xs text-secondary">
              <li><Link href="/contact" className="hover:text-primary transition-colors">Contact</Link></li>
              <li><Link href="/privacy" className="hover:text-primary transition-colors">Privacy</Link></li>
              <li><Link href="/terms" className="hover:text-primary transition-colors">Terms</Link></li>
              <li><Link href="/cookies" className="hover:text-primary transition-colors">Cookies</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-subtle">
          <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-tertiary">
            <span>© 2026 runbutter.app</span>
            <span>Built on Postgres · MIT licensed · no AI token bill</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
