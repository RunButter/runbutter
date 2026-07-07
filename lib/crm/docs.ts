// Data layer for the Docs module + BYO-AI keys (migration 0034).
import { supabase } from '@/lib/supabase';
import { getWorkspace } from './data';

export interface DocMeta { id: string; title: string; snippet: string; updated_at: string }
export interface Doc { id: string; title: string; body: string; updated_at?: string }
export interface AiProviderRow { id: string; provider: string; model: string; key_hint: string; is_default: boolean; enabled: boolean }

const SAMPLE_DOCS: DocMeta[] = [
  { id: 'd1', title: 'Q3 board update', snippet: 'Revenue is up 24% quarter over quarter, driven by the new Starter plan…', updated_at: '2026-07-07T10:00:00Z' },
  { id: 'd2', title: 'Offer letter — Senior Engineer', snippet: 'Dear {{first_name}}, we are delighted to offer you the position of…', updated_at: '2026-07-06T15:30:00Z' },
  { id: 'd3', title: 'Sales playbook', snippet: '# Discovery\nAsk about their current stack and the cost of the status quo…', updated_at: '2026-07-04T09:12:00Z' },
];
const SAMPLE_DOC = (id: string): Doc => ({ id, title: 'Q3 board update', body: '# Q3 board update\n\nRevenue is **up 24%** quarter over quarter, driven by the new Starter plan.\n\n- Cash runway: 14 months\n- Net new logos: 38\n- Churn: 1.2%\n\n_Draft — use the AI toolbar to expand any section._', updated_at: '2026-07-07T10:00:00Z' });
const SAMPLE_PROVIDERS: AiProviderRow[] = [
  { id: 'p1', provider: 'claude', model: 'claude-sonnet-5', key_hint: '…a1b2', is_default: true, enabled: true },
  { id: 'p2', provider: 'openai', model: 'gpt-4o', key_hint: '…9f3c', is_default: false, enabled: true },
];

async function ws(privy: string | null): Promise<string | null> {
  if (!privy) return null;
  const w = await getWorkspace(privy);
  return w?.id ?? null;
}

// ── Docs ──────────────────────────────────────────────────────────────────────
export async function loadDocs(privy: string | null): Promise<{ rows: DocMeta[]; live: boolean }> {
  const fallback = { rows: SAMPLE_DOCS, live: false };
  const id = await ws(privy);
  if (!privy || !id) return fallback;
  const { data, error } = await supabase.rpc('get_docs', { p_privy: privy, p_workspace: id });
  if (error || !Array.isArray(data)) return fallback;
  return { rows: data as DocMeta[], live: true };
}

export async function loadDoc(privy: string | null, docId: string): Promise<Doc | null> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(docId);
  if (!uuid) return SAMPLE_DOC(docId);           // sample ids (d1…) render sample content
  if (!privy) return null;
  await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privy, is_local: false });
  const { data, error } = await supabase.rpc('get_doc', { p_privy: privy, p_id: docId });
  if (error || !data) return null;
  return data as Doc;
}

export async function saveDoc(privy: string, id: string | null, title: string, body: string): Promise<{ id?: string; error?: string }> {
  const wsId = await ws(privy);
  if (!wsId) return { error: 'No workspace found for your account.' };
  const { data, error } = await supabase.rpc('save_doc', { p_privy: privy, p_workspace: wsId, p_id: id, p_title: title, p_body: body });
  if (error) return { error: error.message };
  return { id: data as string };
}

export async function deleteDoc(privy: string, id: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('delete_doc', { p_privy: privy, p_id: id });
  return error ? { error: error.message } : {};
}

// ── AI providers (BYO keys) ───────────────────────────────────────────────────
export async function loadAiProviders(privy: string | null): Promise<{ rows: AiProviderRow[]; live: boolean }> {
  const fallback = { rows: SAMPLE_PROVIDERS, live: false };
  const id = await ws(privy);
  if (!privy || !id) return fallback;
  const { data, error } = await supabase.rpc('get_ai_providers', { p_privy: privy, p_workspace: id });
  if (error || !Array.isArray(data)) return fallback;
  return { rows: data as AiProviderRow[], live: true };
}

export async function saveAiKey(privy: string, provider: string, model: string, key: string): Promise<{ error?: string }> {
  const wsId = await ws(privy);
  if (!wsId) return { error: 'No workspace found for your account.' };
  try {
    const res = await fetch('/api/ai/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ privyUserId: privy, workspaceId: wsId, provider, model, key }) });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to save key' };
    return {};
  } catch (e: any) { return { error: e?.message || 'Failed to save key' }; }
}

export async function setAiProviderMeta(privy: string, id: string, patch: { model?: string; is_default?: boolean; enabled?: boolean }): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('set_ai_provider_meta', { p_privy: privy, p_id: id, p_model: patch.model ?? null, p_default: patch.is_default ?? null, p_enabled: patch.enabled ?? null });
  return error ? { error: error.message } : {};
}

export async function deleteAiProvider(privy: string, id: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('delete_ai_provider', { p_privy: privy, p_id: id });
  return error ? { error: error.message } : {};
}

// ── Run AI on text (write / improve / summarize / continue / fix) ─────────────
export async function runAI(privy: string, mode: string, text: string, instruction?: string): Promise<{ text?: string; error?: string }> {
  const wsId = await ws(privy);
  if (!wsId) return { error: 'No workspace found for your account.' };
  try {
    const res = await fetch('/api/ai/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ privyUserId: privy, workspaceId: wsId, mode, text, instruction }) });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'AI request failed' };
    return { text: data.text };
  } catch (e: any) { return { error: e?.message || 'AI request failed' }; }
}
