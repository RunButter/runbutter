'use client';

// The browser half of "fill in from the tax number": calling the route, turning
// what the registers said into form values, and adding the board as people.
// Writes go through the ordinary createRecord, so the plan limit, tenancy and
// automations apply exactly as they would to a person typed in by hand.
import { createRecord, getRecord } from '@/lib/crm/data';
import type { CompanyFacts, CompanyPerson } from './lookup';
import { printedTaxId } from './ids';

export type { CompanyFacts, CompanyPerson };

type LookupIn = { country?: string; taxId?: string; website?: string; name?: string; candidates?: string[] };

export async function fetchCompany(input: LookupIn): Promise<{ company?: CompanyFacts; error?: string }> {
  try {
    const { getAccessToken } = await import('@privy-io/react-auth');
    const token = await getAccessToken().catch(() => null);
    const res = await fetch('/api/company-lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
      body: JSON.stringify(input),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) return { error: j?.error || `The lookup failed (${res.status}).` };
    return { company: j.company as CompanyFacts };
  } catch {
    return { error: 'Could not reach the server. Check your connection.' };
  }
}

/**
 * The whole "Fill in": the registers first (server), then — when they left the
 * name or address blank — a web search IN THIS BROWSER for the number as it is
 * printed (lib/company/websearch.ts), whose company sites go back to the server
 * as `candidates`. The server reads a site only when its legal notice prints
 * that exact number, so a search result can lead to a company and never
 * invent one. Searching here means each person uses their own free search
 * allowance, and nothing about the search passes through our server.
 */
export async function fillCompany(input: LookupIn, onStep?: (step: string) => void): Promise<{ company?: CompanyFacts; error?: string }> {
  const first = await fetchCompany(input);
  const f = first.company;
  const typedName = String(input.name || '').trim();

  // A name the registers do not know: look for the company's own site by name.
  if (!f && typedName && !String(input.taxId || '').trim() && !String(input.website || '').trim()) {
    try {
      onStep?.('Searching the web for its website…');
      const W = await import('./websearch');
      const sites = W.ownSites(await W.searchWeb(`"${typedName}" Impressum OR "legal notice" OR imprint`, { limit: 8 }));
      if (sites.length) {
        const r = await fetchCompany({ ...input, candidates: sites });
        if (r.company?.site_verified) return r;
      }
    } catch { /* the register's answer stands */ }
    return first;
  }

  if (!f || f.site_verified || String(input.website || '').trim()) return first;
  if (!f.tax_id || (f.name && f.address) || ['PL', 'US', 'BR'].includes(f.country)) return first;

  const printed = printedTaxId(f.country === 'GR' ? 'EL' : f.country, f.tax_id);
  const tried = new Set<string>();
  const verify = async (sites: string[]) => {
    const fresh = sites.filter((x) => !tried.has(x));
    fresh.forEach((x) => tried.add(x));
    if (!fresh.length) return null;
    onStep?.(`Reading ${fresh.length === 1 ? 'a website' : `${fresh.length} websites`} for ${printed}…`);
    const r = await fetchCompany({ ...input, candidates: fresh });
    return r.company?.site_verified ? r : null;
  };
  try {
    const W = await import('./websearch');
    onStep?.(`Searching the web for ${printed}…`);
    const hits = await W.searchWeb(`"${printed}"`);
    const found = await verify(W.ownSites(hits));
    if (found) return found;
    // Directories that copied the number usually name the company in their
    // title; that name plus "Impressum" finds the company's own site.
    const names = [...new Set([f.name, ...W.nameHints(hits)].filter(Boolean) as string[])].slice(0, 2);
    for (const n of names) {
      onStep?.(`Searching the web for ${n}…`);
      const more = await verify(W.ownSites(await W.searchWeb(W.legalQuery(n, f.country), { limit: 6 })));
      if (more) return more;
    }
    return { company: { ...f, web_hits: hits.slice(0, 6) } }; // listed only while the address is missing
  } catch (e: any) {
    return { company: { ...f, notes: [...f.notes, `The web search could not run (${String(e?.message || e)}).`] } };
  }
}

/** What the REGISTER is the authority on replaces what was typed; contact details only fill blanks. */
const AUTHORITATIVE = ['name', 'address', 'regon', 'krs', 'bank_account'] as const;
const FILL_BLANKS = ['email', 'phone', 'website', 'industry'] as const;

export function valuesFromFacts(f: CompanyFacts, current: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { country: f.country || current.country, tax_id: f.tax_id || current.tax_id };
  for (const k of AUTHORITATIVE) if ((f as any)[k]) out[k] = (f as any)[k];
  for (const k of FILL_BLANKS) if ((f as any)[k] && !String(current[k] ?? '').trim()) out[k] = (f as any)[k];
  return out;
}

/** Columns 0133 adds. Used to notice a database that has not run it, rather than dropping them silently. */
export const COMPANY_CONTACT_KEYS = ['phone', 'email', 'website', 'regon', 'krs', 'bank_account'];

export async function companyColumnsMissing(privy: string, id: string, values: Record<string, any>): Promise<boolean> {
  if (!COMPANY_CONTACT_KEYS.some((k) => String(values[k] ?? '').trim())) return false;
  const rec = await getRecord(privy, 'companies', id);
  return !!rec && !('website' in rec);
}

/** The board, as people at this company. Their role becomes the title; the source says where they came from. */
export async function addBoardAsPeople(privy: string, companyId: string, people: CompanyPerson[], source = 'KRS'): Promise<{ added: number; error?: string }> {
  let added = 0;
  for (const p of people) {
    const r = await createRecord(privy, 'people', {
      first_name: p.first_name, last_name: p.last_name, title: p.role,
      // Where they came from: the court register, or the company's own legal notice.
      primary_company_id: companyId, source: /website/i.test(source) ? 'Company website' : source.split(' (')[0],
    });
    if (r.error) return { added, error: r.error };
    added++;
  }
  return { added };
}

export const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
