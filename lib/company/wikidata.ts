// Wikidata — VAT number → company, for the companies notable enough to have an
// item. Property P3608 is "EU VAT number", so a search for the statement
// `haswbstatement:P3608=DE123456789` answers the one question VIES refuses for
// Germany: whose number is this? It covers the larger companies (the ones most
// likely to be typed into a CRM first), not the corner bakery — the Peppol
// directory and the company's own legal notice do the rest.
//
// CC0, keyless, and asks only for a descriptive User-Agent. Two small calls:
// the search, then the item. Nothing here is guessed: the item is used only
// when its own P3608 statement is the number asked for.

const API = 'https://www.wikidata.org/w/api.php';
const UA = 'RunButter/1.0 (+https://runbutter.app; company lookup)';

export interface WikidataCompany {
  qid: string;
  name: string;
  website?: string;
  /** Legal Entity Identifier, when the item has one — GLEIF then gives the registered address. */
  lei?: string;
  address?: string;
}

async function getJson(params: Record<string, string>): Promise<any> {
  const res = await fetch(`${API}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2' })}`, {
    headers: { accept: 'application/json', 'user-agent': UA },
    signal: AbortSignal.timeout(8_000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Statements of one property that are not deprecated, preferred ones first. */
function values(entity: any, prop: string): any[] {
  const claims: any[] = Array.isArray(entity?.claims?.[prop]) ? entity.claims[prop] : [];
  return claims
    .filter((c) => c?.rank !== 'deprecated' && c?.mainsnak?.snaktype === 'value')
    .sort((a, b) => (b.rank === 'preferred' ? 1 : 0) - (a.rank === 'preferred' ? 1 : 0))
    .map((c) => c.mainsnak.datavalue?.value)
    .filter((v) => v !== undefined && v !== null);
}

const compact = (s: unknown) => String(s ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();

/** One Wikidata item as company facts, or null when its VAT statement is not `vat`. */
export function wikidataCompany(entity: any, vat: string): WikidataCompany | null {
  if (!entity?.id) return null;
  if (!values(entity, 'P3608').some((v) => compact(v) === compact(vat))) return null;
  const text = (v: any) => (typeof v === 'string' ? v : v?.text ? String(v.text) : '');
  const official = values(entity, 'P1448').map(text).filter(Boolean);
  const labels = entity.labels || {};
  const name = (official[0] || labels.de?.value || labels.en?.value || Object.values<any>(labels)[0]?.value || '').trim();
  if (!name) return null;
  const site = values(entity, 'P856').map(String).find((u) => /^https?:\/\//i.test(u));
  const lei = values(entity, 'P1278').map(String).find((v) => /^[0-9A-Z]{20}$/.test(v));
  const street = values(entity, 'P6375').map(text).find(Boolean);
  const postcode = values(entity, 'P281').map(String).find(Boolean);
  return {
    qid: entity.id,
    name: name.slice(0, 200),
    website: site,
    lei,
    address: street ? [street, postcode].filter(Boolean).join(', ').slice(0, 300) : undefined,
  };
}

/** The company whose EU VAT number (P3608) is `vat` ("DE123456789"), or null. Throws when Wikidata could not be asked. */
export async function wikidataByVat(vat: string): Promise<WikidataCompany | null> {
  const v = compact(vat);
  if (!/^[A-Z]{2}[0-9A-Z]{2,13}$/.test(v)) return null;
  const found = await getJson({ action: 'query', list: 'search', srsearch: `haswbstatement:P3608=${v}`, srlimit: '3', srnamespace: '0' });
  const ids: string[] = (Array.isArray(found?.query?.search) ? found.query.search : [])
    .map((r: any) => String(r?.title || '')).filter((t: string) => /^Q\d+$/.test(t));
  if (!ids.length) return null;
  const got = await getJson({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|claims', languages: 'de|en' });
  const entities = got?.entities && typeof got.entities === 'object' ? Object.values<any>(got.entities) : [];
  for (const e of entities) {
    const c = wikidataCompany(e, v);
    if (c) return c;
  }
  return null;
}
