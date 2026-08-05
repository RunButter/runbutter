import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowRight, Github, Bot, ShieldCheck, Clock, NotebookPen, Plug, Puzzle, Coins,
  Wallet, AlarmClock, TrendingUp, UserSearch, FileSearch, Handshake, Sunrise,
} from 'lucide-react';
import Reveal from '@/components/landing/Reveal';
import { MarketingHeader, MarketingFooter, REPO_URL } from '@/components/landing/MarketingChrome';
import { TOOL_CATALOG, TOOL_GROUPS, READ_TOOLS, WRITE_TOOLS } from '@/lib/agents/catalog';
import { AGENT_TEMPLATES } from '@/lib/agents/templates';

export const metadata: Metadata = {
  title: 'AI agents that run your company data — RunButter',
  description:
    'Agents with a role, scoped tools and reusable skills, working directly on your Postgres workspace. They run on your own API key, propose writes for approval, and the same tools are exposed over MCP.',
};

/**
 * The agents page.
 *
 * EVERY NUMBER AND NAME ON THIS PAGE IS READ FROM THE CODE THAT IMPLEMENTS IT —
 * the tool list from lib/agents/catalog.ts (the same file the builder and the
 * executor both import) and the gallery from lib/agents/templates.ts. A
 * hand-typed "20+ tools" is how a marketing page ends up describing a product
 * that no longer exists; here, deleting a tool changes this page.
 */

// Keyed by the `icon` string each template declares. An unknown name falls back
// to the generic bot rather than crashing the page — a template is data.
const TEMPLATE_ICONS: Record<string, any> = {
  Wallet, AlarmClock, TrendingUp, UserSearch, FileSearch, ShieldCheck, Handshake, Sunrise,
};

const STEPS = [
  {
    n: '01',
    title: 'Give it a role',
    body: 'Plain instructions, the way you would brief a new hire: what it is responsible for, what it must never assume, how to report back. No prompt engineering, no chain syntax.',
  },
  {
    n: '02',
    title: 'Scope its tools',
    body: 'Tick the tools it may use and the record types it may touch. A collections agent reads invoices and writes notes; it cannot open a candidate file, because that box is not ticked.',
  },
  {
    n: '03',
    title: 'Decide how far it goes',
    body: 'Suggest mode proposes every write for approval and is the default. Auto mode lets a trusted agent finish the job on its own, inside a step limit you set.',
  },
];

const SAFETY = [
  {
    icon: ShieldCheck,
    title: 'Writes are proposals until you say otherwise',
    body: 'A new agent — and every agent installed from the gallery — starts in suggest mode. It shows you the exact record and the exact change, and nothing lands until you approve it.',
  },
  {
    icon: Bot,
    title: 'Tenancy is enforced in SQL, not in the prompt',
    body: 'Every tool call runs through the same server-side functions the app uses, with the workspace derived from your verified session. An agent cannot be talked into reading another company\'s data, because the query never had access to it.',
  },
  {
    icon: Plug,
    title: 'Nothing leaves the workspace unless you set up an exit',
    body: 'One tool can reach the outside world, and it can only reach connections an owner already saved. The agent sends by id and never supplies a URL, so its reach is bounded by that list — not by how convincing a document was.',
  },
  {
    icon: Coins,
    title: 'It spends your key, not our margin',
    body: 'Bring Claude, OpenAI, Gemini, OpenRouter or any OpenAI-compatible endpoint. There is no per-token markup, no "AI credits", and no plan that meters how much thinking you are allowed.',
  },
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

export default function AgentsPage() {
  const grouped = TOOL_GROUPS.map((g) => ({
    group: g,
    tools: TOOL_CATALOG.filter((t) => t.group === g),
  })).filter((g) => g.tools.length);

  return (
    <div className="min-h-screen bg-canvas text-primary antialiased">
      <MarketingHeader />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="border-b border-subtle">
        <div className="max-w-3xl mx-auto px-6 pt-20 md:pt-28 pb-16 text-center">
          <div className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full border border-subtle bg-surface text-2xs text-secondary">
            <Bot className="w-3.5 h-3.5" /> Agents · included on Business, free when you self-host
          </div>
          <h1 className="mt-6 text-[2.4rem] leading-[1.06] md:text-[3.6rem] md:leading-[1.02] font-medium tracking-[-0.03em]">
            Agents that work in the database.
            <br />
            <span className="text-secondary">Not on top of it.</span>
          </h1>
          <p className="mt-6 text-base text-secondary leading-relaxed max-w-xl mx-auto">
            Most AI assistants read a copy of your documents. These read the same
            records your invoices, pipeline and payroll are made of — and change
            them, through the same audited endpoints your team uses.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/auth/register" className="inline-flex items-center justify-center gap-1.5 h-10 px-5 rounded-md bg-inverse text-inverse-fg text-sm font-medium hover:opacity-90 transition-opacity">
              Start free <ArrowRight className="w-4 h-4" />
            </Link>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 h-10 px-5 rounded-md border border-subtle bg-surface text-primary text-sm font-medium hover:bg-surface-hover transition-colors">
              <Github className="w-4 h-4" /> Read the source
            </a>
          </div>
          <div className="mt-10 grid grid-cols-3 gap-3 max-w-lg mx-auto">
            {[
              [`${TOOL_CATALOG.length}`, 'tools'],
              [`${READ_TOOLS.length} / ${WRITE_TOOLS.length}`, 'read / write'],
              [`${AGENT_TEMPLATES.length}`, 'prebuilt agents'],
            ].map(([big, small]) => (
              <div key={small} className="rounded-xl border border-subtle bg-surface py-4">
                <div className="font-mono text-xl text-primary">{big}</div>
                <div className="text-2xs text-tertiary mt-1">{small}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How ──────────────────────────────────────────────────────────── */}
      <section className="border-b border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <div className="max-w-2xl">
              <h2 className="text-2xl md:text-4xl font-medium tracking-tight">Three decisions, then it works</h2>
              <p className="text-secondary mt-3 leading-relaxed">
                An agent is a role, a set of tools, and how much rope you give it.
                There is no graph to draw and no framework to learn.
              </p>
            </div>
          </Reveal>
          <div className="mt-10 grid md:grid-cols-3 gap-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 60}>
                <div className="h-full rounded-xl border border-subtle bg-surface p-5">
                  <div className="font-mono text-2xs text-tertiary">{s.n}</div>
                  <h3 className="mt-2 text-sm font-medium text-primary">{s.title}</h3>
                  <p className="mt-1.5 text-xs text-secondary leading-relaxed">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── The gallery ──────────────────────────────────────────────────── */}
      <section className="border-b border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <div className="max-w-2xl">
              <h2 className="text-2xl md:text-4xl font-medium tracking-tight">Hire one that already knows the job</h2>
              <p className="text-secondary mt-3 leading-relaxed">
                {AGENT_TEMPLATES.length} working configurations, each with its instructions,
                tools and example tasks already filled in. Install one, run it, then
                edit it into your own.
              </p>
            </div>
          </Reveal>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {AGENT_TEMPLATES.map((t, i) => {
              const Icon = TEMPLATE_ICONS[t.icon] || Bot;
              return (
                <Reveal key={t.key} delay={i * 40}>
                  <div className="group h-full rounded-xl border border-subtle bg-surface p-5 transition-all duration-200 hover:border-strong hover:-translate-y-0.5 hover:shadow-card">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-surface-sunken border border-subtle flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110">
                        <Icon className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <h3 className="text-sm font-medium text-primary">{t.name}</h3>
                    </div>
                    <p className="mt-2 text-xs text-secondary leading-relaxed">{t.summary}</p>
                    <p className="mt-3 pt-3 border-t border-subtle text-2xs text-tertiary leading-relaxed">
                      “{t.examples[0]}”
                    </p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── The tools ────────────────────────────────────────────────────── */}
      <section className="border-b border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <div className="max-w-2xl">
              <h2 className="text-2xl md:text-4xl font-medium tracking-tight">Every tool, and which ones can change things</h2>
              <p className="text-secondary mt-3 leading-relaxed">
                The full list, grouped the way the builder groups it. Tools marked{' '}
                <span className="inline-flex items-center h-4 px-1.5 rounded bg-inverse text-inverse-fg text-[10px] font-medium align-middle">writes</span>{' '}
                are the ones that need your approval in suggest mode.
              </p>
            </div>
          </Reveal>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {grouped.map((g, i) => (
              <Reveal key={g.group} delay={i * 40}>
                <div className="h-full rounded-xl border border-subtle bg-surface p-5">
                  <div className="text-2xs font-medium uppercase tracking-wider text-tertiary">{g.group}</div>
                  <ul className="mt-3 space-y-2">
                    {g.tools.map((t) => (
                      <li key={t.name} className="flex items-start justify-between gap-2">
                        <span className="text-xs text-primary leading-relaxed">{t.label}</span>
                        {t.write && (
                          <span className="shrink-0 mt-0.5 inline-flex items-center h-4 px-1.5 rounded bg-inverse text-inverse-fg text-[10px] font-medium">writes</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Beyond a single run ──────────────────────────────────────────── */}
      <section className="border-b border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <h2 className="text-2xl md:text-4xl font-medium tracking-tight max-w-2xl">What makes it more than a chat box</h2>
          </Reveal>
          <div className="mt-10 grid md:grid-cols-3 gap-3">
            {[
              {
                icon: Clock,
                title: 'It runs while you are asleep',
                body: 'Give an agent a standing task and an hourly, daily or weekly cadence. A schedule never changes its autonomy — a suggest agent still leaves proposals waiting for you rather than acting overnight.',
              },
              {
                icon: NotebookPen,
                title: 'It remembers what it found',
                body: 'Findings are written back onto the record itself, with the source attached. The next run — or the next person — starts from what was already learned instead of researching the same client again.',
              },
              {
                icon: Puzzle,
                title: 'Skills, shared between agents',
                body: 'A skill is a reusable instruction pack: how your company writes to clients, how you qualify a lead, what your close checklist is. Attach it to any agent. Import one from a public GitHub SKILL.md and review it before it is saved.',
              },
            ].map((c, i) => (
              <Reveal key={c.title} delay={i * 60}>
                <div className="h-full rounded-xl border border-subtle bg-surface p-5">
                  <div className="w-7 h-7 rounded-lg bg-surface-sunken border border-subtle flex items-center justify-center">
                    <c.icon className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <h3 className="mt-3 text-sm font-medium text-primary">{c.title}</h3>
                  <p className="mt-1.5 text-xs text-secondary leading-relaxed">{c.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── MCP ──────────────────────────────────────────────────────────── */}
      <section className="border-b border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-20 grid lg:grid-cols-2 gap-10 items-center">
          <Reveal>
            <div>
              <h2 className="text-2xl md:text-4xl font-medium tracking-tight">Or bring your own agent</h2>
              <p className="text-secondary mt-3 leading-relaxed">
                The same {TOOL_CATALOG.length} tools are exposed over MCP, through one
                executor — so Claude, Cursor or anything else that speaks the protocol
                takes the identical, tenancy-safe path an in-app agent takes. Not a
                thinner read-only mirror bolted on afterwards.
              </p>
              <p className="text-secondary mt-3 leading-relaxed">
                Create a key under <span className="text-primary">Settings → Integrations</span>.
                A read-scoped key stays read-only everywhere it is used, including here.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/auth/register" className="inline-flex items-center gap-1.5 h-10 px-5 rounded-md bg-inverse text-inverse-fg text-sm font-medium hover:opacity-90 transition-opacity">
                  Get a key <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </Reveal>
          <Reveal delay={80} className="min-w-0">
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

      {/* ── Safety ───────────────────────────────────────────────────────── */}
      <section className="border-b border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <div className="max-w-2xl">
              <h2 className="text-2xl md:text-4xl font-medium tracking-tight">The boring part, which is the important part</h2>
              <p className="text-secondary mt-3 leading-relaxed">
                An agent with access to the ledger is only useful if you can say
                exactly what it is able to do. Here is what bounds it.
              </p>
            </div>
          </Reveal>
          <div className="mt-10 grid sm:grid-cols-2 gap-3">
            {SAFETY.map((s, i) => (
              <Reveal key={s.title} delay={i * 50}>
                <div className="h-full rounded-xl border border-subtle bg-surface p-5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-surface-sunken border border-subtle flex items-center justify-center shrink-0">
                      <s.icon className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <h3 className="text-sm font-medium text-primary">{s.title}</h3>
                  </div>
                  <p className="mt-2 text-xs text-secondary leading-relaxed max-w-[60ch]">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section>
        <div className="max-w-6xl mx-auto px-6 py-20">
          <Reveal>
            <div className="rounded-2xl bg-inverse px-8 py-16 text-center">
              <h2 className="text-2xl md:text-4xl font-medium tracking-tight text-inverse-fg">Put one to work this afternoon.</h2>
              <p className="mt-4 text-inverse-fg/70 max-w-lg mx-auto text-sm leading-relaxed">
                Install a prebuilt agent, point it at your own AI key, and watch what it
                proposes before it changes anything.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link href="/auth/register" className="inline-flex items-center gap-1.5 h-10 px-5 rounded-md bg-inverse-fg text-inverse text-sm font-medium hover:opacity-90 transition-opacity">
                  Start free <ArrowRight className="w-4 h-4" />
                </Link>
                <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 h-10 px-5 rounded-md border border-inverse-fg/25 text-inverse-fg text-sm font-medium hover:bg-inverse-fg/10 transition-colors">
                  <Github className="w-4 h-4" /> Star on GitHub
                </a>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
