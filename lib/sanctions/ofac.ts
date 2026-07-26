// OFAC list ingest — download, parse, reshape.
//
// The US Treasury publishes the SDN and Consolidated lists as plain CSV in the
// public domain: no key, no licence, no per-query fee. That is the entire
// reason this feature can exist for free, and why we ingest the raw files
// rather than calling a screening API (every hosted one meters per query AND
// requires a commercial data licence).
//
// FILE SHAPES (all header-less, "-0-" means null):
//   <PRIM>.CSV  ent_num, name, type, program, title, call_sign, vess_type,
//               tonnage, grt, vess_flag, vess_owner, remarks
//   <ALT>.CSV   ent_num, alt_num, alt_type, alt_name, alt_remarks
//   <ADD>.CSV   ent_num, add_num, address, city_state_zip, country, remarks
// Aliases and addresses are separate files keyed by ent_num, so all three are
// fetched and joined in memory before writing.

import { parseCSVRows } from '@/lib/crm/csv';

export interface OfacSource {
  source: string;
  label: string;
  files: { prim: string; alt: string; add: string };
}

// The Sanctions List Service replaced the old treasury.gov/ofac/downloads paths
// in May 2024. The legacy host still redirects, so it stays as a fallback —
// a compliance list that silently stops updating is the failure mode to avoid.
const SLS = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports';
const LEGACY = 'https://www.treasury.gov/ofac/downloads';

export const OFAC_SOURCES: OfacSource[] = [
  {
    source: 'ofac_sdn',
    label: 'OFAC — Specially Designated Nationals',
    files: { prim: 'SDN.CSV', alt: 'ALT.CSV', add: 'ADD.CSV' },
  },
  {
    source: 'ofac_consolidated',
    label: 'OFAC — Consolidated (non-SDN)',
    files: { prim: 'CONS_PRIM.CSV', alt: 'CONS_ALT.CSV', add: 'CONS_ADD.CSV' },
  },
];

const legacyPath = (file: string) =>
  file.startsWith('CONS_')
    ? `${LEGACY}/consolidated/${file.toLowerCase()}`
    : `${LEGACY}/${file.toLowerCase()}`;

/** OFAC writes "-0-" where a field is absent. */
const clean = (v: string | undefined): string => {
  const s = String(v ?? '').trim();
  return s === '-0-' ? '' : s;
};

/**
 * Fetch one list file.
 *
 * The SLS host returns 403 to requests without a User-Agent — an explicit,
 * documented requirement, and the single most common reason an OFAC ingest
 * silently returns nothing.
 */
export async function fetchOfacFile(file: string, signal?: AbortSignal): Promise<string> {
  const urls = [`${SLS}/${file}`, legacyPath(file)];
  let lastError = '';
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        signal,
        headers: {
          'user-agent': 'RunButter/1.0 (+https://runbutter.app)',
          accept: 'text/csv,text/plain,*/*',
        },
        cache: 'no-store',
      });
      if (!res.ok) { lastError = `${url} → HTTP ${res.status}`; continue; }
      const text = await res.text();
      // A 200 that's actually an error page or an empty publication is worse
      // than a failure, because it would wipe the list via stale-row cleanup.
      if (text.length < 1000) { lastError = `${url} → suspiciously small response (${text.length} bytes)`; continue; }
      return text;
    } catch (e: any) {
      lastError = `${url} → ${e?.message || 'request failed'}`;
    }
  }
  throw new Error(`Could not download ${file}. ${lastError}`);
}

export interface OfacEntity {
  source: string;
  source_uid: string;
  name: string;
  entity_type: string | null;
  programs: string[];
  aliases: string[];
  addresses: string[];
  countries: string[];
  remarks: string | null;
}

/** OFAC's type column is blank for organisations; everything else is explicit. */
function entityType(raw: string): string {
  const t = clean(raw).toLowerCase();
  if (t.startsWith('individual')) return 'individual';
  if (t.startsWith('vessel')) return 'vessel';
  if (t.startsWith('aircraft')) return 'aircraft';
  return 'entity';
}

/** Programs arrive as "UKRAINE-EO13662; RUSSIA-EO14024". */
function programs(raw: string): string[] {
  return clean(raw).split(/[;,]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Join the three files into one entity per ent_num.
 *
 * Rows whose ent_num isn't numeric are dropped: OFAC appends a trailing
 * publication-metadata line to these files, and it would otherwise be ingested
 * as a sanctioned party.
 */
export function buildEntities(src: OfacSource, primCsv: string, altCsv: string, addCsv: string): OfacEntity[] {
  const aliases = new Map<string, string[]>();
  for (const r of parseCSVRows(altCsv)) {
    const uid = clean(r[0]);
    const name = clean(r[3]);
    if (!/^\d+$/.test(uid) || !name) continue;
    const list = aliases.get(uid) ?? [];
    if (!list.includes(name)) list.push(name);
    aliases.set(uid, list);
  }

  const addresses = new Map<string, string[]>();
  const countries = new Map<string, Set<string>>();
  for (const r of parseCSVRows(addCsv)) {
    const uid = clean(r[0]);
    if (!/^\d+$/.test(uid)) continue;
    const line = [clean(r[2]), clean(r[3]), clean(r[4])].filter(Boolean).join(', ');
    if (line) {
      const list = addresses.get(uid) ?? [];
      if (!list.includes(line)) list.push(line);
      addresses.set(uid, list);
    }
    const country = clean(r[4]);
    if (country) {
      const set = countries.get(uid) ?? new Set<string>();
      set.add(country);
      countries.set(uid, set);
    }
  }

  const out: OfacEntity[] = [];
  const seen = new Set<string>();
  for (const r of parseCSVRows(primCsv)) {
    const uid = clean(r[0]);
    const name = clean(r[1]);
    if (!/^\d+$/.test(uid) || !name) continue;
    if (seen.has(uid)) continue;              // upsert would reject the duplicate key
    seen.add(uid);
    out.push({
      source: src.source,
      source_uid: uid,
      name,
      entity_type: entityType(r[2]),
      programs: programs(r[3]),
      aliases: aliases.get(uid) ?? [],
      addresses: addresses.get(uid) ?? [],
      countries: [...(countries.get(uid) ?? [])],
      remarks: clean(r[11]) || null,
    });
  }
  return out;
}
