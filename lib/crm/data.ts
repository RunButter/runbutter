// Data layer for the new platform shell. Calls the SECURITY DEFINER RPCs from
// migrations 0001–0003 using the Privy pattern (set_config + p_privy_user_id).
// Falls back to mock data whenever the user isn't signed in or the migrations
// haven't been run yet — so the branch always renders, and flips to live data
// automatically once you run the SQL and log in.
import { supabase } from '@/lib/supabase';
import { MOCK_OBJECT_ROWS, mockBoard, MOCK_FINANCE, mockFinanceAnalytics, mockRoadmap, mockInvoiceDocument, mockSiteStats, MOCK_POSTS, mockPostDetail, MOCK_PROJECTS, MOCK_ISSUES, mockBankAccounts, mockLedger } from './mock';
import type { PipelineKind, PipelineStage, PipelineRecord } from './types';
import { rpc } from '@/lib/rpc';

export interface RecordsResult { rows: any[]; live: boolean }
export interface BoardResult { stages: PipelineStage[]; records: PipelineRecord[]; live: boolean }
export interface FinanceResult { revenue: number; outstanding: number; expenses: number; invoices: number; live: boolean }

async function resolveWorkspace(privyUserId: string): Promise<string | null> {
  await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
  const { data, error } = await rpc('get_my_workspace', { p_privy: privyUserId });
  if (error || !data) return null;
  return (data as any).id ?? null;
}

export interface WorkspaceContext { id: string; name: string; role: string }
// Sidebar unread badges: count of NEW records per tab since the client's
// per-tab last-seen timestamps (a { slug: ISO } map). Best-effort — returns {}
// on any error so the nav never breaks.
export async function loadNavActivity(privyUserId: string | null, since: Record<string, string>): Promise<Record<string, number>> {
  if (!privyUserId) return {};
  try {
    const { data, error } = await rpc('get_nav_activity', { p_privy: privyUserId, p_since: since });
    if (error || !data || typeof data !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(data as any)) out[k] = +(v as any) || 0;
    return out;
  } catch {
    return {};
  }
}

export async function getWorkspace(privyUserId: string): Promise<WorkspaceContext | null> {
  await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
  const { data, error } = await rpc('get_my_workspace', { p_privy: privyUserId });
  if (error || !data) return null;
  const d = data as any;
  return { id: d.id, name: d.name, role: d.role || 'member' };
}

export async function getMembers(privyUserId: string, workspaceId: string): Promise<any[]> {
  const { data, error } = await rpc('get_members', { p_privy: privyUserId, p_workspace: workspaceId });
  return error || !Array.isArray(data) ? [] : data;
}

export async function setMemberRole(privyUserId: string, workspaceId: string, accountId: string, role: string): Promise<{ error?: string }> {
  const { error } = await rpc('set_member_role', { p_privy: privyUserId, p_workspace: workspaceId, p_account: accountId, p_role: role });
  return error ? { error: error.message } : {};
}

export interface WorkspaceOption { id: string; name: string; slug: string; plan: string; role: string; active: boolean }

// Every workspace this person belongs to. Usually one; more once they've
// accepted an invite to someone else's.
export async function listMyWorkspaces(privyUserId: string | null): Promise<WorkspaceOption[]> {
  if (!privyUserId) return [];
  const { data } = await rpc('list_my_workspaces', { p_privy: privyUserId });
  return Array.isArray(data) ? data : [];
}

// Persists which workspace this person is working in. Both resolvers
// (get_my_workspace and hr_company_id) read it, so CRM and HR can't drift apart.
export async function setActiveWorkspace(privyUserId: string, workspaceId: string): Promise<{ error?: string }> {
  const { data, error } = await rpc('set_active_workspace', { p_privy: privyUserId, p_workspace: workspaceId });
  if (error) return { error: error.message };
  if (data !== true) return { error: 'You are not a member of that workspace.' };
  return {};
}

// Invites someone to the caller's workspace. Sends only name/email/role — the
// inviter and their company are resolved server-side from the verified Privy
// token, so the caller cannot invite into a workspace they don't belong to.
export async function inviteMember(fullName: string, email: string, role: string): Promise<{ error?: string }> {
  try {
    const { getAccessToken } = await import('@privy-io/react-auth');
    const token = await getAccessToken().catch(() => null);
    const res = await fetch('/api/team/invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
      body: JSON.stringify({ fullName: fullName.trim(), email: email.toLowerCase().trim(), role }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) return { error: j?.error || `Could not send the invitation (HTTP ${res.status}).` };
    return {};
  } catch (e: any) {
    return { error: e?.message || 'Network error' };
  }
}

// Removes a joined member, or revokes a pending invite — the id tells them
// apart server-side. Drops both the workspace row and the legacy ATS row, so
// the person does not keep HR access.
export async function removeMember(privyUserId: string, workspaceId: string, id: string): Promise<{ error?: string; kind?: string }> {
  const { data, error } = await rpc('remove_member', { p_privy: privyUserId, p_workspace: workspaceId, p_id: id });
  if (error) return { error: error.message };
  if (!data?.ok) return { error: 'That person could not be found in this workspace.' };
  return { kind: data.kind };
}

// Offers are invoices with kind='offer'; map the 'offers' object onto the
// invoices table so the whole generic CRUD stack works without bespoke SQL.
const rpcObject = (o: string) => (o === 'offers' ? 'invoices' : o);

// Nudge the automation dispatcher after a mutation (fire-and-forget) so rules
// run within seconds without any cron wiring. Throttled server-side.
function pingAutomations() {
  try { void fetch('/api/automations/tick', { method: 'POST', keepalive: true }).catch(() => {}); } catch { /* SSR/no-op */ }
}

export async function loadRecords(privyUserId: string | null, object: string): Promise<RecordsResult> {
  const fallback: RecordsResult = { rows: MOCK_OBJECT_ROWS[object] || [], live: false };
  if (!privyUserId) return fallback;
  try {
    const ws = await resolveWorkspace(privyUserId);
    if (!ws) return fallback;
    const { data, error } = await rpc('list_records', { p_privy: privyUserId, p_workspace: ws, p_object: rpcObject(object) });
    if (error || !Array.isArray(data)) return fallback;
    // split the shared invoices table into invoices vs offers by kind
    let rows = data as any[];
    if (object === 'offers') rows = rows.filter((r) => r.kind === 'offer');
    else if (object === 'invoices') rows = rows.filter((r) => r.kind !== 'offer');
    return { rows, live: true };   // even an empty live result is "live"
  } catch {
    return fallback;
  }
}

// ── CRUD ────────────────────────────────────────────────────────────────────
export async function getRecord(privyUserId: string, object: string, id: string): Promise<any | null> {
  await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
  const { data, error } = await rpc('get_record', { p_privy: privyUserId, p_object: rpcObject(object), p_id: id });
  if (error) return null;
  return data;
}

export async function createRecord(privyUserId: string, object: string, values: Record<string, any>): Promise<{ id?: string; error?: string }> {
  const ws = await resolveWorkspace(privyUserId);
  if (!ws) return { error: 'No workspace found for your account.' };
  const payload = object === 'offers' ? { ...values, kind: 'offer' } : values;
  const { data, error } = await rpc('create_record', { p_privy: privyUserId, p_workspace: ws, p_object: rpcObject(object), p_data: payload });
  if (error) return { error: error.message };
  pingAutomations();
  return { id: data as string };
}

export async function updateRecord(privyUserId: string, object: string, id: string, values: Record<string, any>): Promise<{ error?: string }> {
  await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
  const { error } = await rpc('update_record', { p_privy: privyUserId, p_object: rpcObject(object), p_id: id, p_data: values });
  if (!error) pingAutomations();
  return error ? { error: error.message } : {};
}

export async function deleteRecord(privyUserId: string, object: string, id: string): Promise<{ error?: string }> {
  await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
  const { error } = await rpc('delete_record', { p_privy: privyUserId, p_object: rpcObject(object), p_id: id });
  return error ? { error: error.message } : {};
}

export async function importRecords(privyUserId: string, object: string, rows: Record<string, any>[]): Promise<{ count?: number; error?: string }> {
  const ws = await resolveWorkspace(privyUserId);
  if (!ws) return { error: 'No workspace found for your account.' };
  const payload = object === 'offers' ? rows.map((r) => ({ ...r, kind: 'offer' })) : rows;
  const { data, error } = await rpc('import_records', { p_privy: privyUserId, p_workspace: ws, p_object: rpcObject(object), p_rows: payload });
  if (error) return { error: error.message };
  pingAutomations();
  return { count: data as number };
}

// Convert an accepted offer into a draft invoice (clones positions); returns the new invoice id.
export async function convertOffer(privyUserId: string, offerId: string): Promise<{ id?: string; error?: string }> {
  await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
  const { data, error } = await rpc('convert_offer_to_invoice', { p_privy: privyUserId, p_offer: offerId });
  if (error) return { error: error.message };
  return { id: data as string };
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
    const { data, error } = await rpc('get_finance_summary', { p_privy: privyUserId, p_workspace: ws });
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
    const { data, error } = await rpc('get_finance_analytics', { p_privy: privyUserId, p_workspace: ws, p_months: months });
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

// ── Transactions / bank ledger (Finance — Midday-style) ───────────────────────
export interface BankAccount { id: string; name: string; currency: string; institution?: string | null; opening_balance: number; balance: number; txn_count: number }
export interface LedgerTxn {
  id: string; txn_date: string; description: string | null; amount: number; currency: string;
  category: string | null; method: string; status: string; tax_rate?: number | null;
  account: string | null; bank_account_id: string | null;
  matched_invoice_id: string | null; matched_expense_id: string | null;
  match: string | null; match_kind: 'invoice' | 'expense' | null;
}
export interface LedgerSummary { inflow: number; outflow: number; net: number; count: number; unreconciled: number }
export interface Ledger { summary: LedgerSummary; rows: LedgerTxn[]; live: boolean }
export interface MatchSuggestion { kind: 'invoice' | 'expense'; id: string; label: string; amount: number; date: string | null; status: string }

export async function loadBankAccounts(privyUserId: string | null): Promise<{ accounts: BankAccount[]; live: boolean }> {
  const fallback = { accounts: mockBankAccounts() as BankAccount[], live: false };
  if (!privyUserId) return fallback;
  try {
    const ws = await resolveWorkspace(privyUserId);
    if (!ws) return fallback;
    const { data, error } = await rpc('get_bank_accounts', { p_privy: privyUserId, p_workspace: ws });
    if (error || !Array.isArray(data)) return fallback;
    return { accounts: (data as any[]).map((a) => ({ ...a, opening_balance: +a.opening_balance || 0, balance: +a.balance || 0, txn_count: +a.txn_count || 0 })), live: true };
  } catch {
    return fallback;
  }
}

export async function createBankAccount(privyUserId: string, name: string, currency: string, opening: number, institution?: string): Promise<{ id?: string; error?: string }> {
  const ws = await resolveWorkspace(privyUserId);
  if (!ws) return { error: 'No workspace found for your account.' };
  const { data, error } = await rpc('create_bank_account', { p_privy: privyUserId, p_workspace: ws, p_name: name, p_currency: currency, p_opening: opening, p_institution: institution || null });
  if (error) return { error: error.message };
  return { id: data as string };
}

export async function deleteBankAccount(privyUserId: string, accountId: string): Promise<{ error?: string }> {
  await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
  const { error } = await rpc('delete_bank_account', { p_privy: privyUserId, p_account: accountId });
  return error ? { error: error.message } : {};
}

export async function loadLedger(privyUserId: string | null, accountId: string | null, months: number): Promise<Ledger> {
  const fallback = (): Ledger => ({ ...mockLedger(months, accountId), live: false } as Ledger);
  if (!privyUserId) return fallback();
  try {
    const ws = await resolveWorkspace(privyUserId);
    if (!ws) return fallback();
    const { data, error } = await rpc('get_transactions_ledger', { p_privy: privyUserId, p_workspace: ws, p_account: accountId, p_months: months });
    if (error || !data) return fallback();
    const d = data as any;
    const s = d.summary || {};
    return {
      summary: { inflow: +s.inflow || 0, outflow: +s.outflow || 0, net: +s.net || 0, count: +s.count || 0, unreconciled: +s.unreconciled || 0 },
      rows: Array.isArray(d.rows) ? d.rows.map((r: any) => ({ ...r, amount: +r.amount || 0 })) : [],
      live: true,
    };
  } catch {
    return fallback();
  }
}

export async function suggestMatches(privyUserId: string, txnId: string): Promise<MatchSuggestion[]> {
  await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
  const { data, error } = await rpc('suggest_transaction_matches', { p_privy: privyUserId, p_txn: txnId });
  if (error || !Array.isArray(data)) return [];
  return (data as any[]).map((m) => ({ ...m, amount: +m.amount || 0 }));
}

export async function reconcileTransaction(privyUserId: string, txnId: string, kind: 'invoice' | 'expense' | 'none', targetId?: string): Promise<{ error?: string }> {
  await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
  const { error } = await rpc('reconcile_transaction', { p_privy: privyUserId, p_txn: txnId, p_kind: kind, p_target: targetId ?? null });
  return error ? { error: error.message } : {};
}

export async function bulkUpdateTransactions(privyUserId: string, ids: string[], patch: Record<string, any>): Promise<{ count?: number; error?: string }> {
  await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
  const { data, error } = await rpc('update_transactions_bulk', { p_privy: privyUserId, p_ids: ids, p_patch: patch });
  if (error) return { error: error.message };
  return { count: +(data as any) || 0 };
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
    const { data, error } = await rpc('get_roadmap', { p_privy: privyUserId, p_workspace: ws });
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
    const { data, error } = await rpc('get_project', { p_privy: privyUserId, p_project: projectId });
    if (error || !data) return mock();
    const d = data as any;
    return { project: d.project || {}, stages: ISSUE_STAGES, records: toRecords(d.issues || []), live: true };
  } catch {
    return mock();
  }
}

// ── Invoice/offer documents (line items + printable PDF) ──────────────────────
export interface InvoiceLineItem { description: string; product?: string | null; product_id?: string | null; image?: string | null; quantity: number; unit_price: number; discount_pct?: number; tax_rate?: number; line_total: number }
export interface DocumentTotals { subtotal: number; discount: number; net: number; tax: number; total: number }
export interface InvoiceDocument {
  id: string; number: string | null; kind: string; direction: string; status: string;
  currency: string; amount: number; category?: string | null;
  issued_at: string | null; due_at: string | null; notes: string | null;
  seller: {
    name: string; logo_url?: string | null; accent_color?: string; address?: string | null; footer?: string | null;
    tax_id?: string | null; country?: string | null; vat_id?: string | null; reg_no?: string | null;
    bdo?: string | null; iban?: string | null; bank_name?: string | null;
  };
  buyer: { name: string; domain?: string; industry?: string; tax_id?: string | null; address?: string | null; country?: string | null } | null;
  items: InvoiceLineItem[]; totals?: DocumentTotals; share_token?: string | null; live: boolean;
}

// Normalise the RPC payload (owner or public variant) into InvoiceDocument.
function mapDocument(d: any): InvoiceDocument {
  return {
    id: d.id, number: d.number, kind: d.kind || 'invoice', direction: d.direction || 'income',
    status: d.status, currency: d.currency || 'USD', amount: +d.amount || 0, category: d.category,
    issued_at: d.issued_at, due_at: d.due_at, notes: d.notes,
    seller: d.seller || { name: 'Your company' },
    buyer: d.buyer || null,
    items: Array.isArray(d.items)
      ? d.items.map((it: any) => ({ description: it.description, product: it.product, product_id: it.product_id, image: it.image, quantity: +it.quantity || 0, unit_price: +it.unit_price || 0, discount_pct: +it.discount_pct || 0, tax_rate: +it.tax_rate || 0, line_total: +it.line_total || 0 }))
      : [],
    totals: d.totals ? { subtotal: +d.totals.subtotal || 0, discount: +d.totals.discount || 0, net: +d.totals.net || 0, tax: +d.totals.tax || 0, total: +d.totals.total || 0 } : undefined,
    share_token: d.share_token || null,
    live: true,
  };
}

// ── Workspace branding (logo, accent, footer for documents) ───────────────────
export interface WorkspaceBranding {
  name: string; logo_url: string | null; legal_name: string | null;
  address: string | null; accent_color: string; invoice_footer: string | null; tax_id: string | null;
  country: string | null; vat_id: string | null; reg_no: string | null; bdo: string | null;
  iban: string | null; bank_name: string | null;
}
export async function loadBranding(privyUserId: string, workspaceId: string): Promise<WorkspaceBranding | null> {
  const { data, error } = await rpc('get_workspace_branding', { p_privy: privyUserId, p_workspace: workspaceId });
  if (error || !data) return null;
  const d = data as any;
  return {
    name: d.name, logo_url: d.logo_url, legal_name: d.legal_name, address: d.address,
    accent_color: d.accent_color || '#6366F1', invoice_footer: d.invoice_footer, tax_id: d.tax_id,
    country: d.country, vat_id: d.vat_id, reg_no: d.reg_no, bdo: d.bdo, iban: d.iban, bank_name: d.bank_name,
  };
}
export async function saveBranding(privyUserId: string, workspaceId: string, data: Partial<WorkspaceBranding>): Promise<{ error?: string }> {
  const { error } = await rpc('save_workspace_branding', { p_privy: privyUserId, p_workspace: workspaceId, p_data: data });
  return error ? { error: error.message } : {};
}

export async function loadInvoiceDocument(privyUserId: string | null, id: string): Promise<InvoiceDocument> {
  const fallback = (): InvoiceDocument => ({ ...(mockInvoiceDocument(id) as any), live: false });
  if (!privyUserId) return fallback();
  try {
    await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
    const { data, error } = await rpc('get_invoice_document', { p_privy: privyUserId, p_id: id });
    if (error || !data) return fallback();
    return mapDocument(data);
  } catch {
    return fallback();
  }
}

// Recipient view: load a document by its share token — no login, no mock
// fallback (returns null so the page can show a clear "not available" state).
export async function loadPublicDocument(id: string, token: string): Promise<InvoiceDocument | null> {
  try {
    const { data, error } = await supabase.rpc('get_invoice_document_public', { p_id: id, p_token: token });
    if (error || !data) return null;
    return mapDocument(data);
  } catch {
    return null;
  }
}

export interface ItemInput { product_id?: string; description?: string; quantity: number; unit_price: number; discount_pct?: number; tax_rate?: number }
export async function saveInvoiceItems(privyUserId: string, invoiceId: string, items: ItemInput[]): Promise<{ total?: number; error?: string }> {
  await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
  const { data, error } = await rpc('save_invoice_items', { p_privy: privyUserId, p_invoice: invoiceId, p_items: items });
  if (error) return { error: error.message };
  return { total: +(data as any) || 0 };
}

// ── First-party web analytics (Marketing) ─────────────────────────────────────
export interface Site { id: string; domain: string; name?: string | null; created_at?: string | null }
export interface SiteStatsDay { day: string; label: string; pageviews: number; visitors: number }
export interface SiteStats {
  pageviews: number; visitors: number; live: number;
  desktop: number; mobile: number;
  series: SiteStatsDay[];
  top_pages: { path: string; count: number }[];
  top_referrers: { ref: string; count: number }[];
  live_flag: boolean; // true = real data
}

export async function loadSites(privyUserId: string | null): Promise<{ sites: Site[]; live: boolean }> {
  if (!privyUserId) return { sites: [], live: false };
  try {
    const ws = await resolveWorkspace(privyUserId);
    if (!ws) return { sites: [], live: false };
    const { data, error } = await rpc('get_sites', { p_privy: privyUserId, p_workspace: ws });
    if (error || !Array.isArray(data)) return { sites: [], live: false };
    return { sites: data as Site[], live: true };
  } catch {
    return { sites: [], live: false };
  }
}

export async function createSite(privyUserId: string, domain: string, name?: string): Promise<{ id?: string; error?: string }> {
  const ws = await resolveWorkspace(privyUserId);
  if (!ws) return { error: 'No workspace found for your account.' };
  const { data, error } = await rpc('create_site', { p_privy: privyUserId, p_workspace: ws, p_domain: domain, p_name: name || null });
  if (error) return { error: error.message };
  return { id: data as string };
}

export async function deleteSite(privyUserId: string, siteId: string): Promise<{ error?: string }> {
  const { error } = await rpc('delete_site', { p_privy: privyUserId, p_site: siteId });
  return error ? { error: error.message } : {};
}

export async function loadSiteStats(privyUserId: string | null, siteId: string | null, days: number): Promise<SiteStats> {
  const fallback = (): SiteStats => ({ ...mockSiteStats(days), live_flag: false });
  if (!privyUserId || !siteId) return fallback();
  try {
    const { data, error } = await rpc('get_site_stats', { p_privy: privyUserId, p_site: siteId, p_days: days });
    if (error || !data) return fallback();
    const d = data as any;
    return {
      pageviews: +d.pageviews || 0, visitors: +d.visitors || 0, live: +d.live || 0,
      desktop: +d.desktop || 0, mobile: +d.mobile || 0,   // 0/0 until 0029 is applied
      series: Array.isArray(d.series) ? d.series.map((p: any) => ({ day: p.day, label: p.label, pageviews: +p.pageviews || 0, visitors: +p.visitors || 0 })) : [],
      top_pages: Array.isArray(d.top_pages) ? d.top_pages : [],
      top_referrers: Array.isArray(d.top_referrers) ? d.top_referrers : [],
      live_flag: true,
    };
  } catch {
    return fallback();
  }
}

// ── Social post studio (Marketing / PreFeed port) ─────────────────────────────
export type PostPlatform = 'instagram' | 'facebook' | 'x' | 'linkedin';
export interface PostListItem {
  id: string; platform: PostPlatform; handle?: string | null; content: string;
  image_url?: string | null; status: string; updated_at?: string; comment_count: number;
}
export interface PostCommentRow { id: string; author: string; body: string; x?: number | null; y?: number | null; resolved: boolean; created_at?: string }
export interface PostDetail {
  id: string; platform: PostPlatform; handle?: string | null; content: string;
  image_url?: string | null; status: string; share_token?: string | null;
  comments: PostCommentRow[]; live: boolean;
}

export async function loadPosts(privyUserId: string | null): Promise<{ posts: PostListItem[]; live: boolean }> {
  const fallback = { posts: MOCK_POSTS as PostListItem[], live: false };
  if (!privyUserId) return fallback;
  try {
    const ws = await resolveWorkspace(privyUserId);
    if (!ws) return fallback;
    const { data, error } = await rpc('get_posts', { p_privy: privyUserId, p_workspace: ws });
    if (error || !Array.isArray(data)) return fallback;
    return { posts: data as PostListItem[], live: true };
  } catch {
    return fallback;
  }
}

// Returns null for a real (uuid) post that can't be loaded — never sample data.
export async function loadPost(privyUserId: string | null, id: string): Promise<PostDetail | null> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (!uuid) return { ...(mockPostDetail(id) as any), live: false };
  if (!privyUserId) return null;
  try {
    const { data, error } = await rpc('get_post', { p_privy: privyUserId, p_id: id });
    if (error || !data) return null;
    return { ...(data as any), live: true };
  } catch {
    return null;
  }
}

export async function savePost(privyUserId: string, id: string | null, values: Record<string, any>): Promise<{ id?: string; error?: string }> {
  const ws = await resolveWorkspace(privyUserId);
  if (!ws) return { error: 'No workspace found for your account.' };
  const { data, error } = await rpc('save_post', { p_privy: privyUserId, p_workspace: ws, p_id: id, p_data: values });
  if (error) return { error: error.message };
  return { id: data as string };
}

export async function addPostComment(privyUserId: string, postId: string, body: string, x?: number, y?: number): Promise<{ error?: string }> {
  const { error } = await rpc('add_post_comment', { p_privy: privyUserId, p_post: postId, p_body: body, p_x: x ?? null, p_y: y ?? null });
  return error ? { error: error.message } : {};
}

export async function setPostCommentResolved(privyUserId: string, commentId: string, resolved: boolean): Promise<{ error?: string }> {
  const { error } = await rpc('set_post_comment_resolved', { p_privy: privyUserId, p_comment: commentId, p_resolved: resolved });
  return error ? { error: error.message } : {};
}

export async function loadPublicPost(id: string, token: string): Promise<PostDetail | null> {
  try {
    const { data, error } = await supabase.rpc('get_post_public', { p_id: id, p_token: token });
    if (error || !data) return null;
    return { ...(data as any), live: true };
  } catch {
    return null;
  }
}

export async function addPublicPostComment(id: string, token: string, author: string, body: string, x?: number, y?: number): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('add_post_comment_public', { p_id: id, p_token: token, p_author: author, p_body: body, p_x: x ?? null, p_y: y ?? null });
  return error ? { error: error.message } : {};
}

export async function loadBoard(privyUserId: string | null, slug: string, kind: PipelineKind): Promise<BoardResult> {
  const m = mockBoard(slug);
  const fallback: BoardResult = { stages: m.stages, records: m.records, live: false };
  if (!privyUserId) return fallback;
  try {
    const ws = await resolveWorkspace(privyUserId);
    if (!ws) return fallback;
    const { data: pipelineId, error: pErr } = await rpc('get_pipeline_by_kind', { p_privy: privyUserId, p_workspace: ws, p_kind: kind });
    if (pErr || !pipelineId) return fallback;
    const { data, error } = await rpc('get_pipeline_board', { p_privy: privyUserId, p_pipeline: pipelineId });
    if (error || !data) return fallback;
    return { stages: (data as any).stages || [], records: (data as any).records || [], live: true };
  } catch {
    return fallback;
  }
}
