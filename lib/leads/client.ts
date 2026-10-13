'use client';

// The browser half of Find leads: calling the two routes, setting up the
// Leads object, and saving through the ordinary create_record.
//
// Saving is deliberately NOT a route of its own. A lead written by this screen
// must be indistinguishable from one typed into the Leads table: same plan
// limit, same tenancy check, same automations firing. The route that searched
// never writes, which keeps "reads public data" and "writes your workspace" in
// two places that can each be reasoned about alone.
import { rpc } from '@/lib/rpc';
import { loadCustomObjects, saveCustomObject, saveCustomField, type CustomObject } from '@/lib/crm/custom';
import { NAV_PREFS_EVENT } from '@/lib/crm/nav';
import { planLimitMessage } from '@/lib/plans';
import { LEAD_FIELDS, LEAD_OBJECT, LEAD_SLUG, leadKeyOf, type Enrichment } from './fields';
import type { FoundPlace, GeoPlace, SearchResult } from './osm';
import type { SiteContacts } from './enrich';

async function authHeaders(): Promise<Record<string, string>> {
  const { getAccessToken } = await import('@privy-io/react-auth');
  const token = await getAccessToken().catch(() => null);
  return token ? { 'x-privy-token': token } : {};
}

async function post<T>(url: string, body: unknown): Promise<T | { error: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) return { error: j?.error || `Something went wrong (${res.status}).` };
    return j as T;
  } catch {
    return { error: 'Could not reach the server. Check your connection.' };
  }
}

export const searchLeads = (b: { category?: string; query?: string; where: string; radiusKm: number; name?: string; place?: GeoPlace | null }) =>
  post<SearchResult & { source?: 'overture' | 'osm' }>('/api/leads/search', b);

export const enrichSites = (websites: string[]) =>
  post<{ results: SiteContacts[] }>('/api/leads/enrich', { websites });

// ── Google, through the official Places API on the workspace's key ──────────

export interface SourcesStatus {
  google: { connected: boolean; hint: string; from: 'workspace' | 'server' | null; migrated: boolean };
  scraper: boolean;
}

export async function loadSources(ws: string): Promise<SourcesStatus | { error: string }> {
  try {
    const res = await fetch(`/api/leads/sources?${new URLSearchParams({ workspace: ws })}`, { headers: await authHeaders() });
    const j = await res.json().catch(() => null);
    if (!res.ok) return { error: j?.error || `Something went wrong (${res.status}).` };
    return j as SourcesStatus;
  } catch {
    return { error: 'Could not reach the server.' };
  }
}

export const connectGoogleKey = (ws: string, key: string) =>
  post<{ ok: true; hint: string }>('/api/leads/sources', { workspace: ws, key });

export async function disconnectGoogleKey(ws: string): Promise<{ error?: string }> {
  try {
    const res = await fetch(`/api/leads/sources?${new URLSearchParams({ workspace: ws })}`, { method: 'DELETE', headers: await authHeaders() });
    const j = await res.json().catch(() => null);
    return res.ok ? {} : { error: j?.error || `Something went wrong (${res.status}).` };
  } catch {
    return { error: 'Could not reach the server.' };
  }
}

export type PlacesSearchResult = SearchResult & { calls: number; keyFrom: 'workspace' | 'server'; query: string };

export const searchGooglePlaces = (b: {
  workspace: string; category?: string; query?: string; where: string; name?: string;
  place?: GeoPlace | null; radiusKm?: number; depth: 'quick' | 'city' | 'deep';
}) => post<PlacesSearchResult>('/api/leads/places', b);

// ── Google Maps, through the operator's own scraper (lib/leads/gmaps.ts) ────

/** Whether this server has a scraper. Asked once; no sign-in needed to know. */
export async function gmapsAvailable(): Promise<boolean> {
  try {
    const j = await fetch('/api/leads/gmaps').then((r) => r.json());
    return !!j?.enabled;
  } catch { return false; }
}

export const startGmapsSearch = (b: { category: string; query?: string; where: string; name?: string; place?: GeoPlace | null }) =>
  post<{ job: string; place: GeoPlace; query: string }>('/api/leads/gmaps', b);

export type GmapsPoll =
  | { status: 'pending' | 'working' }
  | { status: 'ok'; results: FoundPlace[] }
  | { status: 'failed'; error: string }
  | { error: string };

export async function pollGmapsSearch(job: string, country: string): Promise<GmapsPoll> {
  try {
    const res = await fetch(`/api/leads/gmaps?${new URLSearchParams({ job, country })}`, { headers: await authHeaders() });
    const j = await res.json().catch(() => null);
    if (!res.ok) return { error: j?.error || `Something went wrong (${res.status}).` };
    return j as GmapsPoll;
  } catch {
    return { error: 'Could not reach the server. Check your connection.' };
  }
}

/** Where a found business was listed, by name. */
export const listedOn = (p: Pick<FoundPlace, 'ref'>) =>
  p.ref.startsWith('google/') ? 'Google Maps' : p.ref.startsWith('overture/') ? 'Overture Maps (open data)' : 'OpenStreetMap';

// ── The Leads object ─────────────────────────────────────────────────────────

export async function findLeadsObject(privy: string, ws: string): Promise<{ obj: CustomObject | null; error?: string }> {
  const { rows, error } = await loadCustomObjects(privy, ws);
  return { obj: rows.find((o) => o.slug === LEAD_SLUG) ?? null, error };
}

/**
 * Create Leads, or add whatever fields an existing one lacks. Owner/admin only
 * (save_custom_object says so in SQL). An existing object keeps its own name
 * field: marking ours primary would quietly demote theirs.
 */
export async function setUpLeads(privy: string, ws: string, existing: CustomObject | null): Promise<{ obj?: CustomObject; error?: string }> {
  let id = existing?.id;
  if (!id) {
    const made = await saveCustomObject(privy, ws, { ...LEAD_OBJECT });
    if (made.error || !made.id) return { error: made.error || 'Could not create Leads.' };
    id = made.id;
  }
  const have = new Set((existing?.fields || []).map((f) => f.key));
  let pos = existing?.fields?.length ?? 0;
  for (const f of LEAD_FIELDS) {
    if (have.has(f.key)) continue;
    const r = await saveCustomField(privy, ws, id, {
      key: f.key, label: f.label, type: f.type, options: [...(f.options || [])],
      is_primary: !existing && !!f.primary, required: !existing && !!f.required, position: pos++,
    });
    if (r.error) return { error: `${f.label}: ${r.error}` };
  }
  const { obj, error } = await findLeadsObject(privy, ws);
  if (!obj) return { error: error || 'Leads was created but could not be read back. Reload the page.' };
  window.dispatchEvent(new Event(NAV_PREFS_EVENT)); // the rail shows Leads without a reload
  return { obj };
}

/** Leads already saved, so a result can say so before anybody saves it twice. */
export async function loadSavedIndex(privy: string, ws: string): Promise<{ sources: Set<string>; names: Set<string>; count: number }> {
  const { data } = await rpc('list_records', { p_privy: privy, p_workspace: ws, p_object: LEAD_SLUG }, { quiet: true });
  const rows: any[] = Array.isArray(data) ? data : [];
  return {
    sources: new Set(rows.map((r) => String(r.source || '')).filter(Boolean)),
    names: new Set(rows.map((r) => leadKeyOf(r.name, r.city))),
    count: rows.length,
  };
}

export const isSaved = (idx: { sources: Set<string>; names: Set<string> }, p: FoundPlace) =>
  idx.sources.has(p.url) || idx.names.has(leadKeyOf(p.name, p.city));

/**
 * One lead, through create_record. Only keys the object actually has are sent
 * (it may have been edited since it was set up), and a value its type rejects
 * — custom fields fail CLOSED — is dropped and the lead saved without it,
 * rather than losing the business over one malformed phone number.
 */
export async function saveLead(
  privy: string, ws: string, obj: CustomObject, values: Record<string, string>,
): Promise<{ id?: string; error?: string; limit?: boolean }> {
  const fields = new Map(obj.fields.map((f) => [f.key, f]));
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    const f = fields.get(k);
    if (!f || !v) continue;
    if (f.type === 'select' && f.options?.length && !f.options.includes(v)) continue;
    data[k] = v;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: id, error } = await rpc('create_record', { p_privy: privy, p_workspace: ws, p_object: LEAD_SLUG, p_data: data });
    if (!error) return { id: id as string };
    const limit = planLimitMessage(error.message);
    if (limit) return { error: limit, limit: true };
    const bad = /(?:NOT_AN_EMAIL|NOT_A_URL|BAD_OPTION|NOT_A_NUMBER|NOT_A_DATE):\s*([a-z0-9_]+)/i.exec(error.message || '');
    if (bad && bad[1] in data && bad[1] !== 'name') { delete data[bad[1]]; continue; }
    return { error: error.message };
  }
  return { error: 'Could not save this lead.' };
}

/**
 * Where the lead came from, on the record itself. A source is required for a
 * note (0084) and here it is the honest one: a link to the map entry, and the
 * page the email was read from. Asked "where did you get my address?", that is
 * the answer — and in the EU it is a question people are entitled to ask.
 */
export async function noteProvenance(privy: string, ws: string, id: string, p: FoundPlace, e?: Enrichment | null) {
  const lines = [`Found with Find leads: ${p.category || 'business'}${p.city ? ` in ${p.city}` : ''}, listed on ${listedOn(p)}.`];
  if (!p.email && e?.emails?.[0]) lines.push(`Email ${e.emails[0]} is published on ${e.checked.join(' and ') || p.website}.`);
  await rpc('add_record_note', {
    p_privy: privy, p_workspace: ws, p_object: LEAD_SLUG, p_record: id,
    p_body: lines.join(' '), p_source: `Find leads (${listedOn(p)})`, p_source_url: p.url,
  }, { quiet: true });
}

/** CSV of the chosen results — for a member who cannot set up Leads, or a list going elsewhere. */
export function toCsv(rows: Record<string, string>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  // A cell starting = + - @ is a formula in Excel. Data from a public map is
  // exactly the kind that should never become one.
  const cell = (v: string) => {
    const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(String(r[c] ?? ''))).join(','))].join('\r\n');
}
