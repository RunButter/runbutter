'use client';

import { rpc } from '@/lib/rpc';

/**
 * Agent research notes (0084).
 *
 * `source` is required and there is no confidence field — see the migration.
 * The short version: a URL or a tool name is checkable, 0.87 is not, and a
 * number next to a guess is how a hallucination gets trusted.
 */

export interface RecordNote {
  id: string;
  object: string;
  record_id: string;
  agent_id: string | null;
  agent_name: string;
  run_id: string | null;
  kind: 'observation' | 'action';
  body: string;
  source: string;
  source_url: string | null;
  observed_at: string | null;
  created_at: string;
}

const NOT_SET_UP = /schema cache|does not exist|Could not find the function/i;

export async function loadRecordNotes(
  privy: string, object: string, recordId: string,
): Promise<{ rows: RecordNote[]; error?: string }> {
  const { data, error } = await rpc('get_record_notes', {
    p_privy: privy, p_object: object, p_record: recordId, p_limit: 50,
  });
  if (error) {
    return { rows: [], error: NOT_SET_UP.test(error.message)
      ? 'Research notes need migration 0084 — run it in Supabase.'
      : error.message };
  }
  return { rows: Array.isArray(data) ? (data as RecordNote[]) : [] };
}

export async function addRecordNote(
  privy: string, workspaceId: string, object: string, recordId: string,
  body: string, source: string, sourceUrl?: string | null,
): Promise<{ id?: string; error?: string }> {
  const { data, error } = await rpc('add_record_note', {
    p_privy: privy, p_workspace: workspaceId, p_object: object, p_record: recordId,
    p_body: body, p_source: source, p_kind: 'observation',
    p_source_url: sourceUrl || null, p_observed_at: null,
    p_agent: null, p_agent_name: '', p_run: null,
  });
  if (error) {
    if (/SOURCE_REQUIRED/.test(error.message)) return { error: 'Say where this came from — a link, a document, or who told you.' };
    if (/EMPTY_NOTE/.test(error.message)) return { error: 'Write the note first.' };
    return { error: error.message };
  }
  return { id: data as string };
}

export async function deleteRecordNote(privy: string, workspaceId: string, id: string) {
  const { error } = await rpc('delete_record_note', { p_privy: privy, p_workspace: workspaceId, p_id: id });
  return error ? { error: error.message } : {};
}
