'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Target, Receipt, FolderKanban, LayoutDashboard, Users, Building2, Wallet, Heart, Megaphone, Search,
  Check, Clock, CircleDashed, X, ArrowUpRight, Eye, Activity, type LucideIcon,
} from 'lucide-react';

/**
 * The hero product window.
 *
 * EVERY PANEL IS IN THE DOM, always. The first version rendered `tab === 'sales'
 * && <…>`, so the HTML that actually leaves the server described one module out
 * of five — the other four existed only after React hydrated and only after
 * somebody clicked. Anything reading the page as text (an AI agent fetching the
 * URL, a crawler that does not execute JS, a screen reader, reader mode) saw a
 * product with a deal pipeline and nothing else, on a page whose whole argument
 * is that the five modules share one core.
 *
 * Inactive panels carry the `hidden` attribute instead: present in the markup,
 * out of the accessibility tree, out of the tab order. It costs one extra paint
 * of a few hundred nodes and buys back four fifths of the page's content.
 *
 * The tabs are a real WAI-ARIA tablist too — roving tabindex, arrows to move,
 * Home/End to jump — because they always looked like tabs and behaved like five
 * unrelated buttons.
 */

type Tab = 'sales' | 'finance' | 'marketing' | 'projects' | 'hr';

const RAIL = [
  { icon: LayoutDashboard }, { icon: Target }, { icon: Building2 }, { icon: Users },
  { icon: Receipt }, { icon: Wallet }, { icon: Megaphone }, { icon: FolderKanban }, { icon: Heart },
];

// Status pills, echoing the app's new icon pills but kept MONOCHROME (the landing
// is grayscale on purpose). Positive states read as a solid inverse fill; the
// rest as a quiet outline. The glyph carries the meaning the colour would in-app.
const CHIP: Record<string, { solid?: boolean; icon: LucideIcon }> = {
  paid: { solid: true, icon: Check }, won: { solid: true, icon: Check },
  offered: { solid: true, icon: Check }, done: { solid: true, icon: Check },
  live: { solid: true, icon: Check },
  sent: { icon: Clock }, draft: { icon: Clock }, applied: { icon: Clock },
  interview: { icon: CircleDashed }, assessed: { icon: CircleDashed }, screening: { icon: CircleDashed },
  overdue: { icon: X },
};

function Chip({ label }: { label: string }) {
  const meta = CHIP[label.toLowerCase()] ?? { icon: CircleDashed };
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-3xs font-medium capitalize ${
      meta.solid ? 'bg-inverse text-inverse-fg' : 'bg-surface-hover text-secondary'}`}>
      <Icon className="w-2.5 h-2.5" /> {label}
    </span>
  );
}

// Mini monochrome sparkline (inherits currentColor, so it stays grayscale).
function Spark({ points }: { points: number[] }) {
  const w = 56, h = 18;
  const min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
  const d = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((p - min) / span) * h;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" className="text-secondary shrink-0">
      <path d={d} stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// KPI tile, matching the app's StatCard: label + icon chip up top, big tabular
// value, then an optional monochrome trend pill or sparkline.
function Stat({ label, value, icon: Icon, trend, spark }: {
  label: string; value: string; icon: LucideIcon; trend?: string; spark?: number[];
}) {
  return (
    <div className="card-surface p-3">
      <div className="flex items-center justify-between">
        <span className="text-3xs font-medium uppercase tracking-wide text-tertiary truncate">{label}</span>
        <span className="w-5 h-5 rounded-md bg-surface-sunken ring-1 ring-subtle flex items-center justify-center shrink-0">
          <Icon className="w-2.5 h-2.5 text-tertiary" />
        </span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-1.5">
        <span className="text-lg font-semibold tabular-nums text-primary leading-none">{value}</span>
        {spark && <Spark points={spark} />}
      </div>
      {trend && (
        <span className="mt-2 inline-flex items-center gap-0.5 rounded-md bg-surface-hover px-1 py-0.5 text-3xs font-semibold text-secondary">
          <ArrowUpRight className="w-2.5 h-2.5" />{trend}
        </span>
      )}
    </div>
  );
}

function DealCard({ title, sub, amount }: { title: string; sub?: string; amount?: string }) {
  return (
    <div className="bg-surface rounded-lg ring-1 ring-subtle shadow-sm p-2.5 mb-2">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-full bg-surface-hover ring-1 ring-subtle shrink-0" />
        <span className="text-2xs font-medium text-primary truncate">{title}</span>
      </div>
      {sub && <div className="text-3xs text-tertiary mt-1 pl-7">{sub}</div>}
      {amount && <div className="text-2xs font-mono text-primary mt-1.5 pl-7">{amount}</div>}
    </div>
  );
}

function Column({ name, count, children }: { name: string; count: number; children: React.ReactNode }) {
  return (
    <div className="w-[210px] shrink-0 flex flex-col min-h-0">
      <div className="flex items-center gap-1.5 mb-2 px-0.5">
        <span className="text-2xs font-medium text-primary">{name}</span>
        <span className="text-3xs font-mono text-tertiary">{count}</span>
      </div>
      {/* Fills the window rather than a fixed height, so the columns can't
          overflow the shorter phone layout. */}
      <div className="rounded-xl bg-surface-sunken ring-1 ring-subtle p-2 h-full overflow-hidden">{children}</div>
    </div>
  );
}

// Elevated card wrapper for the table tabs — mirrors RecordTable's new carded,
// shadowed container with a sunken header row.
function Panel({ children }: { children: React.ReactNode }) {
  return <div className="card-surface overflow-hidden">{children}</div>;
}

/**
 * One tab's content. Always rendered; `hidden` when it is not the active tab.
 *
 * `hidden` and not a `display:none` class, because the attribute is what removes
 * the subtree from the accessibility tree and the tab order. A CSS-only hide
 * leaves five panels' worth of links and buttons focusable behind a window that
 * shows one — you would Tab into invisible content.
 */
function Panelled({ id, tab, children }: { id: Tab; tab: Tab; children: React.ReactNode }) {
  const active = id === tab;
  return (
    <div role="tabpanel" id={`pp-panel-${id}`} aria-labelledby={`pp-tab-${id}`} hidden={!active}
      className={active ? 'pp-panel-in' : undefined}>
      {children}
    </div>
  );
}

const TABS: { id: Tab; label: string; heading: string }[] = [
  { id: 'sales', label: 'Sales', heading: 'Sales' },
  { id: 'finance', label: 'Finance', heading: 'Finance' },
  { id: 'marketing', label: 'Marketing', heading: 'Marketing' },
  { id: 'projects', label: 'Projects', heading: 'Projects' },
  { id: 'hr', label: 'HR', heading: 'Recruiting' },
];

/**
 * The activity strip along the bottom of every tab.
 *
 * The window is 680px tall and the Sales board filled 214 of them, so two
 * thirds of the hero's centrepiece was empty canvas. That reads as an
 * unfinished screenshot rather than a product. Every real workspace view has a
 * recent-activity rail; adding it fills the space with the thing that actually
 * makes software look alive — evidence that other people are using it.
 */
function ActivityFeed({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="mt-3">
      <div className="text-3xs font-medium uppercase tracking-wide text-tertiary mb-2">Recent activity</div>
      <div className="space-y-px">
        {rows.map((r, i) => (
          <div key={r[1]}
            className="pp-row flex items-center gap-2.5 h-8 px-2 -mx-2 rounded-md hover:bg-surface-hover transition-colors"
            style={{ animationDelay: `${120 + i * 70}ms` }}>
            <span className="w-1.5 h-1.5 rounded-full bg-strong shrink-0" />
            <span className="text-2xs text-secondary truncate flex-1"><span className="text-primary font-medium">{r[0]}</span> {r[1]}</span>
            <span className="text-3xs font-mono text-tertiary shrink-0">{r[2]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A small labelled progress bar — the shape every funnel and budget wants. */
function Meter({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-2xs text-secondary">{label}</span>
        <span className="text-2xs font-mono text-primary tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-sunken ring-1 ring-subtle overflow-hidden">
        <div className="pp-meter h-full rounded-full bg-inverse/80" style={{ ['--pp-pct' as any]: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function ProductPreview() {
  const [tab, setTab] = useState<Tab>('sales');
  const listRef = useRef<HTMLDivElement>(null);

  // Deep-linkable: /#product=finance opens on Finance. Someone linking to "the
  // invoicing screenshot" should be able to land on it, and the hash is read
  // after mount so the server still renders the same HTML for everyone.
  useEffect(() => {
    const m = window.location.hash.match(/product=(\w+)/);
    const found = TABS.find((t) => t.id === m?.[1]);
    if (found) setTab(found.id);
  }, []);

  // Arrows move between tabs and take focus with them — that is what makes a
  // tablist a tablist. Home/End jump to the ends, matching every other one.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    let next = -1;
    if (delta) next = (TABS.findIndex((t) => t.id === tab) + delta + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next].id);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }, [tab]);

  return (
    <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-popover overflow-hidden">
      {/* window chrome */}
      <div className="h-10 flex items-center gap-3 px-3.5 border-b border-subtle bg-surface-sunken">
        <div className="hidden sm:flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-strong" />
          <span className="w-2.5 h-2.5 rounded-full bg-strong" />
          <span className="w-2.5 h-2.5 rounded-full bg-strong" />
        </div>
        <div className="hidden md:flex items-center gap-1.5 h-6 px-2.5 rounded-md bg-surface ring-1 ring-subtle shadow-sm text-tertiary text-2xs min-w-[180px]">
          <Search className="w-3 h-3" /> Search the workspace
          <span className="ml-auto font-mono text-3xs">⌘K</span>
        </div>
        <div ref={listRef} role="tablist" aria-label="Workspace modules" onKeyDown={onKeyDown}
          className="flex items-center gap-1 overflow-x-auto no-scrollbar ml-auto">
          {TABS.map((t) => (
            <button key={t.id} role="tab" id={`pp-tab-${t.id}`} aria-controls={`pp-panel-${t.id}`}
              aria-selected={tab === t.id}
              // Roving tabindex: one stop for the whole group, so Tab moves past
              // the window instead of through five buttons inside it.
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              className={`h-6 px-2.5 shrink-0 rounded-md text-2xs font-medium transition-colors ${tab === t.id ? 'bg-inverse text-inverse-fg' : 'text-tertiary hover:text-primary'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex h-[380px] sm:h-[560px] lg:h-[620px]">
        {/* mini nav rail (hidden on phones so the content gets the full width) */}
        <div className="hidden sm:flex w-12 shrink-0 border-r border-subtle bg-surface-sunken flex-col items-center gap-2 py-4">
          <div className="w-5 h-5 rounded-md bg-inverse mb-1.5" />
          {RAIL.map((r, i) => (
            <div key={i} className={`w-7 h-7 rounded-lg flex items-center justify-center ${i === 0 ? 'bg-surface ring-1 ring-subtle' : ''}`}>
              <r.icon className={`w-4 h-4 ${i === 0 ? 'text-primary' : 'text-tertiary'}`} />
            </div>
          ))}
        </div>

        {/* content */}
        <div className="flex-1 overflow-hidden">
          <div className="h-10 flex items-center px-4 border-b border-subtle">
            <span className="text-xs font-medium text-primary">{TABS.find((t) => t.id === tab)!.heading}</span>
            <span className="ml-2 text-3xs font-mono text-tertiary">workspace</span>
          </div>
          <div className="p-4 overflow-hidden">
          <Panelled id="sales" tab={tab}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <Stat label="Pipeline" value="$164k" icon={Target} spark={[42, 51, 47, 63, 58, 74, 81]} />
              <Stat label="Won this month" value="$48k" icon={Check} trend="22%" />
              <Stat label="Win rate" value="34%" icon={ArrowUpRight} />
              <Stat label="Avg. cycle" value="18d" icon={Clock} />
            </div>
            <div className="mt-3 h-[248px] sm:h-[268px] flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
              <Column name="Lead" count={3}>
                <DealCard title="Northwind" sub="northwind.io" amount="$24,000" />
                <DealCard title="Cobalt" sub="cobalt.dev" amount="$8,000" />
                <DealCard title="Ridgeway" amount="$15,500" />
              </Column>
              <Column name="Proposal" count={2}>
                <DealCard title="Vertex" sub="vertex.co" amount="$60,000" />
                <DealCard title="Kestrel" sub="kestrel.io" amount="$9,200" />
              </Column>
              <Column name="Negotiation" count={1}>
                <DealCard title="Halcyon" sub="halcyon.com" amount="$31,000" />
              </Column>
              <Column name="Won" count={2}>
                <DealCard title="Pulse" sub="pulse.app" amount="$36,000" />
                <DealCard title="Lumen" amount="$12,000" />
              </Column>
            </div>
            <ActivityFeed rows={[
              ['Vertex', 'moved to Proposal', '2m'],
              ['Anna K.', 'logged a call with Halcyon', '18m'],
              ['Invoice 1042', 'sent to Pulse', '1h'],
            ]} />
          </Panelled>

          <Panelled id="finance" tab={tab}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <Stat label="Revenue" value="$128k" icon={ArrowUpRight} spark={[38, 52, 44, 63, 58, 72, 80]} />
                <Stat label="Net profit" value="$41k" icon={Wallet} trend="18%" />
                <Stat label="Outstanding" value="$24k" icon={Clock} />
              </div>
              <Panel>
                <div className="grid grid-cols-3 gap-2 px-3.5 h-9 items-center bg-surface-sunken text-3xs font-semibold text-tertiary uppercase tracking-wide">
                  <span>Invoice</span><span className="text-right">Amount</span><span className="text-right">Status</span>
                </div>
                {[['INV-1001', '$24,000', 'paid'],
                  ['INV-1002', '$12,000', 'sent'],
                  ['INV-1003', '$36,000', 'overdue'],
                  ['INV-1004', '$4,500', 'draft'],
                  ['INV-1005', '$18,200', 'paid']].map((r) => (
                  <div key={r[0]} className="grid grid-cols-3 gap-2 px-3.5 h-11 items-center border-t border-subtle text-2xs">
                    <span className="font-medium text-secondary">{r[0]}</span>
                    <span className="text-right font-mono text-primary">{r[1]}</span>
                    <span className="text-right"><Chip label={r[2]} /></span>
                  </div>
                ))}
              </Panel>
              <div className="card-surface p-3.5 grid sm:grid-cols-3 gap-x-6 gap-y-3">
                <Meter label="Current" value="$41,200" pct={62} />
                <Meter label="1–30 days" value="$18,400" pct={28} />
                <Meter label="30+ days" value="$6,900" pct={10} />
              </div>
              <ActivityFeed rows={[
                ['Pulse', 'paid invoice 1038 — $36,000', '9m'],
                ['Reminder', 'sent for invoice 1003', '3h'],
                ['Expense', 'reconciled against the ledger', '5h'],
              ]} />
            </div>
          </Panelled>

          <Panelled id="marketing" tab={tab}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <Stat label="Visitors" value="2,480" icon={Users} trend="12%" />
                <Stat label="Pageviews" value="6,120" icon={Eye} />
                <Stat label="Signups" value="184" icon={ArrowUpRight} spark={[20, 28, 24, 36, 44, 40, 52]} />
                <Stat label="Live now" value="7" icon={Activity} />
              </div>
              <div className="card-surface p-3.5">
                <div className="text-3xs font-medium uppercase tracking-wide text-tertiary mb-3">Visitors, last 14 days</div>
                <div className="flex items-end gap-1.5 h-28">
                  {[38, 52, 44, 63, 58, 72, 66, 80, 61, 74, 88, 70, 83, 92].map((h, i) => (
                    <div key={i} className="flex-1 rounded-sm bg-inverse/75" style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
              <Panel>
                <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3.5 h-9 items-center bg-surface-sunken text-3xs font-semibold text-tertiary uppercase tracking-wide">
                  <span>Source</span><span className="text-right">Visitors</span><span className="text-right">Signups</span>
                </div>
                {[['Organic search', '1,204', '82'],
                  ['GitHub', 'momentum', '—'],
                  ['Newsletter', '388', '41'],
                  ['Direct', '512', '29']].map((r) => (
                  <div key={r[0]} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3.5 h-10 items-center border-t border-subtle text-2xs">
                    <span className="text-secondary">{r[0]}</span>
                    <span className="text-right font-mono text-primary tabular-nums">{r[1]}</span>
                    <span className="text-right font-mono text-primary tabular-nums">{r[2]}</span>
                  </div>
                ))}
              </Panel>
            </div>
          </Panelled>

          <Panelled id="projects" tab={tab}>
            <div className="h-[236px] flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
              <Column name="Todo" count={3}>
                <DealCard title="Wire Stripe billing" sub="David R." />
                <DealCard title="Customer interviews" sub="Lena F." />
                <DealCard title="Migrate the file store" sub="Unassigned" />
              </Column>
              <Column name="In progress" count={2}>
                <DealCard title="Design landing page" sub="Anna K." />
                <DealCard title="Agent approval flow" sub="Marcus O." />
              </Column>
              <Column name="Review" count={1}>
                <DealCard title="Import: CSV column matching" sub="Sara L." />
              </Column>
              <Column name="Done" count={2}>
                <DealCard title="Set up CI/CD" sub="Sara L." />
                <DealCard title="Deal board drag + drop" sub="David R." />
              </Column>
            </div>
            <div className="mt-3 card-surface p-3.5">
              <div className="text-3xs font-medium uppercase tracking-wide text-tertiary mb-2.5">This quarter</div>
              <div className="space-y-2">
                {[['Billing', 18, 62], ['Agents', 34, 44], ['Imports', 8, 26]].map(([n, off, w]) => (
                  <div key={n as string} className="flex items-center gap-2.5">
                    <span className="text-2xs text-secondary w-16 shrink-0">{n}</span>
                    <div className="flex-1 h-2 rounded-full bg-surface-sunken ring-1 ring-subtle relative overflow-hidden">
                      <div className="pp-meter absolute inset-y-0 rounded-full bg-inverse/70"
                        style={{ left: `${off}%`, ['--pp-pct' as any]: `${w}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <ActivityFeed rows={[
              ['Anna K.', 'moved Design landing page to In progress', '12m'],
              ['CI', 'passed on 4 commits', '40m'],
            ]} />
          </Panelled>

          <Panelled id="hr" tab={tab}>
            <Panel>
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3.5 h-9 items-center bg-surface-sunken text-3xs font-semibold text-tertiary uppercase tracking-wide">
                <span>Candidate</span><span>Match</span><span>Status</span>
              </div>
              {[['Anna Kowalski', 'Senior Engineer', '92', 'Interview'],
                ['David Reyes', 'Sales Lead', '88', 'Offered'],
                ['Marcus Obi', 'Data Scientist', '81', 'Assessed'],
                ['Sara Lindqvist', 'Product Designer', '74', 'Screening'],
                ['Lena Fischer', 'Account Exec', '68', 'Applied']].map((r) => (
                <div key={r[0]} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3.5 h-[58px] items-center border-t border-subtle">
                  <div className="min-w-0">
                    <div className="text-2xs font-medium text-primary truncate">{r[0]}</div>
                    <div className="text-3xs text-tertiary truncate">{r[1]}</div>
                  </div>
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-surface-hover ring-1 ring-subtle text-2xs font-mono text-primary">{r[2]}</span>
                  <Chip label={r[3]} />
                </div>
              ))}
            </Panel>
            <div className="mt-3 card-surface p-3.5 grid sm:grid-cols-4 gap-x-6 gap-y-3">
              <Meter label="Applied" value="34" pct={100} />
              <Meter label="Screened" value="17" pct={50} />
              <Meter label="Interviewed" value="8" pct={24} />
              <Meter label="Offered" value="2" pct={6} />
            </div>
          </Panelled>
          </div>
        </div>
      </div>
    </div>
  );
}
