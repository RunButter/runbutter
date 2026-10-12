'use client';

// The browser half of "fill in from the tax number": calling the route, turning
// what the registers said into form values, and adding the board as people.
// Writes go through the ordinary createRecord, so the plan limit, tenancy and
// automations apply exactly as they would to a person typed in by hand.
import { createRecord, getRecord } from '@/lib/crm/data';
import type { CompanyFacts, CompanyPerson } from './lookup';

export type { CompanyFacts, CompanyPerson };

export async function fetchCompany(country: string, taxId: string): Promise<{ company?: CompanyFacts; error?: string }> {
  try {
    const { getAccessToken } = await import('@privy-io/react-auth');
    const token = await getAccessToken().catch(() => null);
    const res = await fetch('/api/company-lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
      body: JSON.stringify({ country, taxId }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) return { error: j?.error || `The lookup failed (${res.status}).` };
    return { company: j.company as CompanyFacts };
  } catch {
    return { error: 'Could not reach the server. Check your connection.' };
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
export async function addBoardAsPeople(privy: string, companyId: string, people: CompanyPerson[]): Promise<{ added: number; error?: string }> {
  let added = 0;
  for (const p of people) {
    const r = await createRecord(privy, 'people', {
      first_name: p.first_name, last_name: p.last_name, title: p.role,
      primary_company_id: companyId, source: 'KRS',
    });
    if (r.error) return { added, error: r.error };
    added++;
  }
  return { added };
}

export const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
