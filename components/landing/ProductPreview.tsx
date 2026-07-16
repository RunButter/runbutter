'use client';

import { useState } from 'react';
import { Target, Receipt, FolderKanban, LayoutDashboard, Users, Building2, Wallet, Heart, Megaphone } from 'lucide-react';

type Tab = 'sales' | 'finance' | 'marketing' | 'projects' | 'hr';

const RAIL = [
  { icon: LayoutDashboard }, { icon: Target }, { icon: Building2 }, { icon: Users },
  { icon: Receipt }, { icon: Wallet }, { icon: Megaphone }, { icon: FolderKanban }, { icon: Heart },
];

function Chip({ label, tone }: { label: string; tone: string }) {
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${tone}`}>{label}</span>;
}

function Card({ title, sub, amount }: { title: string; sub?: string; amount?: string }) {
  return (
    <div className="bg-surface rounded-lg border border-subtle p-2 mb-2">
      <div className="flex items-center gap-1.5">
        <div className="w-4 h-4 rounded-full bg-accent/30" />
        <span className="text-[11px] font-semibold text-secondary truncate">{title}</span>
      </div>
      {sub && <div className="text-[10px] text-tertiary mt-0.5 pl-5.5">{sub}</div>}
      {amount && <div className="text-[10px] font-medium text-success mt-1">{amount}</div>}
    </div>
  );
}

function Column({ name, color, children }: { name: string; color: string; children: React.ReactNode }) {
  return (
    <div className="w-[190px] shrink-0">
      <div className="flex items-center gap-1.5 mb-2 px-0.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
        <span className="text-[11px] font-medium text-secondary">{name}</span>
      </div>
      <div className="rounded-lg bg-surface-sunken border border-subtle p-2 min-h-[360px]">{children}</div>
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
    <div className="rounded-lg bg-surface border border-subtle shadow-popover overflow-hidden">
      {/* window chrome */}
      <div className="h-9 flex items-center gap-2 px-3 border-b border-subtle bg-surface-sunken">
        <div className="hidden sm:flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-strong" />
          <span className="w-2.5 h-2.5 rounded-full bg-strong" />
          <span className="w-2.5 h-2.5 rounded-full bg-strong" />
        </div>
        <div className="sm:ml-3 flex items-center gap-1 overflow-x-auto no-scrollbar">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`h-6 px-2.5 shrink-0 rounded-md text-[11px] font-semibold transition-colors ${tab === t.id ? 'bg-surface text-primary border border-subtle' : 'text-tertiary hover:text-secondary'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex h-[460px]">
        {/* mini nav rail */}
        <div className="w-11 shrink-0 border-r border-subtle bg-surface-sunken flex flex-col items-center gap-3 py-3.5">
          <div className="w-5 h-5 rounded bg-accent" />
          {RAIL.map((r, i) => <r.icon key={i} className="w-3.5 h-3.5 text-tertiary" />)}
        </div>

        {/* content */}
        <div className="flex-1 overflow-hidden p-3">
          {tab === 'sales' && (
            <div className="flex gap-2.5 overflow-hidden">
              <Column name="Lead" color="#94a3b8"><Card title="Northwind" sub="northwind.io" amount="$24,000" /><Card title="Cobalt" amount="$8,000" /></Column>
              <Column name="Proposal" color="#a78bfa"><Card title="Vertex" sub="vertex.co" amount="$60,000" /></Column>
              <Column name="Won" color="#34d399"><Card title="Pulse" amount="$36,000" /><Card title="Lumen" amount="$12,000" /></Column>
            </div>
          )}

          {tab === 'finance' && (
            <div className="rounded-lg border border-subtle overflow-hidden">
              <div className="grid grid-cols-3 gap-2 px-3 h-7 items-center bg-surface-sunken text-[10px] font-medium text-secondary uppercase tracking-wider">
                <span>Invoice</span><span className="text-right">Amount</span><span className="text-right">Status</span>
              </div>
              {[['INV-1001', '$24,000', 'paid', 'bg-success/10 text-success'],
                ['INV-1002', '$12,000', 'sent', 'bg-accent/10 text-accent'],
                ['INV-1003', '$36,000', 'overdue', 'bg-danger/10 text-danger'],
                ['INV-1004', '$4,500', 'draft', 'bg-surface-hover text-secondary']].map((r) => (
                <div key={r[0]} className="grid grid-cols-3 gap-2 px-3 h-9 items-center border-t border-subtle text-[11px]">
                  <span className="font-semibold text-secondary">{r[0]}</span>
                  <span className="text-right tabular-nums font-semibold text-primary">{r[1]}</span>
                  <span className="text-right"><Chip label={r[2]} tone={r[3]} /></span>
                </div>
              ))}
            </div>
          )}

          {tab === 'marketing' && (
            <div className="space-y-2.5">
              <div className="grid grid-cols-3 gap-2">
                {[['Visitors', '2,480', 'text-primary'], ['Pageviews', '6,120', 'text-primary'], ['Live now', '7', 'text-success']].map((k) => (
                  <div key={k[0]} className="rounded-lg border border-subtle p-2">
                    <div className="text-[9px] font-medium uppercase tracking-wide text-tertiary">{k[0]}</div>
                    <div className={`text-base font-medium tabular-nums ${k[2]}`}>{k[1]}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-subtle p-3">
                <div className="text-[10px] font-medium uppercase tracking-wide text-tertiary mb-2">Visitors · last 12 days</div>
                <div className="flex items-end gap-1.5 h-24">
                  {[38, 52, 44, 63, 58, 72, 66, 80, 61, 74, 88, 70].map((h, i) => (
                    <div key={i} className="flex-1 rounded-sm bg-accent/70" style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-subtle overflow-hidden">
                {[['/', '1,840'], ['/pricing', '920'], ['/blog/bus-covers-guide', '610']].map((r, i) => (
                  <div key={r[0]} className={`flex items-center justify-between px-3 h-8 text-[11px] ${i ? 'border-t border-subtle' : ''}`}>
                    <span className="font-medium text-secondary truncate">{r[0]}</span>
                    <span className="tabular-nums font-semibold text-secondary">{r[1]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'projects' && (
            <div className="flex gap-2.5 overflow-hidden">
              <Column name="Todo" color="#60a5fa"><Card title="Wire Stripe billing" sub="David R." /><Card title="Customer interviews" sub="Lena F." /></Column>
              <Column name="In progress" color="#a78bfa"><Card title="Design landing page" sub="Anna K." /></Column>
              <Column name="Done" color="#34d399"><Card title="Set up CI/CD" sub="Sara L." /></Column>
            </div>
          )}

          {tab === 'hr' && (
            <div className="rounded-lg border border-subtle overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 h-7 items-center bg-surface-sunken text-[10px] font-medium text-secondary uppercase tracking-wider">
                <span>Candidate</span><span>Match</span><span>Status</span>
              </div>
              {[['Anna Kowalski', 'Senior Engineer', '92', 'Interview', 'bg-warning/10 text-warning'],
                ['David Reyes', 'Sales Lead', '88', 'Offered', 'bg-success/10 text-success'],
                ['Marcus Obi', 'Data Scientist', '81', 'Assessed', 'bg-accent/10 text-accent'],
                ['Sara Lindqvist', 'Product Designer', '74', 'Screening', 'bg-warning/10 text-warning']].map((r) => (
                <div key={r[0]} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 h-[52px] items-center border-t border-subtle">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-secondary truncate">{r[0]}</div>
                    <div className="text-[10px] text-tertiary truncate">{r[1]}</div>
                  </div>
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-accent/10 text-[10px] font-medium text-accent tabular-nums">{r[2]}</span>
                  <Chip label={r[3]} tone={r[4]} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
