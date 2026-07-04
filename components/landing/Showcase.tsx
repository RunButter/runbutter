import { Check } from 'lucide-react';
import FinanceChart from '@/components/crm/FinanceChart';
import type { FinanceSeriesPoint } from '@/lib/crm/data';

// Deep-dive feature rows for the landing page. Each row pairs a copy block with a
// static mockup of the REAL module UI (the Finance row even reuses the live
// FinanceChart component) so the marketing matches the product.

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

function RoadmapMock() {
  const months = ['Jun', 'Jul', 'Aug'];
  // hand-placed [leftPct, widthPct] bars + dot positions for a tidy preview
  const lanes = [
    { name: 'Launch', bar: [4, 46], color: '#34d399', dots: [8, 24, 44], dotColors: ['#f59e0b', '#f43f5e', '#f59e0b'] },
    { name: 'Marketing', bar: [12, 56], color: '#34d399', dots: [16, 40, 62], dotColors: ['#f59e0b', '#3b82f6', '#94a3b8'] },
    { name: 'Mobile', bar: [40, 52], color: '#fbbf24', dots: [44, 66, 88], dotColors: ['#3b82f6', '#94a3b8', '#f59e0b'] },
  ];
  return (
    <MockWindow>
      <div className="flex h-6 border-b border-slate-200/70 mb-1">
        <div className="w-20 shrink-0" />
        <div className="flex-1 flex">
          {months.map((m) => <div key={m} className="flex-1 border-l border-slate-100 pl-1.5 text-[10px] font-semibold text-slate-400">{m}</div>)}
        </div>
      </div>
      {lanes.map((l) => (
        <div key={l.name} className="flex items-center h-11 border-b border-slate-100 last:border-0">
          <div className="w-20 shrink-0 text-[11px] font-semibold text-slate-700 truncate pr-2">{l.name}</div>
          <div className="flex-1 relative h-full">
            {months.map((m, i) => <span key={m} className="absolute top-0 h-full w-px bg-slate-100" style={{ left: `${(i / months.length) * 100}%` }} />)}
            <div className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full opacity-70" style={{ left: `${l.bar[0]}%`, width: `${l.bar[1]}%`, background: l.color }} />
            {l.dots.map((d, i) => (
              <span key={i} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full ring-2 ring-white" style={{ left: `${d}%`, background: l.dotColors[i] }} />
            ))}
          </div>
        </div>
      ))}
    </MockWindow>
  );
}

function Row({ reverse, eyebrow, tone, title, body, bullets, visual }: {
  reverse?: boolean; eyebrow: string; tone: string; title: string; body: string; bullets: string[]; visual: React.ReactNode;
}) {
  return (
    <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
      <div className={reverse ? 'lg:order-2' : ''}>
        <div className={`inline-block text-[11px] font-black uppercase tracking-widest mb-3 px-2 py-0.5 rounded-full ${tone}`}>{eyebrow}</div>
        <h3 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900">{title}</h3>
        <p className="mt-3 text-slate-600 leading-relaxed">{body}</p>
        <ul className="mt-5 space-y-2.5">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2 text-[14px] text-slate-700"><Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />{b}</li>
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
        eyebrow="Sales CRM" tone="text-indigo-600 bg-indigo-50"
        title="Close more, guess less"
        body="A drag-and-drop deal pipeline backed by relational companies and people. Every contact, deal, and note connected — no more scattered spreadsheets."
        bullets={['Kanban deal stages with one-drag moves', 'Companies & people linked to every deal', 'Search, filter, and export in a click']}
        visual={<SalesMock />}
      />
      <Row
        reverse
        eyebrow="Finance" tone="text-emerald-600 bg-emerald-50"
        title="Know your numbers in real time"
        body="Invoices in, expenses out, and a bank ledger that reconciles payments automatically — with a live dashboard of revenue, costs, and net over any period."
        bullets={['Revenue vs costs, month by month', 'Bank transactions auto-matched to invoices', 'Branded PDF invoices, offers & e-invoice export']}
        visual={<FinanceMock />}
      />
      <Row
        eyebrow="Projects & Roadmap" tone="text-violet-600 bg-violet-50"
        title="Ship on time, every time"
        body="Plan work on a clean issue board, then zoom out to a roadmap timeline that lays every project and due date on one Gantt-lite view."
        bullets={['Project & issue boards that just work', 'Gantt-lite roadmap across all projects', 'Due dates and priorities at a glance']}
        visual={<RoadmapMock />}
      />
    </section>
  );
}
