'use client';

import { rpc } from '@/lib/rpc';

// Client side of mind maps (migration 0067). The graph travels as React Flow's
// own { nodes, edges } shape, so nothing here translates between a storage
// format and a canvas format — there is no second schema to keep in sync.

export interface MindMapSummary {
  id: string;
  title: string;
  node_count: number;
  edge_count: number;
  created_at: string;
  updated_at: string;
}

export interface MindMapGraph {
  nodes: any[];
  edges: any[];
}

export interface MindMapDetail {
  id: string;
  title: string;
  graph: MindMapGraph;
  updated_at: string;
}

const notSetUp = (m: string) => /does not exist|schema cache/i.test(m);
const SETUP = 'Mind maps are not set up yet — run migration 0067 in Supabase.';

export async function loadMindMaps(privy: string, workspace: string): Promise<{ maps: MindMapSummary[]; error?: string }> {
  const { data, error } = await rpc('get_mind_maps', { p_privy: privy, p_workspace: workspace });
  if (error) return { maps: [], error: notSetUp(error.message) ? SETUP : error.message };
  return { maps: Array.isArray(data) ? data : [] };
}

export async function loadMindMap(privy: string, id: string): Promise<{ map?: MindMapDetail; error?: string }> {
  const { data, error } = await rpc('get_mind_map', { p_privy: privy, p_id: id });
  if (error) return { error: notSetUp(error.message) ? SETUP : error.message };
  if (!data) return { error: 'Map not found.' };
  const d = data as any;
  // A map created before anything was drawn has the table default, but be
  // defensive: the canvas reads .nodes/.edges directly and must never get undefined.
  return { map: { ...d, graph: { nodes: d.graph?.nodes ?? [], edges: d.graph?.edges ?? [] } } };
}

export async function createMindMap(privy: string, workspace: string, title?: string) {
  const { data, error } = await rpc('create_mind_map', { p_privy: privy, p_workspace: workspace, p_title: title ?? null });
  if (error) return { error: notSetUp(error.message) ? SETUP : error.message };
  return { id: data as string };
}

/**
 * Persist. Pass only what changed — renaming doesn't send the graph, autosave
 * doesn't send the title, matching how save_mind_map treats its arguments.
 */
export async function saveMindMap(privy: string, id: string, graph?: MindMapGraph, title?: string) {
  const { error } = await rpc('save_mind_map', {
    p_privy: privy, p_id: id,
    p_graph: graph ?? null, p_title: title ?? null,
  });
  if (!error) return {};
  if (/GRAPH_TOO_LARGE/.test(error.message)) return { error: 'This map is too large to save. Remove some boxes.' };
  if (/BAD_GRAPH/.test(error.message)) return { error: 'The canvas could not be saved — its shape was rejected.' };
  return { error: notSetUp(error.message) ? SETUP : error.message };
}

export async function deleteMindMap(privy: string, id: string) {
  const { error } = await rpc('delete_mind_map', { p_privy: privy, p_id: id });
  return error ? { error: error.message } : {};
}
