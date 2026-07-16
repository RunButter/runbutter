import { Check } from 'lucide-react';
import FinanceChart from '@/components/crm/FinanceChart';
import type { FinanceSeriesPoint } from '@/lib/crm/data';

// Deep-dive feature rows for the landing page. Each pairs a copy block with a
// static mockup of the REAL module UI (the Finance row even reuses the live
// FinanceChart component) so the marketing matches the product. The Marketing
// section is a full-width band that breaks the left/right split rhythm.

const FIN_SERIES: FinanceSeriesPoint[] = [
  { month: '2026-01', label: 'Jan', revenue: 18000, costs: 11000 },
  { month: '2026-02', label: 'Feb', revenue: 22000, costs: 12500 },
  { month: '2026-03', label: 'Mar', revenue: 26000, costs: 15000 },
  { month: '2026-04', label: 'Apr', revenue: 24000, costs: 14000 },
  { month: '2026-05', label: 'May', revenue: 31000, costs: 16500 },
  { month: '2026-06', label: 'Jun', revenue: 38000, costs: 19000 },
];

function MockWindow({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200/70 shadow-xl overflow-hidden">
      <div className="h-8 flex items-center gap-1.5 px-3 border-b border-slate-200/70 bg-slate-50/60">
        <span className="w-2 h-2 rounded-full bg-slate-200" />
        <span className="w-2 h-2 rounded-full bg-slate-200" />
        <span className="w-2 h-2 rounded-full bg-slate-200" />
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function MiniCard({ title, sub, amount }: { title: string; sub?: string; amount?: string }) {
  return (
    <div className="bg-white rounded-lg ring-1 ring-slate-200/70 p-2 mb-2">
      <div className="flex items-center gap-1.5">
        <span className="w-3.5 h-3.5 rounded-full bg-gradient-to-br from-indigo-400 to-fuchsia-400 shrink-0" />
        <span className="text-[11px] font-semibold text-slate-700 truncate">{title}</span>
      </div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5 pl-5">{sub}</div>}
      {amount && <div className="text-[10px] font-bold text-emerald-600 mt-1 pl-5">{amount}</div>}
    </div>
  );
}

function MiniColumn({ name, color, children }: { name: string; color: string; children: React.ReactNode }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5 mb-2 px-0.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
        <span className="text-[11px] font-bold text-slate-600">{name}</span>
      </div>
      <div className="rounded-lg bg-slate-50/70 ring-1 ring-slate-200/50 p-2 min-h-[200px]">{children}</div>
    </div>
  );
}

function SalesMock() {
  return (
    <MockWindow>
      <div className="flex gap-2.5">
        <MiniColumn name="Lead" color="#94a3b8"><MiniCard title="Northwind" sub="northwind.io" amount="$24,000" /><MiniCard title="Cobalt" amount="$8,000" /></MiniColumn>
        <MiniColumn name="Proposal" color="#a78bfa"><MiniCard title="Vertex" sub="vertex.co" amount="$60,000" /></MiniColumn>
        <MiniColumn name="Won" color="#34d399"><MiniCard title="Pulse" amount="$36,000" /></MiniColumn>
      </div>
    </MockWindow>
  );
}

function FinanceMock() {
  const kpis = [
    { label: 'Revenue', value: '$38,000', tone: 'text-emerald-600' },
    { label: 'Costs', value: '$19,000', tone: 'text-slate-700' },
    { label: 'Net', value: '$19,000', tone: 'text-emerald-600' },
  ];
  return (
    <MockWindow>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg ring-1 ring-slate-200/60 p-2">
            <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{k.label}</div>
            <div className={`text-base font-black tabular-nums ${k.tone}`}>{k.value}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mb-1 text-[10px] font-semibold">
        <span className="inline-flex items-center gap-1 text-slate-500"><span className="w-2 h-2 rounded-sm bg-emerald-500" /> Revenue</span>
        <span className="inline-flex items-center gap-1 text-slate-500"><span className="w-2 h-2 rounded-sm bg-slate-400" /> Costs</span>
      </div>
      <FinanceChart series={FIN_SERIES} />
    </MockWindow>
  );
}

function RecruitingMock() {
  const rows: [string, string, string, string, string][] = [
    ['Anna Kowalski', 'Senior Engineer', '92', 'Interview', 'bg-orange-50 text-orange-700 ring-orange-200/60'],
    ['David Reyes', 'Sales Lead', '88', 'Offered', 'bg-emerald-50 text-emerald-700 ring-emerald-200/60'],
    ['Marcus Obi', 'Data Scientist', '81', 'Assessed', 'bg-indigo-50 text-indigo-700 ring-indigo-200/60'],
    ['Sara Lindqvist', 'Product Designer', '74', 'Screening', 'bg-amber-50 text-amber-700 ring-amber-200/60'],
  ];
  return (
    <MockWindow>
      <div className="rounded-lg ring-1 ring-slate-200/60 overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 h-7 items-center bg-slate-50/70 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
          <span>Candidate</span><span>Match</span><span>Status</span>
        </div>
        {rows.map((r) => (
          <div key={r[0]} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 h-[52px] items-center border-t border-slate-100">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-slate-700 truncate">{r[0]}</div>
              <div className="text-[10px] text-slate-400 truncate">{r[1]}</div>
            </div>
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-50 ring-1 ring-indigo-100 text-[10px] font-black text-indigo-700 tabular-nums">{r[2]}</span>
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold ring-1 ${r[4]}`}>{r[3]}</span>
          </div>
        ))}
      </div>
    </MockWindow>
  );
}

function MarketingDash() {
  return (
    <MockWindow>
      <div className="grid md:grid-cols-[1.1fr_1.4fr] gap-4">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[['Visitors', '2,480', 'text-slate-800'], ['Views', '6,120', 'text-slate-800'], ['Live', '7', 'text-emerald-600']].map((k) => (
              <div key={k[0]} className="rounded-lg ring-1 ring-slate-200/60 p-2">
                <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{k[0]}</div>
                <div className={`text-base font-black tabular-nums ${k[2]}`}>{k[1]}</div>
              </div>
            ))}
          </div>
          <div className="rounded-lg ring-1 ring-slate-200/60 overflow-hidden">
            {[['/', '1,840'], ['/pricing', '920'], ['/blog/bus-covers-guide', '610'], ['/contact', '340']].map((r, i) => (
              <div key={r[0]} className={`flex items-center justify-between px-3 h-8 text-[11px] ${i ? 'border-t border-slate-100' : ''}`}>
                <span className="font-medium text-slate-600 truncate">{r[0]}</span>
                <span className="tabular-nums font-semibold text-slate-700">{r[1]}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg ring-1 ring-slate-200/60 p-3 flex flex-col">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Visitors · last 14 days</div>
          <div className="flex-1 flex items-end gap-1.5 min-h-[150px]">
            {[38, 52, 44, 63, 58, 72, 66, 80, 61, 74, 88, 70, 83, 92].map((h, i) => (
              <div key={i} className="flex-1 rounded-sm bg-gradient-to-t from-indigo-400 to-fuchsia-400" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
      </div>
    </MockWindow>
  );
}

function Row({ reverse, eyebrow, tone, title, body, bullets, visual }: {
  reverse?: boolean; eyebrow: string; tone: string; title: string; body: string; bullets: string[]; visual: React.ReactNode;
}) {
  return (
    <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
      <div className={reverse ? 'lg:order-2' : ''}>
        <div className={`inline-block text-[12px] font-bold mb-3 px-2.5 py-0.5 rounded-full dark:!bg-indigo-500/10 dark:!text-indigo-300 ${tone}`}>{eyebrow}</div>
        <h3 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900 dark:text-white">{title}</h3>
        <p className="mt-3 text-slate-600 leading-relaxed dark:text-slate-300">{body}</p>
        <ul className="mt-5 space-y-2.5">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2 text-[14px] text-slate-700 dark:text-slate-300"><Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />{b}</li>
          ))}
        </ul>
      </div>
      <div className={reverse ? 'lg:order-1' : ''}>{visual}</div>
    </div>
  );
}

export default function Showcase() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-20 space-y-20">
      <Row
        eyebrow="Sales CRM" tone="text-primary-700 bg-primary-50"
        title="Close more, guess less"
        body="A drag-and-drop deal pipeline backed by relational companies and people. Every contact, deal, and note connected. No more scattered spreadsheets."
        bullets={['Kanban deal stages with one-drag moves', 'Companies & people linked to every deal', 'Search, filter, and export in a click']}
        visual={<SalesMock />}
      />

      <Row
        reverse
        eyebrow="Finance" tone="text-primary-700 bg-primary-50"
        title="Know your numbers in real time"
        body="Invoices in, expenses out, and a bank ledger that reconciles payments automatically, with a live dashboard of revenue, costs, and net over any period."
        bullets={['Revenue vs costs, month by month', 'Bank transactions auto-matched to invoices', 'Branded PDF invoices, offers & e-invoice export']}
        visual={<FinanceMock />}
      />

      {/* Full-width Marketing band — different layout family, breaks the rhythm */}
      <div>
        <div className="text-center max-w-2xl mx-auto mb-8">
          <h3 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900 dark:text-white">Grow the top of the funnel</h3>
          <p className="mt-3 text-slate-600 leading-relaxed dark:text-slate-300">Plan campaigns, design and get client sign-off on social posts, and see exactly who is visiting. First-party and cookieless: no third-party trackers, no cookie banner.</p>
        </div>
        <MarketingDash />
        <div className="mt-6 grid sm:grid-cols-3 gap-3 max-w-3xl mx-auto">
          {[
            ['Campaigns', 'Budget, spend & leads by channel'],
            ['Post studio', 'Pixel-faithful previews + pinned client comments'],
            ['Web analytics', 'Cookieless visitors, top pages & referrers'],
          ].map((c) => (
            <div key={c[0]} className="rounded-xl bg-white ring-1 ring-slate-200/60 p-3 dark:bg-slate-900 dark:ring-slate-800">
              <div className="text-[13px] font-bold text-slate-800 dark:text-white">{c[0]}</div>
              <div className="text-[12px] text-slate-500 mt-0.5 leading-snug dark:text-slate-400">{c[1]}</div>
            </div>
          ))}
        </div>
      </div>

      <Row
        eyebrow="Recruiting & HR" tone="text-primary-700 bg-primary-50"
        title="Hire better, by skills and personality"
        body="The built-in ATS scores candidates on skills and psychometrics, then moves the shortlist along a drag-and-drop pipeline. Rule-based matching in Postgres, with no per-token AI bill."
        bullets={['Skills + Big-5 personality match scores', 'Drag-and-drop hiring pipeline & interviews', 'Talent Treasury to filter your whole pool']}
        visual={<RecruitingMock />}
      />
    </section>
  );
}
