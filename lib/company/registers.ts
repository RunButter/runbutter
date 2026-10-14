// National company registers that answer for free, with no key.
//
// VIES confirms an EU VAT number and — where the member state shares it —
// names the company. These are the registers BEHIND it, each the authority for
// its own country, plus the ones for countries VIES does not cover:
//
//   FR  recherche-entreprises.api.gouv.fr   SIREN (inside every FR VAT number)
//   CZ  ARES (Ministry of Finance)          IČO   (= the CZ VAT number for companies)
//   NO  Brønnøysund Enhetsregisteret        org.nr (NO…MVA)
//   FI  PRH / YTJ open data                 Y-tunnus (inside FI VAT numbers)
//   RO  ANAF                                CUI   (= the RO VAT number)
//   EE  e-Business Register                 registry code
//   CH  UID register (Federal Statistical Office), SOAP   CHE-…
//   US  SEC EDGAR (public companies, by EIN or name) and ProPublica (nonprofits, by EIN)
//   BR  BrasilAPI over the Receita Federal open data      CNPJ
//
// Every one was called live while this was written (2026-10) and the parsers
// follow the shapes that came back. Each function returns the facts it is the
// authority on, or null for "not in this register"; it throws only when the
// register could not be asked, so the caller can say which one was down.
//
// SERVER and BROWSER safe (fetch only). No personal data is sent anywhere.
import type { CompanyFacts, CompanyPerson } from './lookup';
import { cleanEmail, cleanPhone, cleanWebsite } from '@/lib/leads/osm';

const UA = 'RunButter/1.0 (+https://runbutter.app; company lookup)';
export type Found = Partial<CompanyFacts> & { source: string };

async function get(url: string, init: RequestInit = {}, timeout = 10_000): Promise<{ status: number; json: any; text: string; retryAfter?: number }> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', 'user-agent': UA, ...(init.headers || {}) },
    signal: AbortSignal.timeout(timeout),
    cache: 'no-store',
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* XML or HTML */ }
  return { status: res.status, json, text, retryAfter: Number(res.headers.get('retry-after')) || undefined };
}

/** One retry after a short Retry-After — the French register answers 429 to bursts. */
async function getPolite(url: string, init: RequestInit = {}) {
  const r = await get(url, init);
  if (r.status === 429 && (r.retryAfter ?? 5) <= 6) {
    await new Promise((ok) => setTimeout(ok, (r.retryAfter ?? 2) * 1000));
    return get(url, init);
  }
  return r;
}

const fail = (name: string, status: number) => new Error(`${name} answered HTTP ${status}`);
const str = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const title = (s: string) => s.toLowerCase().replace(/(^|[\s\-/'(])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
const person = (first: string, last: string, role: string): CompanyPerson | null => {
  const f = title(str(first)), l = title(str(last));
  return f && l ? { first_name: f, last_name: l, role: str(role) } : null;
};

// ── France ───────────────────────────────────────────────────────────────────

/** FR VAT = FR + 2-character key + SIREN. The key is checked for the numeric form. */
export function sirenFromFrVat(id: string): string | null {
  const s = String(id || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (/^\d{9}$/.test(s)) return s;
  if (/^\d{14}$/.test(s)) return s.slice(0, 9); // a SIRET
  const m = /^([0-9A-Z]{2})(\d{9})$/.exec(s);
  if (!m) return null;
  if (/^\d{2}$/.test(m[1]) && Number(m[1]) !== (12 + 3 * (Number(m[2]) % 97)) % 97) return null;
  return m[2];
}

export function parseFrance(r: any): Found | null {
  if (!r?.siren) return null;
  const s = r.siege || {};
  const people = (Array.isArray(r.dirigeants) ? r.dirigeants : [])
    .filter((d: any) => d?.type_dirigeant === 'personne physique' || (d?.nom && d?.prenoms))
    .slice(0, 12)
    .map((d: any) => person(String(d.prenoms || '').split(/\s+/)[0], d.nom, d.qualite || ''))
    .filter(Boolean) as CompanyPerson[];
  return {
    source: 'French company register (INSEE / INPI)',
    name: str(r.nom_raison_sociale || r.nom_complet) || undefined,
    address: str(s.adresse) || undefined,
    krs: `SIREN ${r.siren}`,
    industry: str(r.libelle_activite_principale || s.libelle_activite_principale) || undefined,
    people,
    notes: r.etat_administratif === 'C' ? ['The French register lists this company as CLOSED (cessée).'] : [],
  } as Found;
}

export async function franceBySiren(siren: string): Promise<Found | null> {
  const r = await getPolite(`https://recherche-entreprises.api.gouv.fr/search?q=${siren}&per_page=3`);
  if (r.status !== 200) throw fail('The French register', r.status);
  const hit = (Array.isArray(r.json?.results) ? r.json.results : []).find((x: any) => x?.siren === siren);
  return hit ? parseFrance(hit) : null;
}

export async function franceByName(name: string): Promise<any[]> {
  const r = await getPolite(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(name)}&per_page=5`);
  if (r.status !== 200) throw fail('The French register', r.status);
  return Array.isArray(r.json?.results) ? r.json.results : [];
}

// ── Czechia ──────────────────────────────────────────────────────────────────

const ARES = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty';

export function parseCzech(s: any): Found | null {
  if (!s?.ico || !s?.obchodniJmeno) return null;
  return {
    source: 'ARES (Czech business register)',
    name: str(s.obchodniJmeno),
    address: str(s.sidlo?.textovaAdresa) || undefined,
    krs: `IČO ${s.ico}`,
    notes: s.seznamRegistraci?.stavZdrojeVr === 'ZANIKLY' ? ['ARES lists the company register entry as dissolved.'] : [],
  } as Found;
}

export async function czechByIco(ico: string): Promise<Found | null> {
  const id = String(ico).padStart(8, '0');
  if (!/^\d{8}$/.test(id)) return null;
  const r = await get(`${ARES}/${id}`);
  if (r.status === 404) return null;
  if (r.status !== 200) throw fail('ARES', r.status);
  return parseCzech(r.json);
}

export async function czechByName(name: string): Promise<any[]> {
  const r = await get(`${ARES}/vyhledat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ obchodniJmeno: name, pocet: 5 }) });
  if (r.status !== 200) throw fail('ARES', r.status);
  return Array.isArray(r.json?.ekonomickeSubjekty) ? r.json.ekonomickeSubjekty : [];
}

// ── Norway ───────────────────────────────────────────────────────────────────

const BRREG = 'https://data.brreg.no/enhetsregisteret/api/enheter';

export function parseNorway(e: any): Found | null {
  if (!e?.organisasjonsnummer || !e?.navn) return null;
  const a = e.forretningsadresse || e.postadresse || {};
  const address = [...(Array.isArray(a.adresse) ? a.adresse : []), [a.postnummer, a.poststed].filter(Boolean).join(' ')]
    .map(str).filter(Boolean).join(', ');
  const notes: string[] = [];
  if (e.konkurs) notes.push('The Norwegian register lists this company as BANKRUPT (konkurs).');
  if (e.underAvvikling || e.underTvangsavviklingEllerTvangsopplosning) notes.push('The Norwegian register lists this company as being wound up.');
  return {
    source: 'Brønnøysund Register Centre (Norway)',
    name: str(e.navn),
    address: address || undefined,
    krs: `Org.nr ${e.organisasjonsnummer}`,
    website: cleanWebsite(str(e.hjemmeside)) || undefined,
    email: cleanEmail(str(e.epostadresse)) || undefined,
    phone: cleanPhone(str(e.telefon || e.mobil)) || undefined,
    industry: str(e.naeringskode1?.beskrivelse) || undefined,
    legal_form: str(e.organisasjonsform?.beskrivelse) || undefined,
    vat_status: e.registrertIMvaregisteret === true ? 'In the VAT register (MVA)' : e.registrertIMvaregisteret === false ? 'Not in the VAT register' : undefined,
    vat_active: typeof e.registrertIMvaregisteret === 'boolean' ? e.registrertIMvaregisteret : undefined,
    notes,
  } as Found;
}

export async function norwayByOrgnr(orgnr: string): Promise<Found | null> {
  if (!/^\d{9}$/.test(orgnr)) return null;
  const r = await get(`${BRREG}/${orgnr}`);
  if (r.status === 404 || r.status === 410) return null;
  if (r.status !== 200) throw fail('Brønnøysund', r.status);
  return parseNorway(r.json);
}

export async function norwayByName(name: string): Promise<any[]> {
  const r = await get(`${BRREG}?navn=${encodeURIComponent(name)}&size=5`);
  if (r.status !== 200) throw fail('Brønnøysund', r.status);
  return Array.isArray(r.json?._embedded?.enheter) ? r.json._embedded.enheter : [];
}

// ── Finland ──────────────────────────────────────────────────────────────────

const PRH = 'https://avoindata.prh.fi/opendata-ytj-api/v3/companies';

/** FI12345678 → 1234567-8 */
export const finnishId = (id: string) => { const d = String(id).replace(/\D/g, ''); return d.length === 8 ? `${d.slice(0, 7)}-${d.slice(7)}` : ''; };

const fiText = (list: any, lang = ['en', 'fi', 'sv']) => {
  const xs: any[] = Array.isArray(list) ? list : [];
  for (const l of lang) {
    const hit = xs.find((d) => String(d?.languageCode ?? d?.language ?? '').toLowerCase() === l || d?.languageCode === { en: '3', fi: '1', sv: '2' }[l]);
    if (hit?.description) return str(hit.description);
  }
  return str(xs[0]?.description);
};

export function parseFinland(c: any): Found | null {
  const names: any[] = Array.isArray(c?.names) ? c.names : [];
  const current = names.find((n) => String(n?.type) === '1' && !n?.endDate) ?? names.find((n) => !n?.endDate) ?? names[0];
  if (!c?.businessId?.value || !current?.name) return null;
  const addrs: any[] = Array.isArray(c.addresses) ? c.addresses : [];
  const a = addrs.find((x) => String(x?.type) === '1') ?? addrs[0];
  const city = Array.isArray(a?.postOffices) ? str((a.postOffices.find((p: any) => String(p?.languageCode) === '1') ?? a.postOffices[0])?.city) : str(a?.city);
  const street = [a?.street, a?.buildingNumber, a?.entrance, a?.apartmentNumber].map(str).filter(Boolean).join(' ');
  const address = [street, [a?.postCode, city].map(str).filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const website = cleanWebsite(str(c.website?.url ?? c.website));
  return {
    source: 'Finnish Patent and Registration Office (YTJ)',
    name: str(current.name),
    address: address || undefined,
    krs: `Y-tunnus ${c.businessId.value}`,
    website: website || undefined,
    industry: fiText(c.mainBusinessLine?.descriptions) || undefined,
    legal_form: fiText((Array.isArray(c.companyForms) ? c.companyForms[0] : null)?.descriptions) || undefined,
    notes: c.status && String(c.status) !== '2' && c.endDate ? ['The Finnish register lists an end date for this company.'] : [],
  } as Found;
}

export async function finlandById(businessId: string): Promise<Found | null> {
  if (!/^\d{7}-\d$/.test(businessId)) return null;
  const r = await get(`${PRH}?businessId=${businessId}`);
  if (r.status === 404) return null;
  if (r.status !== 200) throw fail('The Finnish register (PRH)', r.status);
  const c = Array.isArray(r.json?.companies) ? r.json.companies[0] : null;
  return c ? parseFinland(c) : null;
}

export async function finlandByName(name: string): Promise<any[]> {
  const r = await get(`${PRH}?name=${encodeURIComponent(name)}`);
  if (r.status === 404) return [];
  if (r.status !== 200) throw fail('The Finnish register (PRH)', r.status);
  return Array.isArray(r.json?.companies) ? r.json.companies.slice(0, 5) : [];
}

// ── Romania ──────────────────────────────────────────────────────────────────

export function parseRomania(f: any): Found | null {
  const g = f?.date_generale;
  if (!g?.denumire) return null;
  const vat = f?.inregistrare_scop_Tva?.scpTVA;
  const inactive = f?.stare_inactiv?.statusInactivi === true;
  return {
    source: 'ANAF (Romanian tax authority)',
    name: str(g.denumire),
    address: str(g.adresa) || undefined,
    krs: str(g.nrRegCom) || undefined,
    phone: cleanPhone(str(g.telefon)) || undefined,
    legal_form: str(g.forma_juridica) ? title(str(g.forma_juridica)) : undefined,
    vat_status: typeof vat === 'boolean' ? (vat ? 'VAT payer (ANAF)' : 'Not a VAT payer (ANAF)') : undefined,
    vat_active: typeof vat === 'boolean' ? vat : undefined,
    notes: inactive ? ['ANAF lists this company as INACTIVE — check before invoicing.'] : [],
  } as Found;
}

export async function romaniaByCui(cui: string): Promise<Found | null> {
  if (!/^\d{2,10}$/.test(cui)) return null;
  const r = await get('https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify([{ cui: Number(cui), data: new Date().toISOString().slice(0, 10) }]),
  });
  if (r.status !== 200) throw fail('ANAF', r.status);
  const f = Array.isArray(r.json?.found) ? r.json.found[0] : null;
  return f ? parseRomania(f) : null;
}

// ── Estonia ──────────────────────────────────────────────────────────────────

export function parseEstonia(d: any): Found | null {
  if (!d?.reg_code || !d?.name) return null;
  return {
    source: 'Estonian e-Business Register',
    name: str(d.name),
    address: [str(d.legal_address), str(d.zip_code)].filter(Boolean).join(', ') || undefined,
    krs: `Registry code ${d.reg_code}`,
    notes: d.status && d.status !== 'R' ? ['The Estonian register does not list this company as active.'] : [],
  } as Found;
}

export async function estoniaSearch(q: string): Promise<any[]> {
  const r = await get(`https://ariregister.rik.ee/est/api/autocomplete?q=${encodeURIComponent(q)}`);
  if (r.status !== 200) throw fail('The Estonian register', r.status);
  return Array.isArray(r.json?.data) ? r.json.data : [];
}

export async function estoniaByCode(code: string): Promise<Found | null> {
  if (!/^\d{8}$/.test(code)) return null;
  const hit = (await estoniaSearch(code)).find((d) => String(d?.reg_code) === code);
  return hit ? parseEstonia(hit) : null;
}

// ── Switzerland ──────────────────────────────────────────────────────────────

const UID_WSE = 'https://www.uid-wse.admin.ch/V5.0/PublicServices.svc';
const xmlText = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
const tag = (xml: string, name: string) => { const m = new RegExp(`<${name}\\b[^>]*>([^<]*)</${name}>`).exec(xml); return m ? xmlText(m[1]).trim() : ''; };

const CH_FORMS: Record<string, string> = {
  '0101': 'Sole proprietorship', '0103': 'General partnership', '0104': 'Limited partnership',
  '0106': 'Aktiengesellschaft (AG / SA)', '0107': 'GmbH / Sàrl', '0108': 'Cooperative', '0109': 'Association', '0110': 'Foundation',
};

export function parseSwiss(xml: string): Found | null {
  const org = /<organisationType>([\s\S]*?)<\/organisationType>/.exec(xml)?.[1];
  if (!org) return null;
  const name = tag(org, 'organisationLegalName') || tag(org, 'organisationName');
  if (!name) return null;
  const addresses = org.match(/<address\b[\s\S]*?<\/address>/g) || [];
  const a = addresses.find((x) => tag(x, 'addressCategory') === 'LEGAL') ?? addresses[0] ?? '';
  const street = [tag(a, 'street'), tag(a, 'houseNumber')].filter(Boolean).join(' ');
  const town = [tag(a, 'swissZipCode'), tag(a, 'town')].filter(Boolean).join(' ');
  const hr = /<organisationIdCategory>CH\.HR<\/organisationIdCategory>\s*<organisationId>([^<]+)</.exec(org)?.[1];
  const status = tag(org, 'uidregStatusEnterpriseDetail');
  return {
    source: 'Swiss UID register (Federal Statistical Office)',
    name,
    address: [street, town].filter(Boolean).join(', ') || undefined,
    krs: hr ? `Commercial register ${hr}` : undefined,
    legal_form: CH_FORMS[tag(org, 'legalForm')] || undefined,
    notes: status && status !== '3' ? ['The UID register does not list this company as active.'] : [],
  } as Found;
}

export async function swissByUid(uid9: string): Promise<Found | null> {
  if (!/^\d{9}$/.test(uid9)) return null;
  const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:uid="http://www.uid.admin.ch/xmlns/uid-wse" xmlns:ech="http://www.ech.ch/xmlns/eCH-0097/5"><soap:Body><uid:GetByUID><uid:uid><ech:uidOrganisationIdCategorie>CHE</ech:uidOrganisationIdCategorie><ech:uidOrganisationId>${uid9}</ech:uidOrganisationId></uid:uid></uid:GetByUID></soap:Body></soap:Envelope>`;
  const r = await get(UID_WSE, {
    method: 'POST', body,
    headers: { 'content-type': 'text/xml; charset=utf-8', soapaction: '"http://www.uid.admin.ch/xmlns/uid-wse/IPublicServices/GetByUID"', accept: 'text/xml' },
  });
  if (r.status === 500 && /Fault/i.test(r.text)) return null; // unknown UID is a SOAP fault
  if (r.status !== 200) throw fail('The Swiss UID register', r.status);
  return parseSwiss(r.text);
}

// ── United States ────────────────────────────────────────────────────────────
// No national company register exists (companies are filed per state), and an
// EIN is not public. What IS public: every SEC filer (name, address, phone,
// state of incorporation — and its EIN, printed on its filings), and every
// tax-exempt organisation by EIN (IRS data via ProPublica). Everything else
// is found by name in GLEIF, or by its website.

const SEC_UA = process.env.SEC_USER_AGENT || 'RunButter company lookup (+https://runbutter.app)';

export function parseSec(s: any): Found | null {
  if (!s?.name) return null;
  const a = s.addresses?.business || s.addresses?.mailing || {};
  const address = [a.street1, a.street2, [a.city, a.stateOrCountry, a.zipCode].filter(Boolean).join(' ')].map(str).filter(Boolean).join(', ');
  return {
    source: 'SEC EDGAR',
    name: str(s.name),
    address: address || undefined,
    phone: cleanPhone(str(s.phone)) || undefined,
    website: cleanWebsite(str(s.website)) || undefined,
    industry: s.sicDescription ? str(s.sicDescription) : undefined,
    krs: s.cik ? `SEC CIK ${String(s.cik).replace(/^0+/, '')}${s.stateOfIncorporation ? ` · incorporated in ${s.stateOfIncorporation}` : ''}` : undefined,
  } as Found;
}

export async function secByCik(cik: string): Promise<any | null> {
  const r = await get(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`, { headers: { 'user-agent': SEC_UA } });
  if (r.status === 404) return null;
  if (r.status !== 200) throw fail('SEC EDGAR', r.status);
  return r.json;
}

export async function usByEin(ein: string): Promise<Found | null> {
  const d = String(ein).replace(/\D/g, '');
  if (!/^\d{9}$/.test(d)) return null;
  const dashed = `${d.slice(0, 2)}-${d.slice(2)}`;
  const [np, fts] = await Promise.allSettled([
    get(`https://projects.propublica.org/nonprofits/api/v2/organizations/${d}.json`),
    get(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${dashed}"`)}`, { headers: { 'user-agent': SEC_UA } }),
  ]);
  if (np.status === 'fulfilled' && np.value.status === 200 && np.value.json?.organization?.name) {
    const o = np.value.json.organization;
    return {
      source: 'IRS exempt organisations (ProPublica)',
      name: str(o.name),
      address: [str(o.address), [o.city, o.state, o.zipcode].map(str).filter(Boolean).join(' ')].filter(Boolean).join(', ') || undefined,
      krs: `EIN ${dashed}`,
      legal_form: 'Tax-exempt organisation',
    } as Found;
  }
  if (fts.status === 'fulfilled' && fts.value.status === 200) {
    const ciks = new Set<string>();
    for (const h of fts.value.json?.hits?.hits || []) for (const c of h?._source?.ciks || []) ciks.add(c);
    // The EIN is printed on the cover page of the filer's OWN filings — but a
    // filing can mention another company's EIN too, so the filer's submissions
    // must carry this exact EIN before it is believed.
    for (const cik of [...ciks].slice(0, 4)) {
      const s = await secByCik(cik).catch(() => null);
      if (s && String(s.ein || '') === d) return parseSec(s);
    }
  }
  if (np.status === 'rejected' && fts.status === 'rejected') throw new Error('SEC EDGAR and ProPublica did not answer');
  return null;
}

export async function usByName(name: string): Promise<Found | null> {
  const r = await get(`https://efts.sec.gov/LATEST/search-index?keysTyped=${encodeURIComponent(name)}`, { headers: { 'user-agent': SEC_UA } });
  if (r.status !== 200) throw fail('SEC EDGAR', r.status);
  const hits: any[] = r.json?.hits?.hits || [];
  return { source: 'SEC EDGAR', _candidates: hits.slice(0, 8).map((h) => ({ cik: String(h?._id || ''), name: str(h?._source?.entity).replace(/\s*\([A-Z0-9.\-, ]+\)\s*$/, '') })) } as any;
}

// ── Brazil ───────────────────────────────────────────────────────────────────

export const validCnpj = (c: string) => {
  const d = String(c).replace(/\D/g, '');
  if (!/^\d{14}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = w.reduce((a, x, i) => a + x * Number(d[i]), 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
};

export function parseBrazil(b: any): Found | null {
  if (!b?.cnpj || !b?.razao_social) return null;
  const street = [b.descricao_tipo_de_logradouro, b.logradouro, b.numero, b.complemento].map(str).filter(Boolean).join(' ');
  const address = [street, str(b.bairro), [str(b.municipio), str(b.uf)].filter(Boolean).join(' - '), str(b.cep)].filter(Boolean).join(', ');
  const people = (Array.isArray(b.qsa) ? b.qsa : []).slice(0, 12).map((s: any) => {
    const parts = str(s?.nome_socio).split(' ');
    return parts.length > 1 ? person(parts[0], parts.slice(1).join(' '), str(s?.qualificacao_socio)) : null;
  }).filter(Boolean) as CompanyPerson[];
  const phone = str(b.ddd_telefone_1);
  const situ = str(b.descricao_situacao_cadastral);
  return {
    source: 'Receita Federal (via BrasilAPI)',
    name: str(b.razao_social),
    address: address || undefined,
    phone: cleanPhone(phone) || undefined,
    email: cleanEmail(str(b.email).toLowerCase()) || undefined,
    industry: str(b.cnae_fiscal_descricao) || undefined,
    legal_form: str(b.natureza_juridica) || undefined,
    krs: `CNPJ ${String(b.cnpj).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}`,
    people,
    notes: situ && !/ATIVA/i.test(situ) ? [`Receita Federal status: ${situ}.`] : [],
  } as Found;
}

export async function brazilByCnpj(cnpj: string): Promise<Found | null> {
  const d = String(cnpj).replace(/\D/g, '');
  if (!validCnpj(d)) return null;
  const r = await get(`https://brasilapi.com.br/api/cnpj/v1/${d}`);
  if (r.status === 404) return null;
  if (r.status !== 200) throw fail('BrasilAPI', r.status);
  return parseBrazil(r.json);
}
