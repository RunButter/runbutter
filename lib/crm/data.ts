// Data layer for the new platform shell. Calls the SECURITY DEFINER RPCs from
// migrations 0001–0003 using the Privy pattern (set_config + p_privy_user_id).
// Falls back to mock data whenever the user isn't signed in or the migrations
// haven't been run yet — so the branch always renders, and flips to live data
// automatically once you run the SQL and log in.
import { supabase } from '@/lib/supabase';
import { MOCK_OBJECT_ROWS, mockBoard, MOCK_FINANCE, mockFinanceAnalytics, mockRoadmap, mockInvoiceDocument, MOCK_PROJECTS, MOCK_ISSUES } from './mock';
import type { PipelineKind, PipelineStage, PipelineRecord } from './types';

export interface RecordsResult { rows: any[]; live: boolean }
export interface BoardResult { stages: PipelineStage[]; records: PipelineRecord[]; live: boolean }
export interface FinanceResult { revenue: number; outstanding: number; expenses: number; invoices: number; live: boolean }

async function resolveWorkspace(privyUserId: string): Promise<string | null> {
  await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
  const { data, error } = await supabase.rpc('get_my_workspace', { p_privy: privyUserId });
  if (error || !data) return null;
  return (data as any).id ?? null;
}

export interface WorkspaceContext { id: string; name: string; role: string }
export async function getWorkspace(privyUserId: string): Promise<WorkspaceContext | null> {
  await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
  const { data, error } = await supabase.rpc('get_my_workspace', { p_privy: privyUserId });
  if (error || !data) return null;
  const d = data as any;
  return { id: d.id, name: d.name, role: d.role || 'member' };
}

export async function getMembers(privyUserId: string, workspaceId: string): Promise<any[]> {
  const { data, error } = await supabase.rpc('get_members', { p_privy: privyUserId, p_workspace: workspaceId });
  return error || !Array.isArray(data) ? [] : data;
}

export async function setMemberRole(privyUserId: string, workspaceId: string, accountId: string, role: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('set_member_role', { p_privy: privyUserId, p_workspace: workspaceId, p_account: accountId, p_role: role });
  return error ? { error: error.message } : {};
}

export async function loadRecords(privyUserId: string | null, object: string): Promise<RecordsResult> {
  const fallback: RecordsResult = { rows: MOCK_OBJECT_ROWS[object] || [], live: false };
  if (!privyUserId) return fallback;
  try {
    const ws = await resolveWorkspace(privyUserId);
    if (!ws) return fallback;
    const { data, error } = await supabase.rpc('list_records', { p_privy: privyUserId, p_workspace: ws, p_object: object });
    if (error || !Array.isArray(data)) return fallback;
    return { rows: data, live: true };   // even an empty live result is "live"
  } catch {
    return fallback;
  }
}

// ── CRUD ────────────────────────────────────────────────────────────────────
export async function getRecord(privyUserId: string, object: string, id: string): Promise<any | null> {
  await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
  const { data, error } = await supabase.rpc('get_record', { p_privy: privyUserId, p_object: object, p_id: id });
  if (error) return null;
  return data;
}

export async function createRecord(privyUserId: string, object: string, values: Record<string, any>): Promise<{ id?: string; error?: string }> {
  const ws = await resolveWorkspace(privyUserId);
  if (!ws) return { error: 'No workspace found for your account.' };
  const { data, error } = await supabase.rpc('create_record', { p_privy: privyUserId, p_workspace: ws, p_object: object, p_data: values });
  if (error) return { error: error.message };
  return { id: data as string };
}

export async function updateRecord(privyUserId: string, object: string, id: string, values: Record<string, any>): Promise<{ error?: string }> {
  await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
  const { error } = await supabase.rpc('update_record', { p_privy: privyUserId, p_object: object, p_id: id, p_data: values });
  return error ? { error: error.message } : {};
}

export async function deleteRecord(privyUserId: string, object: string, id: string): Promise<{ error?: string }> {
  await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
  const { error } = await supabase.rpc('delete_record', { p_privy: privyUserId, p_object: object, p_id: id });
  return error ? { error: error.message } : {};
}

export async function importRecords(privyUserId: string, object: string, rows: Record<string, any>[]): Promise<{ count?: number; error?: string }> {
  const ws = await resolveWorkspace(privyUserId);
  if (!ws) return { error: 'No workspace found for your account.' };
  const { data, error } = await supabase.rpc('import_records', { p_privy: privyUserId, p_workspace: ws, p_object: object, p_rows: rows });
  if (error) return { error: error.message };
  return { count: data as number };
}

// Fetch a public CSV URL (e.g. a published Google Sheet) via our server route.
export async function fetchSheetCsv(url: string): Promise<{ text?: string; error?: string }> {
  try {
    const res = await fetch('/api/crm/fetch-csv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Fetch failed' };
    return { text: data.text };
  } catch (e: any) {
    return { error: e?.message || 'Fetch failed' };
  }
}

export async function loadFinance(privyUserId: string | null): Promise<FinanceResult> {
  const fallback: FinanceResult = { ...MOCK_FINANCE, live: false };
  if (!privyUserId) return fallback;
  try {
    const ws = await resolveWorkspace(privyUserId);
    if (!ws) return fallback;
    const { data, error } = await supabase.rpc('get_finance_summary', { p_privy: privyUserId, p_workspace: ws });
    if (error || !data) return fallback;
    const d = data as any;
    return { revenue: +d.revenue || 0, outstanding: +d.outstanding || 0, expenses: +d.expenses || 0, invoices: +d.invoices || 0, live: true };
  } catch {
    return fallback;
  }
}

// ── Finance analytics (dashboard) ─────────────────────────────────────────────
export interface FinanceSeriesPoint { month: string; label: string; revenue: number; costs: number }
export interface FinanceAnalytics {
  revenue: number; costs: number; net: number; outstanding: number; margin: number;
  series: FinanceSeriesPoint[]; live: boolean;
}

export async function loadFinanceAnalytics(privyUserId: string | null, months: number): Promise<FinanceAnalytics> {
  const fallback = (): FinanceAnalytics => ({ ...mockFinanceAnalytics(months), live: false });
  if (!privyUserId) return fallback();
  try {
    const ws = await resolveWorkspace(privyUserId);
    if (!ws) return fallback();
    const { data, error } = await supabase.rpc('get_finance_analytics', { p_privy: privyUserId, p_workspace: ws, p_months: months });
    if (error || !data) return fallback();
    const d = data as any;
    return {
      revenue: +d.revenue || 0,
      costs: +d.costs || 0,
      net: +d.net || 0,
      outstanding: +d.outstanding || 0,
      margin: +d.margin || 0,
      series: Array.isArray(d.series)
        ? d.series.map((p: any) => ({ month: p.month, label: p.label, revenue: +p.revenue || 0, costs: +p.costs || 0 }))
        : [],
      live: true,
    };
  } catch {
    return fallback();
  }
}

// ── Roadmap (Gantt-lite timeline over projects + issue due dates) ─────────────
export interface RoadmapIssue { id: string; title: string; status: string; priority: string; due_date: string | null }
export interface RoadmapProject { id: string; name: string; identifier: string | null; status: string; issues: RoadmapIssue[] }

export async function loadRoadmap(privyUserId: string | null): Promise<{ projects: RoadmapProject[]; live: boolean }> {
  const fallback = () => ({ projects: mockRoadmap() as RoadmapProject[], live: false });
  if (!privyUserId) return fallback();
  try {
    const ws = await resolveWorkspace(privyUserId);
    if (!ws) return fallback();
    const { data, error } = await supabase.rpc('get_roadmap', { p_privy: privyUserId, p_workspace: ws });
    if (error || !Array.isArray(data)) return fallback();
    return { projects: data as RoadmapProject[], live: true };
  } catch {
    return fallback();
  }
}

// Plane-style issue board: fixed workflow states, issues grouped by status.
// Reuses loadRecords('issues') + the same kanban engine as deals/hiring.
const ISSUE_STAGES: PipelineStage[] = [
  { id: 'backlog', name: 'Backlog', color: '#94a3b8', stage_type: 'open' },
  { id: 'todo', name: 'Todo', color: '#60a5fa', stage_type: 'open' },
  { id: 'in_progress', name: 'In Progress', color: '#a78bfa', stage_type: 'open' },
  { id: 'done', name: 'Done', color: '#34d399', stage_type: 'won' },
  { id: 'cancelled', name: 'Cancelled', color: '#f87171', stage_type: 'lost' },
];

export async function loadIssueBoard(privyUserId: string | null): Promise<BoardResult> {
  const { rows, live } = await loadRecords(privyUserId, 'issues');
  const records: PipelineRecord[] = rows.map((r: any) => ({
    id: r.id,
    stage_id: r.status,
    title: r.name || r.title,
    status: 'active',
    position: 0,
    // Card headline = issue title; sub-line = assignee (the board renders person.name + person.title).
    person: { id: r.id, name: r.name || r.title, title: r.assignee || undefined },
  }));
  return { stages: ISSUE_STAGES, records, live };
}

// One project's dashboard: the project + its issues mapped onto the issue board.
export async function loadProject(privyUserId: string | null, projectId: string): Promise<{ project: any; stages: PipelineStage[]; records: PipelineRecord[]; live: boolean }> {
  const toRecords = (issues: any[]): PipelineRecord[] => issues.map((r: any) => ({
    id: r.id, stage_id: r.status, title: r.title || r.name, status: 'active', position: 0,
    person: { id: r.id, name: r.title || r.name, title: r.assignee || undefined },
  }));
  const mock = () => ({ project: MOCK_PROJECTS.find((x) => x.id === projectId) || MOCK_PROJECTS[0], stages: ISSUE_STAGES, records: toRecords(MOCK_ISSUES), live: false });
  if (!privyUserId) return mock();
  try {
    await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
    const { data, error } = await supabase.rpc('get_project', { p_privy: privyUserId, p_project: projectId });
    if (error || !data) return mock();
    const d = data as any;
    return { project: d.project || {}, stages: ISSUE_STAGES, records: toRecords(d.issues || []), live: true };
  } catch {
    return mock();
  }
}

// ── Invoice/offer documents (line items + printable PDF) ──────────────────────
export interface InvoiceLineItem { description: string; product?: string | null; product_id?: string | null; quantity: number; unit_price: number; line_total: number }
export interface InvoiceDocument {
  id: string; number: string | null; kind: string; direction: string; status: string;
  currency: string; amount: number; category?: string | null;
  issued_at: string | null; due_at: string | null; notes: string | null;
  seller: { name: string; logo_url?: string | null; accent_color?: string; address?: string | null; footer?: string | null };
  buyer: { name: string; domain?: string; industry?: string } | null;
  items: InvoiceLineItem[]; live: boolean;
}

// ── Workspace branding (logo, accent, footer for documents) ───────────────────
export interface WorkspaceBranding {
  name: string; logo_url: string | null; legal_name: string | null;
  address: string | null; accent_color: string; invoice_footer: string | null;
}
export async function loadBranding(privyUserId: string, workspaceId: string): Promise<WorkspaceBranding | null> {
  const { data, error } = await supabase.rpc('get_workspace_branding', { p_privy: privyUserId, p_workspace: workspaceId });
  if (error || !data) return null;
  const d = data as any;
  return { name: d.name, logo_url: d.logo_url, legal_name: d.legal_name, address: d.address, accent_color: d.accent_color || '#6366F1', invoice_footer: d.invoice_footer };
}
export async function saveBranding(privyUserId: string, workspaceId: string, data: Partial<WorkspaceBranding>): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('save_workspace_branding', { p_privy: privyUserId, p_workspace: workspaceId, p_data: data });
  return error ? { error: error.message } : {};
}

export async function loadInvoiceDocument(privyUserId: string | null, id: string): Promise<InvoiceDocument> {
  const fallback = (): InvoiceDocument => ({ ...(mockInvoiceDocument(id) as any), live: false });
  if (!privyUserId) return fallback();
  try {
    await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
    const { data, error } = await supabase.rpc('get_invoice_document', { p_privy: privyUserId, p_id: id });
    if (error || !data) return fallback();
    const d = data as any;
    return {
      id: d.id, number: d.number, kind: d.kind || 'invoice', direction: d.direction || 'income',
      status: d.status, currency: d.currency || 'USD', amount: +d.amount || 0, category: d.category,
      issued_at: d.issued_at, due_at: d.due_at, notes: d.notes,
      seller: d.seller || { name: 'Your company' },
      buyer: d.buyer || null,
      items: Array.isArray(d.items)
        ? d.items.map((it: any) => ({ description: it.description, product: it.product, product_id: it.product_id, quantity: +it.quantity || 0, unit_price: +it.unit_price || 0, line_total: +it.line_total || 0 }))
        : [],
      live: true,
    };
  } catch {
    return fallback();
  }
}

export interface ItemInput { product_id?: string; description?: string; quantity: number; unit_price: number }
export async function saveInvoiceItems(privyUserId: string, invoiceId: string, items: ItemInput[]): Promise<{ total?: number; error?: string }> {
  await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
  const { data, error } = await supabase.rpc('save_invoice_items', { p_privy: privyUserId, p_invoice: invoiceId, p_items: items });
  if (error) return { error: error.message };
  return { total: +(data as any) || 0 };
}

export async function loadBoard(privyUserId: string | null, slug: string, kind: PipelineKind): Promise<BoardResult> {
  const m = mockBoard(slug);
  const fallback: BoardResult = { stages: m.stages, records: m.records, live: false };
  if (!privyUserId) return fallback;
  try {
    const ws = await resolveWorkspace(privyUserId);
    if (!ws) return fallback;
    const { data: pipelineId, error: pErr } = await supabase.rpc('get_pipeline_by_kind', { p_privy: privyUserId, p_workspace: ws, p_kind: kind });
    if (pErr || !pipelineId) return fallback;
    const { data, error } = await supabase.rpc('get_pipeline_board', { p_privy: privyUserId, p_pipeline: pipelineId });
    if (error || !data) return fallback;
    return { stages: (data as any).stages || [], records: (data as any).records || [], live: true };
  } catch {
    return fallback;
  }
}
