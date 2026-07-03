// Mock data so the new CRM shell renders standalone before workspace/auth wiring.
// Replaced by SECURITY DEFINER RPC calls (get_pipeline_board, search_people, ...).
import type { Person, Company, Asset, PipelineStage, PipelineRecord, PipelineConfig } from './types';

export const MOCK_PEOPLE: Person[] = [
  { id: 'p1', first_name: 'Anna', last_name: 'Kowalski', email: 'anna.k@northwind.io', title: 'Senior Engineer', company: 'Northwind', source: 'LinkedIn', synergy: 92, avatar_url: null },
  { id: 'p2', first_name: 'David', last_name: 'Reyes', email: 'david@lumen.dev', title: 'Sales Lead', company: 'Lumen', source: 'Referral', synergy: 87, avatar_url: null },
  { id: 'p3', first_name: 'Sara', last_name: 'Lindqvist', email: 'sara.l@pulse.app', title: 'Product Designer', company: 'Pulse', source: 'Inbound', synergy: 81, avatar_url: null },
  { id: 'p4', first_name: 'Marcus', last_name: 'Obi', email: 'marcus@vertex.co', title: 'Data Scientist', company: 'Vertex', source: 'Indeed', synergy: 74, avatar_url: null },
  { id: 'p5', first_name: 'Lena', last_name: 'Fischer', email: 'lena@cobalt.io', title: 'Account Exec', company: 'Cobalt', source: 'Outbound', synergy: 68, avatar_url: null },
];

export const MOCK_COMPANIES: Company[] = [
  { id: 'c1', name: 'Northwind', domain: 'northwind.io', industry: 'SaaS', employee_count: 120, tax_id: 'PL5260250274' },
  { id: 'c2', name: 'Lumen', domain: 'lumen.dev', industry: 'DevTools', employee_count: 45, tax_id: 'DE811569869' },
  { id: 'c3', name: 'Pulse', domain: 'pulse.app', industry: 'Health', employee_count: 210, tax_id: 'NL004495445B01' },
  { id: 'c4', name: 'Vertex', domain: 'vertex.co', industry: 'Fintech', employee_count: 80, tax_id: 'FR40303265045' },
];

export const MOCK_ASSETS: Asset[] = [
  { id: 'a1', name: 'MacBook Pro 16"', category: 'laptop', serial_number: 'C02XL0', status: 'assigned', assigned_to: 'Anna Kowalski' },
  { id: 'a2', name: 'Dell U2723QE', category: 'monitor', serial_number: 'DLL-9921', status: 'available', assigned_to: null },
  { id: 'a3', name: 'iPhone 15', category: 'phone', serial_number: 'IP-44120', status: 'assigned', assigned_to: 'David Reyes' },
  { id: 'a4', name: 'Figma Org seat', category: 'license', serial_number: 'FIG-ORG', status: 'assigned', assigned_to: 'Sara Lindqvist' },
];

export const MOCK_INVOICES = [
  { id: 'i1', number: 'INV-1001', company: 'Northwind Labs', direction: 'income', category: 'Services', amount: 24000, status: 'paid', due_at: '2026-06-01' },
  { id: 'i2', number: 'INV-1002', company: 'Lumen Devtools', direction: 'income', category: 'Subscription', amount: 12000, status: 'sent', due_at: '2026-06-20' },
  { id: 'i3', number: 'INV-1003', company: 'Vertex Finance', direction: 'income', category: 'Services', amount: 36000, status: 'overdue', due_at: '2026-05-28' },
  { id: 'i4', number: 'BILL-2001', company: 'AWS', direction: 'cost', category: 'Software', amount: 4200, status: 'paid', due_at: '2026-06-12' },
];

// A fully-populated invoice/offer document for the printable PDF view (sample mode).
export function mockInvoiceDocument(id: string) {
  const isOffer = id.includes('offer') || id.startsWith('of');
  return {
    id, number: isOffer ? 'OFF-1042' : 'INV-1001', kind: isOffer ? 'offer' : 'invoice',
    direction: 'income', status: 'sent', currency: 'USD',
    category: 'Services', issued_at: '2026-06-01', due_at: '2026-06-15', amount: 5535,
    notes: isOffer
      ? 'This proposal is valid for 30 days. We look forward to working together.'
      : 'Thank you for your business. Payment is due within 14 days via bank transfer.',
    seller: {
      name: 'HireBTR Inc.', accent_color: '#6366F1', tax_id: '5260250274', country: 'PL',
      vat_id: 'PL5260250274', reg_no: 'KRS 0000123456', bdo: '000012345',
      iban: 'PL61 1090 1014 0000 0712 1981 2874', bank_name: 'ACME Bank',
      address: '500 Howard St, San Francisco, CA 94105',
      footer: 'Payment within 14 days of the issue date.',
      logo_url: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' rx='16' fill='%236366F1'/><text x='40' y='54' font-size='42' fill='white' text-anchor='middle' font-family='sans-serif' font-weight='bold'>H</text></svg>",
    },
    buyer: { name: 'Northwind Labs', domain: 'northwind.io', industry: 'SaaS', tax_id: 'PL1132986470', address: 'ul. Testowa 1, 00-001 Warszawa', country: 'PL' },
    items: [
      { description: 'Bus cover — PVC reinforced (m²)', product: 'Bus cover', image: sq('6366F1'), quantity: 48, unit_price: 62, discount_pct: 0, tax_rate: 23, line_total: 2976 },
      { description: 'Custom tarpaulin fitting', product: 'Tarpaulin', image: sq('10B981'), quantity: 6, unit_price: 140, discount_pct: 0, tax_rate: 23, line_total: 840 },
      { description: 'On-site installation (hour)', product: 'Installation', image: sq('F59E0B'), quantity: 8, unit_price: 95, discount_pct: 10, tax_rate: 23, line_total: 684 },
    ],
    totals: { subtotal: 4576, discount: 76, net: 4500, tax: 1035, total: 5535 },
  };
}

export const MOCK_EXPENSES = [
  { id: 'e1', vendor: 'AWS', category: 'software', amount: 2400, status: 'paid', spent_at: '2026-06-10' },
  { id: 'e2', vendor: 'WeWork', category: 'office', amount: 3200, status: 'approved', spent_at: '2026-06-03' },
  { id: 'e3', vendor: 'Payroll', category: 'payroll', amount: 48000, status: 'paid', spent_at: '2026-06-14' },
];

export const MOCK_FINANCE = { revenue: 24000, outstanding: 48000, expenses: 53600, invoices: 3 };

// Deterministic sample analytics (no Math.random — stable across renders) so the
// Finance dashboard looks alive before the get_finance_analytics RPC is wired.
export interface MockFinanceSeriesPoint { month: string; label: string; revenue: number; costs: number }
export function mockFinanceAnalytics(months: number) {
  const n = Math.max(1, Math.min(months, 36));
  const now = new Date();
  const series: MockFinanceSeriesPoint[] = [];
  let revenue = 0, costs = 0;
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const trend = (n - i) * 1300;                          // gentle growth over time
    const wobble = Math.round(Math.sin(i * 1.1) * 5200);   // seasonal-ish wobble
    const r = Math.max(7000, 17000 + trend + wobble);
    const c = Math.round(r * (0.52 + ((i % 5) * 0.05)));   // costs 52–72% of revenue
    revenue += r; costs += c;
    series.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('en', { month: 'short' }),
      revenue: r, costs: c,
    });
  }
  const net = revenue - costs;
  return { revenue, costs, net, outstanding: 48000, margin: revenue > 0 ? Math.round((net / revenue) * 100) : 0, series };
}

export const MOCK_PROJECTS = [
  { id: 'pr1', name: 'Platform Launch', identifier: 'LAUNCH', status: 'active', issues: 6 },
  { id: 'pr2', name: 'Mobile App', identifier: 'MOBILE', status: 'paused', issues: 3 },
];

export const MOCK_ISSUES = [
  { id: 'is1', name: 'Design landing page', project: 'Platform Launch', status: 'in_progress', priority: 'high', due_date: '2026-06-20', assignee: 'Anna K.' },
  { id: 'is2', name: 'Wire Stripe billing', project: 'Platform Launch', status: 'todo', priority: 'urgent', due_date: '2026-06-22', assignee: 'David R.' },
  { id: 'is3', name: 'Set up CI/CD pipeline', project: 'Platform Launch', status: 'done', priority: 'medium', due_date: '2026-06-10', assignee: 'Sara L.' },
  { id: 'is4', name: 'Write API documentation', project: 'Platform Launch', status: 'backlog', priority: 'low', due_date: null, assignee: null },
  { id: 'is5', name: 'Run customer interviews', project: 'Platform Launch', status: 'todo', priority: 'medium', due_date: '2026-06-25', assignee: 'Lena F.' },
  { id: 'is6', name: 'Launch on Product Hunt', project: 'Platform Launch', status: 'backlog', priority: 'high', due_date: null, assignee: null },
];

// Roadmap demo data: projects with dated issues so the timeline looks alive in
// Sample mode. Spans ~3 months so the Gantt-lite has something to lay out.
export interface MockRoadmapIssue { id: string; title: string; status: string; priority: string; due_date: string | null }
export interface MockRoadmapProject { id: string; name: string; identifier: string; status: string; issues: MockRoadmapIssue[] }
export const MOCK_ROADMAP: MockRoadmapProject[] = [
  { id: 'pr1', name: 'Platform Launch', identifier: 'LAUNCH', status: 'active', issues: [
    { id: 'is3', title: 'Set up CI/CD pipeline', status: 'done', priority: 'medium', due_date: '2026-06-18' },
    { id: 'is1', title: 'Design landing page', status: 'in_progress', priority: 'high', due_date: '2026-06-28' },
    { id: 'is2', title: 'Wire Stripe billing', status: 'todo', priority: 'urgent', due_date: '2026-07-10' },
    { id: 'is6', title: 'Launch on Product Hunt', status: 'backlog', priority: 'high', due_date: '2026-07-28' },
  ]},
  { id: 'pr3', name: 'Q3 Marketing Site', identifier: 'MKT', status: 'active', issues: [
    { id: 'k1', title: 'Rewrite pricing page', status: 'in_progress', priority: 'high', due_date: '2026-07-02' },
    { id: 'k2', title: 'Customer case studies', status: 'todo', priority: 'medium', due_date: '2026-08-01' },
    { id: 'k3', title: 'SEO content pass', status: 'backlog', priority: 'low', due_date: null },
  ]},
  { id: 'pr2', name: 'Mobile App', identifier: 'MOBILE', status: 'paused', issues: [
    { id: 'm1', title: 'React Native shell', status: 'todo', priority: 'medium', due_date: '2026-07-15' },
    { id: 'm2', title: 'Push notifications', status: 'backlog', priority: 'low', due_date: '2026-08-20' },
    { id: 'm3', title: 'App Store submission', status: 'backlog', priority: 'high', due_date: '2026-09-05' },
  ]},
];
export function mockRoadmap() { return MOCK_ROADMAP; }

const sq = (c: string) => `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' rx='12' fill='%23${c}'/></svg>`;

export const MOCK_PRODUCTS = [
  { id: 'pd1', name: 'Bus cover — PVC reinforced', sku: 'COV-PVC', category: 'Covers', unit_price: 62, unit: 'm²', image: sq('6366F1') },
  { id: 'pd2', name: 'Custom tarpaulin', sku: 'TARP-CST', category: 'Covers', unit_price: 140, unit: 'piece', image: sq('10B981') },
  { id: 'pd3', name: 'On-site installation', sku: 'SVC-INST', category: 'Services', unit_price: 95, unit: 'hour', image: sq('F59E0B') },
];

export const MOCK_OFFERS = [
  { id: 'of1', number: 'OFF-1042', company: 'Northwind Labs', category: 'Covers', amount: 5535, status: 'sent', due_at: '2026-07-15' },
  { id: 'of2', number: 'OFF-1043', company: 'Vertex Finance', category: 'Services', amount: 12800, status: 'accepted', due_at: '2026-07-01' },
  { id: 'of3', number: 'OFF-1041', company: 'Lumen Devtools', category: 'Covers', amount: 3200, status: 'declined', due_at: '2026-06-20' },
];

export const MOCK_CAMPAIGNS = [
  { id: 'cp1', name: 'Q3 LinkedIn ads', channel: 'ads', status: 'active', budget: 6000, spend: 2140, leads: 38, starts_on: '2026-07-01', ends_on: '2026-09-30' },
  { id: 'cp2', name: 'Summer newsletter', channel: 'email', status: 'active', budget: 800, spend: 320, leads: 54, starts_on: '2026-06-15', ends_on: '2026-08-15' },
  { id: 'cp3', name: 'Trade fair — Poznań', channel: 'event', status: 'planned', budget: 12000, spend: 0, leads: 0, starts_on: '2026-09-10', ends_on: '2026-09-12' },
  { id: 'cp4', name: 'SEO content sprint', channel: 'content', status: 'completed', budget: 3000, spend: 2950, leads: 21, starts_on: '2026-04-01', ends_on: '2026-05-31' },
];

// Deterministic sample traffic for the web-analytics dashboard (Sample mode).
export function mockSiteStats(days: number) {
  const n = Math.max(1, Math.min(days, 90));
  const series = Array.from({ length: n }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (n - 1 - i));
    const wave = Math.round(120 + 60 * Math.sin(i / 3) + (i % 7 < 5 ? 40 : -30)); // weekday bump
    return {
      day: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' }),
      pageviews: Math.max(20, wave),
      visitors: Math.max(10, Math.round(wave * 0.62)),
    };
  });
  const pv = series.reduce((s, p) => s + p.pageviews, 0);
  return {
    pageviews: pv,
    visitors: series.reduce((s, p) => s + p.visitors, 0),
    live: 7,
    desktop: Math.round(pv * 0.58),
    mobile: pv - Math.round(pv * 0.58),
    series,
    top_pages: [
      { path: '/', count: 1840 }, { path: '/pricing', count: 920 }, { path: '/blog/bus-covers-guide', count: 610 },
      { path: '/contact', count: 340 }, { path: '/products', count: 280 },
    ],
    top_referrers: [
      { ref: 'google.com', count: 1460 }, { ref: 'direct', count: 980 }, { ref: 'linkedin.com', count: 420 },
      { ref: 'facebook.com', count: 210 }, { ref: 'bing.com', count: 90 },
    ],
  };
}

// Social post studio samples (PreFeed port).
const POST_IMG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'><rect width='600' height='600' fill='%236366F1'/><rect x='60' y='180' width='480' height='240' rx='24' fill='%23818CF8'/><rect x='120' y='240' width='360' height='120' rx='16' fill='%23C7D2FE'/><text x='300' y='520' font-size='34' fill='white' text-anchor='middle' font-family='sans-serif' font-weight='bold'>New PVC bus covers</text></svg>";

export const MOCK_POSTS = [
  { id: 'p1', platform: 'instagram', handle: '@buscovers_pl', content: 'Nowa kolekcja pokrowców PVC już dostępna! 🚌 Odporne na UV i deszcz. #buscovers #pvc', image_url: POST_IMG, status: 'in_review', comment_count: 2 },
  { id: 'p2', platform: 'linkedin', handle: 'BusCovers PL', content: 'We just shipped custom-fit covers for a fleet of 40 city buses — cutting weather damage costs by 60%. Case study in comments.', image_url: POST_IMG, status: 'draft', comment_count: 0 },
  { id: 'p3', platform: 'x', handle: '@buscovers_pl', content: 'Fleet managers: weather damage is eating your budget. Custom PVC covers pay for themselves in one season. 🧵', image_url: null, status: 'approved', comment_count: 1 },
];

export function mockPostDetail(id: string) {
  const base = MOCK_POSTS.find((p) => p.id === id) || MOCK_POSTS[0];
  return {
    ...base,
    share_token: 'sample',
    comments: [
      { id: 'pc1', author: 'Kasia (Client)', body: 'Logo powinno być większe — ledwo widać na mobile.', x: 28, y: 42, resolved: false, created_at: '2026-07-01T10:00:00Z' },
      { id: 'pc2', author: 'Marek', body: 'Dodajmy cenę promocyjną do caption?', x: 55, y: 78, resolved: false, created_at: '2026-07-01T11:30:00Z' },
      { id: 'pc3', author: 'Ola', body: 'Hashtagi OK, zatwierdzam.', x: null, y: null, resolved: true, created_at: '2026-06-30T09:00:00Z' },
    ],
  };
}

export const MOCK_OBJECT_ROWS: Record<string, any[]> = {
  people: MOCK_PEOPLE.map((p) => ({ ...p, name: `${p.first_name} ${p.last_name}` })),
  companies: MOCK_COMPANIES,
  invoices: MOCK_INVOICES,
  offers: MOCK_OFFERS,
  expenses: MOCK_EXPENSES,
  products: MOCK_PRODUCTS,
  campaigns: MOCK_CAMPAIGNS,
  projects: MOCK_PROJECTS,
  issues: MOCK_ISSUES,
  assets: MOCK_ASSETS,
};

export const MOCK_PIPELINES: Record<string, PipelineConfig> = {
  sales: { id: 'sales', name: 'Sales', kind: 'sales', target: 'company' },
  recruitment: { id: 'recruitment', name: 'Recruitment', kind: 'recruitment', target: 'person' },
  onboarding: { id: 'onboarding', name: 'Onboarding', kind: 'hris', target: 'person' },
};

const STAGES: Record<string, PipelineStage[]> = {
  sales: [
    { id: 's-lead', name: 'Lead', color: '#94a3b8', stage_type: 'open' },
    { id: 's-disc', name: 'Discovery', color: '#60a5fa', stage_type: 'open' },
    { id: 's-prop', name: 'Proposal', color: '#a78bfa', stage_type: 'open' },
    { id: 's-won', name: 'Closed Won', color: '#34d399', stage_type: 'won' },
  ],
  recruitment: [
    { id: 'r-app', name: 'Applicant', color: '#94a3b8', stage_type: 'open' },
    { id: 'r-ass', name: 'Assessment', color: '#60a5fa', stage_type: 'open' },
    { id: 'r-int', name: 'Interview', color: '#a78bfa', stage_type: 'open' },
    { id: 'r-off', name: 'Offered', color: '#fbbf24', stage_type: 'open' },
    { id: 'r-hir', name: 'Hired', color: '#34d399', stage_type: 'won' },
  ],
  onboarding: [
    { id: 'o-pre', name: 'Pre-boarding', color: '#94a3b8', stage_type: 'open' },
    { id: 'o-on', name: 'Onboarding', color: '#60a5fa', stage_type: 'open' },
    { id: 'o-active', name: 'Active', color: '#34d399', stage_type: 'won' },
  ],
};

const RECORDS: Record<string, PipelineRecord[]> = {
  sales: [
    { id: 'd1', stage_id: 's-lead', title: 'Northwind — Platform', amount: 24000, status: 'active', position: 0, company: { id: 'c1', name: 'Northwind', domain: 'northwind.io' } },
    { id: 'd2', stage_id: 's-disc', title: 'Lumen — Seats x40', amount: 12000, status: 'active', position: 0, company: { id: 'c2', name: 'Lumen', domain: 'lumen.dev' } },
    { id: 'd3', stage_id: 's-prop', title: 'Vertex — Enterprise', amount: 60000, status: 'active', position: 0, company: { id: 'c4', name: 'Vertex', domain: 'vertex.co' } },
    { id: 'd4', stage_id: 's-won', title: 'Pulse — Annual', amount: 36000, status: 'won', position: 0, company: { id: 'c3', name: 'Pulse', domain: 'pulse.app' } },
  ],
  recruitment: [
    { id: 'rr1', stage_id: 'r-app', title: 'Anna Kowalski', status: 'active', position: 0, person: { id: 'p1', name: 'Anna Kowalski', title: 'Senior Engineer' } },
    { id: 'rr2', stage_id: 'r-ass', title: 'Marcus Obi', status: 'active', position: 0, person: { id: 'p4', name: 'Marcus Obi', title: 'Data Scientist' } },
    { id: 'rr3', stage_id: 'r-int', title: 'Sara Lindqvist', status: 'active', position: 0, person: { id: 'p3', name: 'Sara Lindqvist', title: 'Product Designer' } },
    { id: 'rr4', stage_id: 'r-hir', title: 'David Reyes', status: 'won', position: 0, person: { id: 'p2', name: 'David Reyes', title: 'Sales Lead' } },
  ],
  onboarding: [
    { id: 'on1', stage_id: 'o-pre', title: 'David Reyes', status: 'active', position: 0, person: { id: 'p2', name: 'David Reyes', title: 'Sales Lead' } },
    { id: 'on2', stage_id: 'o-active', title: 'Anna Kowalski', status: 'won', position: 0, person: { id: 'p1', name: 'Anna Kowalski', title: 'Senior Engineer' } },
  ],
};

export function mockBoard(pipelineId: string): { stages: PipelineStage[]; records: PipelineRecord[] } {
  return { stages: STAGES[pipelineId] || [], records: RECORDS[pipelineId] || [] };
}
