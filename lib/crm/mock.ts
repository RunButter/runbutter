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
  { id: 'c1', name: 'Northwind', domain: 'northwind.io', industry: 'SaaS', employee_count: 120 },
  { id: 'c2', name: 'Lumen', domain: 'lumen.dev', industry: 'DevTools', employee_count: 45 },
  { id: 'c3', name: 'Pulse', domain: 'pulse.app', industry: 'Health', employee_count: 210 },
  { id: 'c4', name: 'Vertex', domain: 'vertex.co', industry: 'Fintech', employee_count: 80 },
];

export const MOCK_ASSETS: Asset[] = [
  { id: 'a1', name: 'MacBook Pro 16"', category: 'laptop', serial_number: 'C02XL0', status: 'assigned', assigned_to: 'Anna Kowalski' },
  { id: 'a2', name: 'Dell U2723QE', category: 'monitor', serial_number: 'DLL-9921', status: 'available', assigned_to: null },
  { id: 'a3', name: 'iPhone 15', category: 'phone', serial_number: 'IP-44120', status: 'assigned', assigned_to: 'David Reyes' },
  { id: 'a4', name: 'Figma Org seat', category: 'license', serial_number: 'FIG-ORG', status: 'assigned', assigned_to: 'Sara Lindqvist' },
];

export const MOCK_OBJECT_ROWS: Record<string, any[]> = {
  people: MOCK_PEOPLE.map((p) => ({ ...p, name: `${p.first_name} ${p.last_name}` })),
  companies: MOCK_COMPANIES,
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
