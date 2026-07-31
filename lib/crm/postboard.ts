'use client';

import { rpc } from '@/lib/rpc';

/**
 * The board stores ONLY what a post cannot: where it sits, and what it connects
 * to. Nodes are derived from the live post list every time the canvas opens, so
 * a post deleted from the calendar or the grid simply stops being drawn and one
 * created there shows up needing a place. No cleanup job, no stale cards.
 */
export interface PostBoardGraph {
  positions: Record<string, { x: number; y: number }>;
  edges: { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }[];
}

export const EMPTY_BOARD: PostBoardGraph = { positions: {}, edges: [] };

export async function loadPostBoard(privy: string, ws: string): Promise<PostBoardGraph> {
  const { data, error } = await rpc('get_post_board', { p_privy: privy, p_workspace: ws });
  if (error || !data) return EMPTY_BOARD;
  return {
    positions: (data as any).positions && typeof (data as any).positions === 'object' ? (data as any).positions : {},
    edges: Array.isArray((data as any).edges) ? (data as any).edges : [],
  };
}

export async function savePostBoard(privy: string, ws: string, graph: PostBoardGraph): Promise<{ error?: string }> {
  const { error } = await rpc('save_post_board', { p_privy: privy, p_workspace: ws, p_graph: graph });
  if (!error) return {};
  if (/GRAPH_TOO_LARGE/.test(error.message)) return { error: 'This board has grown too large to save.' };
  if (/BAD_GRAPH/.test(error.message)) return { error: 'The board could not be saved (unexpected shape).' };
  return { error: error.message };
}

/**
 * Place posts that have never been positioned. Laid out in reading order at a
 * fixed pitch rather than at random: a first-time open should look like a plan
 * someone arranged, not like spilled cards.
 */
export function autoPlace(ids: string[], existing: PostBoardGraph['positions']) {
  const COLS = 4, W = 280, H = 260;
  const out = { ...existing };
  let i = 0;
  for (const id of ids) {
    if (out[id]) continue;
    // Continue below whatever is already placed, so newly created posts do not
    // land on top of an arranged board.
    const used = Object.keys(existing).length + i;
    out[id] = { x: (used % COLS) * W, y: Math.floor(used / COLS) * H };
    i++;
  }
  return out;
}
