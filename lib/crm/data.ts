// Data layer for the new platform shell. Calls the SECURITY DEFINER RPCs from
// migrations 0001–0003 using the Privy pattern (set_config + p_privy_user_id).
// Falls back to mock data whenever the user isn't signed in or the migrations
// haven't been run yet — so the branch always renders, and flips to live data
// automatically once you run the SQL and log in.
import { supabase } from '@/lib/supabase';
import { MOCK_OBJECT_ROWS, mockBoard, MOCK_FINANCE } from './mock';
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
