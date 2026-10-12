// GLEIF — the global register of Legal Entity Identifiers.
//
// Every company that trades securities, borrows from a bank in the EU or
// reports derivatives has an LEI, and GLEIF publishes the whole register free,
// keyless and CC0 (no attribution, storable). It covers every country, so it
// is the one source here that answers "what is the legal name and registered
// address of this company?" for a German GmbH, a Spanish S.L. or a US Inc. by
// NAME — the question VIES refuses for Germany.
//
// It does NOT cover every company: a two-person agency rarely has an LEI. So it
// is the fallback after the tax registers and the company's own website, and a
// near-miss name is never accepted — the wrong company's address in a CRM is
// worse than a blank one.

const API = 'https://api.gleif.org/api/v1';
const UA = 'RunButter/1.0 (+https://runbutter.app; company lookup)';

export interface GleifEntity {
  lei: string;
  name: string;
  address: string;
  country: string;
  /** "HRB 6684 (RA000242)" — the local register number, and GLEIF's code for the register. */
  register?: string;
  status: string;
}

const LEGAL_FORMS = /\b(gmbh\s*&\s*co\.?\s*kg|gmbh|ag|se|kg|ohg|ug|ltd|limited|llc|inc|plc|s\.?a\.?s?|s\.?l\.?|s\.?p\.?a\.?|s\.?r\.?l\.?|b\.?v\.?|n\.?v\.?|sp\.?\s*z\s*o\.?\s*o\.?|spółka.*|oy|ab|aps|a\/s|as|corp(oration)?|co)\b\.?/gi;

/** "ACME GmbH & Co. KG" and "Acme" compare equal: lower-case, legal form and punctuation removed. */
export const comparable = (s: string) =>
  String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(LEGAL_FORMS, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

export function parseGleifRecord(rec: any): GleifEntity | null {
  const a = rec?.attributes;
  const e = a?.entity;
  if (!a?.lei || !e?.legalName?.name) return null;
  const addr = e.legalAddress || e.headquartersAddress || {};
  const lines = Array.isArray(addr.addressLines) ? addr.addressLines.filter(Boolean) : [];
  const town = [addr.postalCode, addr.city].filter(Boolean).join(' ');
  return {
    lei: a.lei,
    name: e.legalName.name,
    address: [...lines, town].filter(Boolean).join(', '),
    country: String(addr.country || e.jurisdiction || '').slice(0, 2).toUpperCase(),
    register: e.registeredAs ? `${e.registeredAs}${e.registeredAt?.id ? ` (${e.registeredAt.id})` : ''}` : undefined,
    status: String(e.status || ''),
  };
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: 'application/vnd.api+json', 'user-agent': UA }, signal: AbortSignal.timeout(10_000) });
  return res.ok ? res.json().catch(() => null) : null;
}

/**
 * The company with this name, in this country if given — or nothing. Accepted
 * only when the names are the same once legal forms and punctuation are
 * ignored, or the register's name starts with the typed one AND it is the only
 * such match. An ACTIVE entity is preferred over a lapsed one.
 */
export async function gleifByName(name: string, country?: string): Promise<GleifEntity | null> {
  const q = String(name || '').trim().slice(0, 120);
  if (comparable(q).length < 2) return null;
  const params = new URLSearchParams({ 'filter[entity.legalName]': q, 'page[size]': '10' });
  if (country) params.set('filter[entity.legalAddress.country]', country.toUpperCase());
  let rows: any[] = [];
  try {
    const exact = await getJson(`${API}/lei-records?${params}`);
    rows = Array.isArray(exact?.data) ? exact.data : [];
    if (!rows.length) {
      // Not the exact legal name: the register's own fuzzy search, then the
      // records it points at.
      const fz = await getJson(`${API}/fuzzycompletions?${new URLSearchParams({ field: 'entity.legalName', q })}`);
      const ids: string[] = (Array.isArray(fz?.data) ? fz.data : [])
        .map((d: any) => d?.relationships?.['lei-records']?.data?.id).filter(Boolean).slice(0, 5);
      if (ids.length) {
        const recs = await getJson(`${API}/lei-records?${new URLSearchParams({ 'filter[lei]': ids.join(','), 'page[size]': '5' })}`);
        rows = Array.isArray(recs?.data) ? recs.data : [];
      }
    }
  } catch { return null; }

  const want = comparable(q);
  const found = rows.map(parseGleifRecord).filter(Boolean) as GleifEntity[];
  const inCountry = found.filter((f) => !country || f.country === country.toUpperCase());
  const same = inCountry.filter((f) => comparable(f.name) === want);
  const pick = (xs: GleifEntity[]) => xs.find((x) => /active/i.test(x.status)) ?? xs[0];
  if (same.length) return pick(same);
  const starts = inCountry.filter((f) => comparable(f.name).startsWith(want));
  return starts.length === 1 ? starts[0] : null;
}
