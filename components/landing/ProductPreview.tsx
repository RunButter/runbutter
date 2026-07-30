'use client';

import { useState } from 'react';
import {
  Target, Receipt, FolderKanban, LayoutDashboard, Users, Building2, Wallet, Heart, Megaphone, Search,
  Check, Clock, CircleDashed, X, ArrowUpRight, Eye, Activity, type LucideIcon,
} from 'lucide-react';

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
    <div className="rounded-xl bg-surface ring-1 ring-subtle shadow-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-3xs font-semibold uppercase tracking-wide text-tertiary truncate">{label}</span>
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
    <div className="w-[210px] shrink-0">
      <div className="flex items-center gap-1.5 mb-2 px-0.5">
        <span className="text-2xs font-medium text-primary">{name}</span>
        <span className="text-3xs font-mono text-tertiary">{count}</span>
      </div>
      {/* Fills the window rather than a fixed height, so the columns can't
          overflow the shorter phone layout. */}
      <div className="rounded-xl bg-surface-sunken ring-1 ring-subtle p-2 h-full">{children}</div>
    </div>
  );
}

// Elevated card wrapper for the table tabs — mirrors RecordTable's new carded,
// shadowed container with a sunken header row.
function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl bg-surface ring-1 ring-subtle shadow-card overflow-hidden">{children}</div>;
}

export default function ProductPreview() {
  const [tab, setTab] = useState<Tab>('sales');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'sales', label: 'Sales' },
    { id: 'finance', label: 'Finance' },
    { id: 'marketing', label: 'Marketing' },
    { id: 'projects', label: 'Projects' },
    { id: 'hr', label: 'HR' },
  ];

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
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar ml-auto">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`h-6 px-2.5 shrink-0 rounded-md text-2xs font-medium transition-colors ${tab === t.id ? 'bg-inverse text-inverse-fg' : 'text-tertiary hover:text-primary'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex h-[500px] sm:h-[620px] lg:h-[700px]">
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
            <span className="text-xs font-medium text-primary capitalize">{tab === 'hr' ? 'Recruiting' : tab}</span>
            <span className="ml-2 text-3xs font-mono text-tertiary">workspace</span>
          </div>
          <div className="p-4 overflow-hidden">
          {tab === 'sales' && (
            <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
              <Column name="Lead" count={2}><DealCard title="Northwind" sub="northwind.io" amount="$24,000" /><DealCard title="Cobalt" amount="$8,000" /></Column>
              <Column name="Proposal" count={1}><DealCard title="Vertex" sub="vertex.co" amount="$60,000" /></Column>
              <Column name="Won" count={2}><DealCard title="Pulse" amount="$36,000" /><DealCard title="Lumen" amount="$12,000" /></Column>
            </div>
          )}

          {tab === 'finance' && (
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
            </div>
          )}

          {tab === 'marketing' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <Stat label="Visitors" value="2,480" icon={Users} trend="12%" />
                <Stat label="Pageviews" value="6,120" icon={Eye} />
                <Stat label="Signups" value="184" icon={ArrowUpRight} spark={[20, 28, 24, 36, 44, 40, 52]} />
                <Stat label="Live now" value="7" icon={Activity} />
              </div>
              <div className="rounded-xl bg-surface ring-1 ring-subtle shadow-card p-3.5">
                <div className="text-3xs font-semibold uppercase tracking-wide text-tertiary mb-3">Visitors, last 14 days</div>
                <div className="flex items-end gap-1.5 h-28">
                  {[38, 52, 44, 63, 58, 72, 66, 80, 61, 74, 88, 70, 83, 92].map((h, i) => (
                    <div key={i} className="flex-1 rounded-sm bg-inverse/75" style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'projects' && (
            <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
              <Column name="Todo" count={2}><DealCard title="Wire Stripe billing" sub="David R." /><DealCard title="Customer interviews" sub="Lena F." /></Column>
              <Column name="In progress" count={1}><DealCard title="Design landing page" sub="Anna K." /></Column>
              <Column name="Done" count={1}><DealCard title="Set up CI/CD" sub="Sara L." /></Column>
            </div>
          )}

          {tab === 'hr' && (
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
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
