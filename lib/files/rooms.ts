'use client';

import { rpc } from '@/lib/rpc';

/**
 * Data rooms: a fixed set of files behind one revocable link (0110).
 *
 * The file set is chosen once and frozen. That is the difference between this
 * and sharing a folder — a folder keeps sharing whatever lands in it later, and
 * the person who shared it is not thinking about the link when they upload next
 * month's payroll.
 */
export interface DataRoom {
  id: string; token: string; title: string;
  created_at: string; expires_at: string | null; revoked_at: string | null;
  file_count: number; opens: number; last_open: string | null;
}

export interface RoomEvent { kind: 'open' | 'file'; at: string; file: string | null }

export async function createDataRoom(
  privy: string, ws: string, input: { title: string; note?: string; fileIds: string[]; days?: number | null },
): Promise<{ token?: string; error?: string }> {
  const { data, error } = await rpc('create_data_room', {
    p_privy: privy, p_workspace: ws,
    p_title: input.title, p_note: input.note || '',
    p_files: input.fileIds, p_days: input.days ?? null,
  });
  if (error) {
    // The SQL refuses a room with no files it owns, which is also what a
    // cross-tenant id gets. Said plainly rather than as a code.
    if (/NO_FILES/.test(error.message)) return { error: 'Pick at least one file you own.' };
    return { error: error.message };
  }
  const token = (data as any)?.token;
  return typeof token === 'string' ? { token } : { error: 'No link was returned.' };
}

export async function listDataRooms(privy: string, ws: string): Promise<DataRoom[]> {
  const { data, error } = await rpc('get_data_rooms', { p_privy: privy, p_workspace: ws });
  return error || !Array.isArray(data) ? [] : (data as DataRoom[]);
}

export async function roomActivity(privy: string, ws: string, id: string): Promise<RoomEvent[]> {
  const { data, error } = await rpc('get_data_room_activity', { p_privy: privy, p_workspace: ws, p_id: id });
  return error || !Array.isArray(data) ? [] : (data as RoomEvent[]);
}

export const revokeDataRoom = (privy: string, ws: string, id: string) =>
  rpc('revoke_data_room', { p_privy: privy, p_workspace: ws, p_id: id });
