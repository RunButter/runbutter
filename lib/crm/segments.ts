'use client';

import { rpc } from '@/lib/rpc';

export interface SegmentFilter { field: string; op: string; value: string }

export interface Segment {
  id: string; name: string; description: string;
  filters: SegmentFilter[]; updated_at?: string;
}

export interface SegmentPreviewRow {
  id: string; email: string; name: string; status: string;
  consent_source: string; created_at: string;
}

/**
 * The predicate vocabulary, mirroring segment_match in 0072.
 *
 * This list is the UI's whole surface: SQL fails closed on anything it does not
 * recognise, so an option that exists here but not there silently matches
 * nobody. Keep the two in step.
 */
export const SEGMENT_FIELDS: {
  field: string; label: string;
  ops: { op: string; label: string; input: 'text' | 'days' | 'count' | 'status' | 'list' | 'none' }[];
}[] = [
  { field: 'status', label: 'Status', ops: [
    { op: 'eq', label: 'is', input: 'status' },
    { op: 'neq', label: 'is not', input: 'status' },
  ] },
  { field: 'email', label: 'Email', ops: [
    { op: 'contains', label: 'contains', input: 'text' },
    { op: 'not_contains', label: 'does not contain', input: 'text' },
    { op: 'ends_with', label: 'ends with', input: 'text' },
  ] },
  { field: 'name', label: 'Name', ops: [
    { op: 'contains', label: 'contains', input: 'text' },
    { op: 'is_set', label: 'is set', input: 'none' },
    { op: 'is_empty', label: 'is empty', input: 'none' },
  ] },
  { field: 'consent_source', label: 'Signed up via', ops: [
    { op: 'contains', label: 'contains', input: 'text' },
    { op: 'eq', label: 'is', input: 'text' },
  ] },
  { field: 'created_at', label: 'Subscribed', ops: [
    { op: 'within_days', label: 'in the last (days)', input: 'days' },
    { op: 'before_days', label: 'more than (days) ago', input: 'days' },
  ] },
  { field: 'on_list', label: 'List', ops: [
    { op: 'eq', label: 'is on', input: 'list' },
    { op: 'neq', label: 'is not on', input: 'list' },
  ] },
  { field: 'opened', label: 'Opened', ops: [
    { op: 'within_days', label: 'in the last (days)', input: 'days' },
    { op: 'not_within_days', label: 'not in the last (days)', input: 'days' },
    { op: 'never', label: 'never', input: 'none' },
  ] },
  { field: 'clicked', label: 'Clicked', ops: [
    { op: 'within_days', label: 'in the last (days)', input: 'days' },
    { op: 'not_within_days', label: 'not in the last (days)', input: 'days' },
    { op: 'never', label: 'never', input: 'none' },
  ] },
  { field: 'received', label: 'Newsletters received', ops: [
    { op: 'at_least', label: 'at least', input: 'count' },
    { op: 'never', label: 'none', input: 'none' },
  ] },
];

export const SUBSCRIBER_STATUSES = ['enabled', 'unconfirmed', 'unsubscribed', 'bounced', 'complained'];

export const inputFor = (field: string, op: string) =>
  SEGMENT_FIELDS.find((f) => f.field === field)?.ops.find((o) => o.op === op)?.input ?? 'text';

export async function listSegments(privy: string, ws: string): Promise<Segment[]> {
  const { data } = await rpc('get_segments', { p_privy: privy, p_workspace: ws });
  return Array.isArray(data) ? data : [];
}

export async function saveSegment(
  privy: string, ws: string, s: Partial<Segment> & { id?: string | null },
): Promise<{ id: string | null; error?: string }> {
  const { data, error } = await rpc('save_segment', {
    p_privy: privy, p_workspace: ws, p_id: s.id ?? null,
    p_name: s.name || 'New segment', p_description: s.description || '',
    p_filters: s.filters ?? [],
  });
  if (!error) return { id: (data as any) ?? null };
  if (/TOO_MANY_FILTERS/.test(error.message)) return { id: null, error: 'A segment can hold at most 20 conditions.' };
  if (/BAD_FILTERS/.test(error.message)) return { id: null, error: 'Those conditions could not be saved.' };
  return { id: null, error: error.message };
}

export const deleteSegment = (privy: string, ws: string, id: string) =>
  rpc('delete_segment', { p_privy: privy, p_workspace: ws, p_id: id });

/** Evaluate filters live, without saving them — this is what makes the builder usable. */
export async function previewSegment(
  privy: string, ws: string, filters: SegmentFilter[], limit = 10,
): Promise<{ rows: SegmentPreviewRow[]; total: number }> {
  const { data } = await rpc('evaluate_segment_filters', {
    p_privy: privy, p_workspace: ws, p_filters: filters, p_limit: limit, p_offset: 0,
  });
  const d = data as any;
  return { rows: Array.isArray(d?.rows) ? d.rows : [], total: Number(d?.total ?? 0) };
}

export async function syncSegmentToList(
  privy: string, ws: string, segment: string, list: string,
): Promise<{ added?: number; error?: string }> {
  const { data, error } = await rpc('sync_segment_to_list', {
    p_privy: privy, p_workspace: ws, p_segment: segment, p_list: list,
  });
  if (!error) return { added: Number((data as any)?.added ?? 0) };
  if (/NOT_FOUND/.test(error.message)) return { error: 'That segment or list no longer exists.' };
  return { error: error.message };
}
