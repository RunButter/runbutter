'use client';

import { useState } from 'react';
import { Target, Receipt, FolderKanban, LayoutDashboard, Users, Building2, Wallet, Heart, Megaphone, Search } from 'lucide-react';

type Tab = 'sales' | 'finance' | 'marketing' | 'projects' | 'hr';

const RAIL = [
  { icon: LayoutDashboard }, { icon: Target }, { icon: Building2 }, { icon: Users },
  { icon: Receipt }, { icon: Wallet }, { icon: Megaphone }, { icon: FolderKanban }, { icon: Heart },
];

// Monochrome chip: "done/positive" states read as a solid inverse fill, the
// rest as a quiet outline. No hue — the whole preview stays grayscale.
const SOLID = new Set(['paid', 'won', 'offered', 'done', 'live']);
function Chip({ label }: { label: string }) {
  const solid = SOLID.has(label.toLowerCase());
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium capitalize ${
      solid ? 'bg-inverse text-inverse-fg' : 'bg-surface-hover text-secondary'}`}>
      {label}
    </span>
  );
}

function Card({ title, sub, amount }: { title: string; sub?: string; amount?: string }) {
  return (
    <div className="bg-surface rounded-md border border-subtle p-2.5 mb-2">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-full bg-surface-hover border border-subtle shrink-0" />
        <span className="text-[11px] font-medium text-primary truncate">{title}</span>
      </div>
      {sub && <div className="text-[10px] text-tertiary mt-1 pl-7">{sub}</div>}
      {amount && <div className="text-[11px] font-mono text-primary mt-1.5 pl-7">{amount}</div>}
    </div>
  );
}

function Column({ name, count, children }: { name: string; count: number; children: React.ReactNode }) {
  return (
    <div className="w-[210px] shrink-0">
      <div className="flex items-center gap-1.5 mb-2 px-0.5">
        <span className="text-[11px] font-medium text-primary">{name}</span>
        <span className="text-[10px] font-mono text-tertiary">{count}</span>
      </div>
      <div className="rounded-lg bg-surface-sunken border border-subtle p-2 min-h-[440px]">{children}</div>
    </div>
  );
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
    <div className="rounded-xl bg-surface border border-subtle shadow-popover overflow-hidden">
      {/* window chrome */}
      <div className="h-10 flex items-center gap-3 px-3.5 border-b border-subtle bg-surface-sunken">
        <div className="hidden sm:flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-strong" />
          <span className="w-2.5 h-2.5 rounded-full bg-strong" />
          <span className="w-2.5 h-2.5 rounded-full bg-strong" />
        </div>
        <div className="hidden md:flex items-center gap-1.5 h-6 px-2.5 rounded-md bg-surface border border-subtle text-tertiary text-[11px] min-w-[180px]">
          <Search className="w-3 h-3" /> Search the workspace
          <span className="ml-auto font-mono text-[10px]">⌘K</span>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar ml-auto">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`h-6 px-2.5 shrink-0 rounded-md text-[11px] font-medium transition-colors ${tab === t.id ? 'bg-inverse text-inverse-fg' : 'text-tertiary hover:text-primary'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex h-[440px] sm:h-[520px] lg:h-[560px]">
        {/* mini nav rail */}
        <div className="w-12 shrink-0 border-r border-subtle bg-surface-sunken flex flex-col items-center gap-3.5 py-4">
          <div className="w-5 h-5 rounded bg-inverse" />
          {RAIL.map((r, i) => <r.icon key={i} className={`w-4 h-4 ${i === 0 ? 'text-primary' : 'text-tertiary'}`} />)}
        </div>

        {/* content */}
        <div className="flex-1 overflow-hidden">
          <div className="h-10 flex items-center px-4 border-b border-subtle">
            <span className="text-[12px] font-medium text-primary capitalize">{tab === 'hr' ? 'Recruiting' : tab}</span>
            <span className="ml-2 text-[10px] font-mono text-tertiary">workspace</span>
          </div>
          <div className="p-4 overflow-hidden">
          {tab === 'sales' && (
            <div className="flex gap-3 overflow-hidden">
              <Column name="Lead" count={2}><Card title="Northwind" sub="northwind.io" amount="$24,000" /><Card title="Cobalt" amount="$8,000" /></Column>
              <Column name="Proposal" count={1}><Card title="Vertex" sub="vertex.co" amount="$60,000" /></Column>
              <Column name="Won" count={2}><Card title="Pulse" amount="$36,000" /><Card title="Lumen" amount="$12,000" /></Column>
            </div>
          )}

          {tab === 'finance' && (
            <div className="rounded-lg border border-subtle overflow-hidden">
              <div className="grid grid-cols-3 gap-2 px-3.5 h-8 items-center bg-surface-sunken text-[10px] font-medium text-tertiary uppercase tracking-wide">
                <span>Invoice</span><span className="text-right">Amount</span><span className="text-right">Status</span>
              </div>
              {[['INV-1001', '$24,000', 'paid'],
                ['INV-1002', '$12,000', 'sent'],
                ['INV-1003', '$36,000', 'overdue'],
                ['INV-1004', '$4,500', 'draft'],
                ['INV-1005', '$18,200', 'paid'],
                ['INV-1006', '$9,900', 'sent']].map((r) => (
                <div key={r[0]} className="grid grid-cols-3 gap-2 px-3.5 h-11 items-center border-t border-subtle text-[11px]">
                  <span className="font-medium text-secondary">{r[0]}</span>
                  <span className="text-right font-mono text-primary">{r[1]}</span>
                  <span className="text-right"><Chip label={r[2]} /></span>
                </div>
              ))}
            </div>
          )}

          {tab === 'marketing' && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                {[['Visitors', '2,480'], ['Pageviews', '6,120'], ['Signups', '184'], ['Live now', '7']].map((k) => (
                  <div key={k[0]} className="rounded-lg border border-subtle p-2.5">
                    <div className="text-[9px] font-medium uppercase tracking-wide text-tertiary">{k[0]}</div>
                    <div className="text-lg font-mono text-primary">{k[1]}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-subtle p-3.5">
                <div className="text-[10px] font-medium uppercase tracking-wide text-tertiary mb-3">Visitors · last 14 days</div>
                <div className="flex items-end gap-1.5 h-32">
                  {[38, 52, 44, 63, 58, 72, 66, 80, 61, 74, 88, 70, 83, 92].map((h, i) => (
                    <div key={i} className="flex-1 rounded-sm bg-inverse/75" style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-subtle overflow-hidden">
                {[['/', '1,840'], ['/pricing', '920'], ['/blog/open-company-os', '610']].map((r, i) => (
                  <div key={r[0]} className={`flex items-center justify-between px-3.5 h-9 text-[11px] ${i ? 'border-t border-subtle' : ''}`}>
                    <span className="font-medium text-secondary truncate">{r[0]}</span>
                    <span className="font-mono text-secondary">{r[1]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'projects' && (
            <div className="flex gap-3 overflow-hidden">
              <Column name="Todo" count={2}><Card title="Wire Stripe billing" sub="David R." /><Card title="Customer interviews" sub="Lena F." /></Column>
              <Column name="In progress" count={1}><Card title="Design landing page" sub="Anna K." /></Column>
              <Column name="Done" count={1}><Card title="Set up CI/CD" sub="Sara L." /></Column>
            </div>
          )}

          {tab === 'hr' && (
            <div className="rounded-lg border border-subtle overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3.5 h-8 items-center bg-surface-sunken text-[10px] font-medium text-tertiary uppercase tracking-wide">
                <span>Candidate</span><span>Match</span><span>Status</span>
              </div>
              {[['Anna Kowalski', 'Senior Engineer', '92', 'Interview'],
                ['David Reyes', 'Sales Lead', '88', 'Offered'],
                ['Marcus Obi', 'Data Scientist', '81', 'Assessed'],
                ['Sara Lindqvist', 'Product Designer', '74', 'Screening'],
                ['Lena Fischer', 'Account Exec', '68', 'Applied']].map((r) => (
                <div key={r[0]} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3.5 h-[58px] items-center border-t border-subtle">
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-primary truncate">{r[0]}</div>
                    <div className="text-[10px] text-tertiary truncate">{r[1]}</div>
                  </div>
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-surface-hover text-[11px] font-mono text-primary">{r[2]}</span>
                  <Chip label={r[3]} />
                </div>
              ))}
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
