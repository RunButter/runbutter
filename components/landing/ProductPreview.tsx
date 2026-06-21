'use client';

import { useState } from 'react';
import { Target, Receipt, FolderKanban, LayoutDashboard, Users, Building2, Wallet, Heart } from 'lucide-react';

type Tab = 'sales' | 'finance' | 'projects';

const RAIL = [
  { icon: LayoutDashboard }, { icon: Target }, { icon: Building2 },
  { icon: Users }, { icon: Receipt }, { icon: Wallet }, { icon: FolderKanban }, { icon: Heart },
];

function Chip({ label, tone }: { label: string; tone: string }) {
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold ring-1 ${tone}`}>{label}</span>;
}

function Card({ title, sub, amount }: { title: string; sub?: string; amount?: string }) {
  return (
    <div className="bg-white rounded-lg ring-1 ring-slate-200/70 p-2 mb-2">
      <div className="flex items-center gap-1.5">
        <div className="w-4 h-4 rounded-full bg-gradient-to-br from-indigo-400 to-fuchsia-400" />
        <span className="text-[11px] font-semibold text-slate-700 truncate">{title}</span>
      </div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5 pl-5.5">{sub}</div>}
      {amount && <div className="text-[10px] font-bold text-emerald-600 mt-1">{amount}</div>}
    </div>
  );
}

function Column({ name, color, children }: { name: string; color: string; children: React.ReactNode }) {
  return (
    <div className="w-[120px] shrink-0">
      <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
        <span className="text-[10px] font-bold text-slate-600">{name}</span>
      </div>
      <div className="rounded-lg bg-slate-50/70 ring-1 ring-slate-200/50 p-1.5 min-h-[150px]">{children}</div>
    </div>
  );
}

export default function ProductPreview() {
  const [tab, setTab] = useState<Tab>('sales');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'sales', label: 'Sales' },
    { id: 'finance', label: 'Finance' },
    { id: 'projects', label: 'Projects' },
  ];

  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200/70 shadow-2xl overflow-hidden">
      {/* window chrome */}
      <div className="h-9 flex items-center gap-2 px-3 border-b border-slate-200/70 bg-slate-50/60">
        <span className="w-2.5 h-2.5 rounded-full bg-slate-200" />
        <span className="w-2.5 h-2.5 rounded-full bg-slate-200" />
        <span className="w-2.5 h-2.5 rounded-full bg-slate-200" />
        <div className="ml-3 flex items-center gap-1">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`h-6 px-2.5 rounded-md text-[11px] font-semibold transition-colors ${tab === t.id ? 'bg-white text-slate-800 ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-600'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex h-[260px]">
        {/* mini nav rail */}
        <div className="w-10 shrink-0 border-r border-slate-200/70 bg-slate-50/40 flex flex-col items-center gap-2.5 py-3">
          <div className="w-5 h-5 rounded-md bg-gradient-to-br from-indigo-500 to-fuchsia-500" />
          {RAIL.map((r, i) => <r.icon key={i} className="w-3.5 h-3.5 text-slate-300" />)}
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
            <div className="rounded-lg ring-1 ring-slate-200/60 overflow-hidden">
              <div className="grid grid-cols-3 gap-2 px-3 h-7 items-center bg-slate-50/70 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                <span>Invoice</span><span className="text-right">Amount</span><span className="text-right">Status</span>
              </div>
              {[['INV-1001', '$24,000', 'paid', 'bg-emerald-50 text-emerald-700 ring-emerald-200/60'],
                ['INV-1002', '$12,000', 'sent', 'bg-blue-50 text-blue-700 ring-blue-200/60'],
                ['INV-1003', '$36,000', 'overdue', 'bg-rose-50 text-rose-700 ring-rose-200/60'],
                ['INV-1004', '$4,500', 'draft', 'bg-slate-100 text-slate-500 ring-slate-200/60']].map((r) => (
                <div key={r[0]} className="grid grid-cols-3 gap-2 px-3 h-9 items-center border-t border-slate-100 text-[11px]">
                  <span className="font-semibold text-slate-700">{r[0]}</span>
                  <span className="text-right tabular-nums font-semibold text-slate-800">{r[1]}</span>
                  <span className="text-right"><Chip label={r[2]} tone={r[3]} /></span>
                </div>
              ))}
            </div>
          )}
          {tab === 'projects' && (
            <div className="flex gap-2.5 overflow-hidden">
              <Column name="Todo" color="#60a5fa"><Card title="Wire Stripe billing" sub="David R." /><Card title="Customer interviews" sub="Lena F." /></Column>
              <Column name="In progress" color="#a78bfa"><Card title="Design landing page" sub="Anna K." /></Column>
              <Column name="Done" color="#34d399"><Card title="Set up CI/CD" sub="Sara L." /></Column>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
