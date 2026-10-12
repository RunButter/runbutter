// Google Maps results through the operator's OWN scraper.
//
// RunButter does not scrape Google. gosom/google-maps-scraper (MIT) is a
// separate service an operator may choose to run — a Docker container on
// their own network — and this file only talks to its REST API: create a job,
// poll it, download its CSV. Off unless GMAPS_SCRAPER_URL is set.
//
// Why it is opt-in and said plainly on the screen: scraping Google Maps is
// against Google's terms. Whoever runs the scraper takes that on, which is why
// the choice belongs to the operator (an env var), never to a default.
//
// A job takes minutes, so the browser starts one and comes back for it. Jobs
// live on the scraper, not in our database, and are tied to the person who
// started them by an HMAC of their id in the job NAME — so a job id seen in
// someone else's URL is useless to them.
import { createHmac } from 'node:crypto';
import { parseCSV } from '@/lib/crm/csv';
import { cleanEmail, cleanPhone, cleanWebsite, type FoundPlace } from './osm';

const BASE = (process.env.GMAPS_SCRAPER_URL || '').replace(/\/$/, '');
const TOKEN = process.env.GMAPS_SCRAPER_TOKEN || '';

export const gmapsEnabled = () => !!BASE;

/** Per-person job prefix. Stable, unguessable without the server secret. */
export function jobPrefix(user: string): string {
  const key = process.env.SECRETS_MASTER_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'runbutter';
  return 'rb-' + createHmac('sha256', key).update(`gmaps:${user}`).digest('hex').slice(0, 16);
}

const headers = () => ({
  'content-type': 'application/json', accept: 'application/json',
  ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
});

export class GmapsError extends Error {}

export async function startGmapsJob(user: string, q: { query: string; lang: string; lat?: number; lon?: number }): Promise<string> {
  if (!BASE) throw new GmapsError('Google Maps search is not set up on this server.');
  const body = {
    name: `${jobPrefix(user)}-${Date.now()}`,
    keywords: [q.query.slice(0, 200)],
    lang: /^[a-z]{2}$/.test(q.lang) ? q.lang : 'en',
    zoom: 14,
    lat: q.lat !== undefined ? q.lat.toFixed(6) : '',
    lon: q.lon !== undefined ? q.lon.toFixed(6) : '',
    depth: 3,
    email: false, // our own website reader does this, robots.txt and all
    max_time: 300,
  };
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/v1/jobs`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  } catch { throw new GmapsError('The Google Maps scraper did not answer. Is it running?'); }
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.id) throw new GmapsError(j?.message || `The Google Maps scraper answered ${res.status}.`);
  return String(j.id);
}

export type GmapsJob =
  | { status: 'pending' | 'working' }
  | { status: 'ok'; results: FoundPlace[] }
  | { status: 'failed'; error: string };

export async function readGmapsJob(user: string, id: string, fallbackCountry = ''): Promise<GmapsJob> {
  if (!BASE) throw new GmapsError('Google Maps search is not set up on this server.');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new GmapsError('Not a job id.');
  let job: any;
  try {
    const res = await fetch(`${BASE}/api/v1/jobs/${id}`, { headers: headers(), signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) throw new GmapsError('That search no longer exists on the scraper.');
    job = await res.json();
  } catch (e) {
    if (e instanceof GmapsError) throw e;
    throw new GmapsError('The Google Maps scraper did not answer.');
  }
  // Someone else's job is reported exactly like a missing one.
  const name = String(job?.Name ?? job?.name ?? '');
  if (!name.startsWith(jobPrefix(user) + '-')) throw new GmapsError('That search no longer exists on the scraper.');
  const status = String(job?.Status ?? job?.status ?? '');
  if (status === 'pending' || status === 'working') return { status };
  if (status === 'failed') return { status: 'failed', error: 'The scraper could not finish this search. Try again, or a smaller area.' };

  let csv = '';
  try {
    const res = await fetch(`${BASE}/api/v1/jobs/${id}/download`, { headers: { ...headers(), accept: 'text/csv' }, signal: AbortSignal.timeout(30_000) });
    csv = res.ok ? await res.text() : '';
  } catch { /* reported below */ }
  if (!csv) return { status: 'failed', error: 'The search finished but its results could not be downloaded.' };
  return { status: 'ok', results: parseGmapsCsv(csv, fallbackCountry) };
}

const num = (v: string) => { const n = Number(String(v || '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) && String(v || '').trim() ? n : undefined; };

/** The scraper's CSV (its documented 36 columns, any order) as leads. */
export function parseGmapsCsv(text: string, fallbackCountry = ''): FoundPlace[] {
  const { headers: h, rows } = parseCSV(text.replace(/^﻿/, ''));
  const col = (name: string) => h.findIndex((x) => x.toLowerCase() === name);
  const at = (r: string[], name: string) => { const i = col(name); return i >= 0 ? (r[i] || '').trim() : ''; };
  const out: FoundPlace[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const name = at(r, 'title');
    if (!name) continue;
    // A business Google marks closed for good is not a lead.
    if (/permanently closed|closed permanently/i.test(at(r, 'status'))) continue;
    let ca: any = {};
    try { ca = JSON.parse(at(r, 'complete_address') || '{}') || {}; } catch { ca = {}; }
    const id = at(r, 'place_id') || at(r, 'cid') || at(r, 'data_id') || at(r, 'link');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const link = at(r, 'link');
    const emails = at(r, 'emails').split(/[,;\s]+/).map((e) => cleanEmail(e)).filter(Boolean);
    out.push({
      ref: `google/${id}`,
      url: /^https:\/\/(www\.)?google\.[a-z.]+\/maps/i.test(link) ? link : `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(id)}`,
      name: name.slice(0, 200),
      category: at(r, 'category').slice(0, 80),
      address: at(r, 'address').slice(0, 300),
      city: String(ca.city || '').slice(0, 120),
      postcode: String(ca.postal_code || '').slice(0, 20),
      country: String(ca.country || fallbackCountry || '').slice(0, 2).toUpperCase(),
      phone: cleanPhone(at(r, 'phone')),
      email: emails[0] || '',
      website: cleanWebsite(at(r, 'website')),
      opening_hours: '',
      facebook: '', instagram: '',
      lat: num(at(r, 'latitude')) ?? 0,
      lon: num(at(r, 'longitude')) ?? 0,
      rating: num(at(r, 'review_rating')),
      reviews: num(at(r, 'review_count')),
    });
  }
  return out.sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0));
}
