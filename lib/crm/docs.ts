// Data layer for the Docs module + BYO-AI keys (migration 0034).
import { supabase } from '@/lib/supabase';
import { getWorkspace } from './data';
import { rpc } from '@/lib/rpc';

/**
 * The four kinds, each with its own editor. 0081 shipped two and said why:
 * a kind the editor cannot render is a bug waiting. 0085 widened the CHECK once
 * the other two had one — so this list and `docs_kind_check` move together.
 *
 * `sheet` is a TABLE, not a spreadsheet — no formulas. Live data in a real
 * spreadsheet is the Excel feed (0078) and two-way sync (0079), pointed at real
 * records; a half-built formula engine here would be strictly worse.
 */
export type DocKind = 'doc' | 'note' | 'todo' | 'sheet';

export const DOC_KINDS: DocKind[] = ['doc', 'note', 'todo', 'sheet'];

export const KIND_META: Record<DocKind, { label: string; plural: string; blurb: string; seed: string; title: string }> = {
  doc:   { label: 'Document', plural: 'Docs',   blurb: 'Rich text, images and AI',     seed: '',       title: 'Untitled' },
  note:  { label: 'Note',     plural: 'Notes',  blurb: 'A quick note with checkboxes', seed: '- [ ] ', title: 'Untitled note' },
  todo:  { label: 'To-do',    plural: 'To-do',  blurb: 'A checklist with progress',    seed: '- [ ] ', title: 'Untitled list' },
  sheet: { label: 'Table',    plural: 'Tables', blurb: 'A small table — no formulas',
           seed: '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |', title: 'Untitled table' },
};

/** Anything unlabelled predates the kind column and is a document. */
export const kindOf = (k?: string | null): DocKind =>
  (DOC_KINDS as string[]).includes(k || '') ? (k as DocKind) : 'doc';

export interface DocMeta {
  id: string; title: string; snippet: string; kind?: DocKind; updated_at: string;
  /**
   * Up to 1200 characters of the body — enough for a card to render its own
   * checklist or table, and nowhere near a document transfer. TRUNCATED, which
   * is why nothing ever saves derived from it (see `toggleDocItem`).
   */
  preview?: string;
  tags?: string[];
  /** Counted in SQL over the WHOLE body, so a long list is not under-reported. */
  item_count?: number;
  done_count?: number;
}
export interface Doc { id: string; title: string; body: string; kind?: DocKind; tags?: string[]; updated_at?: string }
export interface AiProviderRow { id: string; provider: string; model: string; key_hint: string; is_default: boolean; enabled: boolean; base_url?: string | null }

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
  const { data, error } = await rpc('get_docs', { p_privy: privy, p_workspace: id });
  if (error || !Array.isArray(data)) return fallback;
  return { rows: data as DocMeta[], live: true };
}

export async function loadDoc(privy: string | null, docId: string): Promise<Doc | null> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(docId);
  if (!uuid) return SAMPLE_DOC(docId);           // sample ids (d1…) render sample content
  if (!privy) return null;
  const { data, error } = await rpc('get_doc', { p_privy: privy, p_id: docId });
  if (error || !data) return null;
  return data as Doc;
}

/**
 * `kind` is optional and defaults to UNDEFINED, not 'doc' — mirroring the SQL.
 * A caller that does not mention the kind means "leave it alone"; defaulting to
 * 'doc' here would convert a table into a document on any save that forgot to
 * pass it, which is exactly the bug the null default in 0085 exists to prevent.
 */
export async function saveDoc(privy: string, id: string | null, title: string, body: string, kind?: DocKind, tags?: string[]): Promise<{ id?: string; error?: string }> {
  const wsId = await ws(privy);
  if (!wsId) return { error: 'No workspace found for your account.' };
  const { data, error } = await rpc('save_doc', {
    p_privy: privy, p_workspace: wsId, p_id: id, p_title: title, p_body: body,
    // Both null-by-default and both meaning "leave it alone" — see 0086.
    p_kind: kind ?? null, p_tags: tags ?? null,
  });
  if (error) {
    // 0081 added `p_kind`, so a workspace that has not run it yet answers "no
    // function matches". Retry without it rather than telling someone their
    // document failed to save — the doc is the point, the kind is a label.
    if (/p_kind|p_tags|does not exist|schema cache/i.test(error.message)) {
      const retry = await rpc('save_doc', { p_privy: privy, p_workspace: wsId, p_id: id, p_title: title, p_body: body });
      if (!retry.error) return { id: retry.data as string };
    }
    return { error: error.message };
  }
  return { id: data as string };
}

/**
 * Flip one checklist item without opening the document.
 *
 * The body is never sent — the card only ever holds a truncated preview, so
 * anything derived from it would save a shortened document. `done` is explicit
 * rather than a toggle so two taps, or two people, converge on what was
 * actually chosen. See toggle_doc_item in 0086.
 */
export async function toggleDocItem(privy: string, id: string, index: number, done: boolean): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await rpc('toggle_doc_item', { p_privy: privy, p_id: id, p_index: index, p_done: done });
  if (error) {
    return { ok: false, error: /does not exist|schema cache/i.test(error.message)
      ? 'Ticking from the list needs migration 0086 — run it in Supabase.'
      : error.message };
  }
  return { ok: data === true };
}

/**
 * A stable colour for a tag, derived from its name.
 *
 * No colour picker and no tags table: "Personal" is the same green in every
 * workspace, and nobody has to administer a palette. Semantic-token classes
 * only — a literal `bg-pink-500` here is exactly what breaks dark mode.
 */
const TAG_TONES = [
  'bg-rose-500', 'bg-emerald-500', 'bg-sky-500', 'bg-violet-500',
  'bg-amber-500', 'bg-teal-500', 'bg-fuchsia-500', 'bg-indigo-500',
];

export function tagDot(tag: string): string {
  // FNV-1a: tiny, stable across reloads and machines, and evenly spread — a
  // sum of char codes clusters badly on short similar words like "Q1"/"Q2".
  let h = 0x811c9dc5;
  for (let i = 0; i < tag.length; i++) {
    h ^= tag.toLowerCase().charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return TAG_TONES[Math.abs(h) % TAG_TONES.length];
}

export async function deleteDoc(privy: string, id: string): Promise<{ error?: string }> {
  const { error } = await rpc('delete_doc', { p_privy: privy, p_id: id });
  return error ? { error: error.message } : {};
}

// ── AI providers (BYO keys) ───────────────────────────────────────────────────
export async function loadAiProviders(privy: string | null): Promise<{ rows: AiProviderRow[]; live: boolean }> {
  const fallback = { rows: SAMPLE_PROVIDERS, live: false };
  const id = await ws(privy);
  if (!privy || !id) return fallback;
  const { data, error } = await rpc('get_ai_providers', { p_privy: privy, p_workspace: id });
  if (error || !Array.isArray(data)) return fallback;
  return { rows: data as AiProviderRow[], live: true };
}

export async function saveAiKey(privy: string, provider: string, model: string, key: string, baseUrl?: string): Promise<{ error?: string }> {
  const wsId = await ws(privy);
  if (!wsId) return { error: 'No workspace found for your account.' };
  try {
    const res = await fetch('/api/ai/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ privyUserId: privy, workspaceId: wsId, provider, model, key, baseUrl }) });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to save key' };
    return {};
  } catch (e: any) { return { error: e?.message || 'Failed to save key' }; }
}

export async function setAiProviderMeta(privy: string, id: string, patch: { model?: string; is_default?: boolean; enabled?: boolean }): Promise<{ error?: string }> {
  const { error } = await rpc('set_ai_provider_meta', { p_privy: privy, p_id: id, p_model: patch.model ?? null, p_default: patch.is_default ?? null, p_enabled: patch.enabled ?? null });
  return error ? { error: error.message } : {};
}

export async function deleteAiProvider(privy: string, id: string): Promise<{ error?: string }> {
  const { error } = await rpc('delete_ai_provider', { p_privy: privy, p_id: id });
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
