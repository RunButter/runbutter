// Everything public about a company, from its tax number.
//
// Type a NIP and the form should fill itself: name, address, the numbers an
// invoice needs, the account to pay, and — the part that was missing — how to
// reach them. No single register has all of it, so this asks several, each
// for what it is the authority on, and says which one each value came from.
//
//   Ministry of Finance white list (PL, no key)
//       name, registered address, REGON, KRS number, VAT status, bank accounts
//   KRS — the court register (PL companies, no key)
//       email and website as filed with the court, legal form, main activity
//       (PKD), and the board — who may sign for the company
//   CEIDG (PL sole traders, free token: CEIDG_API_TOKEN)
//       phone, email, website and activity a sole trader declared
//   VIES (any EU VAT number, no key)
//       name and address where the member state shares them (many do not)
//   Peppol directory (lib/company/peppol.ts, no key)
//       the e-invoicing register, keyed BY VAT NUMBER — the free way from a
//       German or Spanish number to a name, which VIES will not give
//   Wikidata (lib/company/wikidata.ts, no key)
//       VAT number → name, website and LEI for the larger companies; the LEI
//       then gives GLEIF's registered address
//   The company's own website (lib/leads/enrich.ts)
//       the phone number and contact email it publishes, robots.txt obeyed
//
// Every value is a fact somebody published about themselves. Nothing is
// guessed: a website is taken from a register, or from the domain of the email
// a register holds and only once that domain answers as a website.
//
// SERVER ONLY (fetch to the registers; the website reader uses node:dns).
import { readLegalNotice } from './impressum';
import { validNip, validDeVat, VIES, NON_EU_TAX, normalizeTaxId, printedTaxId } from './ids';
export { validNip, validDeVat, normalizeTaxId, printedTaxId, NON_EU_TAX } from './ids';
import { gleifByName, gleifByLei, comparable } from './gleif';
import { peppolByVat, looksLikeAddress } from './peppol';
import { wikidataByVat } from './wikidata';
import * as R from './registers';
import { searchWeb, ownSites, nameHints, legalQuery, type WebHit } from './websearch';
import { cleanWebsite, cleanEmail, cleanPhone } from '@/lib/leads/osm';

const UA = 'RunButter/1.0 (+https://runbutter.app; company lookup)';

export interface CompanyPerson { first_name: string; last_name: string; role: string }

export interface CompanyFacts {
  country: string;
  tax_id: string;
  name?: string;
  address?: string;
  regon?: string;
  krs?: string;
  legal_form?: string;
  /** As the register says it ("Czynny", "Zwolniony"…). */
  vat_status?: string;
  /** False when the register says this is not an active VAT payer — worth a warning before invoicing. */
  vat_active?: boolean;
  bank_account?: string;
  email?: string;
  phone?: string;
  website?: string;
  domain?: string;
  industry?: string;
  /** People who may sign for the company, from the court register. */
  people: CompanyPerson[];
  /** Field → where it came from, for the form to show. */
  sources: Record<string, string>;
  /** Things worth knowing that are not a field. */
  notes: string[];
  /** When nothing named the company: a web search for the number, for the person to open. */
  web_search?: string;
  /** The company's own website, confirmed because its legal notice prints the number typed. */
  site_verified?: string;
  /** Web results that were leads but could not be confirmed — shown to the person, never filled in. */
  web_hits?: WebHit[];
}

export class LookupError extends Error {}

// ── Identifiers ──────────────────────────────────────────────────────────────

// ── Text from registers ──────────────────────────────────────────────────────
// Registers write in capitals. A board member is "Jan Kowalski", an activity is
// "Działalność związana z oprogramowaniem". The company NAME is left exactly as
// registered: it is printed on invoices and must match the register.

const lowerPl = (s: string) => s.toLocaleLowerCase('pl');
export const sentenceCase = (s: string) => { const t = lowerPl(String(s || '').trim()); return t ? t[0].toLocaleUpperCase('pl') + t.slice(1) : ''; };
export const properName = (s: string) =>
  lowerPl(String(s || '').trim()).replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase('pl'));

/** 26-digit Polish account → "61 1090 1014 0000 0712 1981 2874". */
export function formatNrb(n: string): string {
  const d = String(n || '').replace(/\D/g, '');
  return d.length === 26 ? `${d.slice(0, 2)} ${d.slice(2).match(/.{1,4}/g)!.join(' ')}` : String(n || '');
}

/** First value under any of these keys, at any depth — registers move fields between versions. */
export function deepFind(obj: any, keys: string[], depth = 0): any {
  if (!obj || typeof obj !== 'object' || depth > 8) return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  for (const v of Object.values(obj)) {
    const hit = deepFind(v, keys, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

const FREEMAIL = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|wp|o2|onet|op|interia|poczta\.onet|tlen|gazeta|vp|gmx|web|t-online|aol|proton|protonmail|yandex|mail)\./i;

async function getJson(url: string, init: RequestInit = {}, timeout = 10_000): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', 'user-agent': UA, ...(init.headers || {}) },
    signal: AbortSignal.timeout(timeout),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ── Polish registers ─────────────────────────────────────────────────────────

export function parseWhiteList(subject: any): Partial<CompanyFacts> {
  if (!subject) return {};
  const status = String(subject.statusVat || '');
  const accounts: string[] = Array.isArray(subject.accountNumbers) ? subject.accountNumbers : [];
  return {
    name: subject.name || undefined,
    address: subject.workingAddress || subject.residenceAddress || undefined,
    regon: subject.regon || undefined,
    krs: subject.krs || undefined,
    vat_status: status || undefined,
    vat_active: status ? /czynny/i.test(status) : undefined,
    bank_account: accounts[0] ? formatNrb(accounts[0]) : undefined,
    notes: accounts.length > 1 ? [`${accounts.length} bank accounts are on the white list; the first is filled in.`] : [],
  } as any;
}

async function whiteList(nip: string): Promise<Partial<CompanyFacts> | { error: string; notFound?: boolean }> {
  const date = new Date().toISOString().slice(0, 10);
  let r;
  try { r = await getJson(`https://wl-api.mf.gov.pl/api/search/nip/${nip}?date=${date}`); }
  catch { return { error: 'The Ministry of Finance register did not answer.' }; }
  if (r.status !== 200) return { error: r.json?.message || `The Ministry of Finance register answered ${r.status}.` };
  const subject = r.json?.result?.subject;
  if (!subject) return { error: 'Not on the Ministry of Finance white list.', notFound: true };
  return parseWhiteList(subject);
}

export function parseKrs(odpis: any): Partial<CompanyFacts> {
  const dane = odpis?.odpis?.dane ?? odpis?.dane ?? odpis;
  const d1 = dane?.dzial1 ?? {};
  const email = cleanEmail(String(deepFind(d1, ['adresPocztyElektronicznej', 'email']) || ''));
  const website = cleanWebsite(lowerPl(String(deepFind(d1, ['adresStronyInternetowej', 'stronaInternetowa', 'www']) || '')));
  const form = deepFind(d1, ['formaPrawna']);
  const pkd = deepFind(dane?.dzial3, ['przedmiotPrzewazajacejDzialalnosci']);
  const mainPkd = Array.isArray(pkd) ? pkd[0] : pkd;
  const industry = mainPkd?.opis ? sentenceCase(mainPkd.opis) : '';

  const sklad = deepFind(dane?.dzial2, ['sklad']);
  const people: CompanyPerson[] = (Array.isArray(sklad) ? sklad : []).slice(0, 12).map((m: any) => {
    const last = typeof m?.nazwisko === 'string' ? m.nazwisko : m?.nazwisko?.nazwiskoICzlon || m?.nazwisko?.nazwiskoCzlonPierwszy || '';
    const first = typeof m?.imiona === 'string' ? m.imiona : m?.imiona?.imie || '';
    return { first_name: properName(first), last_name: properName(last), role: sentenceCase(m?.funkcjaWOrganie || '') };
  }).filter((p: CompanyPerson) => p.first_name && p.last_name);

  return {
    name: deepFind(d1, ['nazwa']) || undefined,
    email: email || undefined,
    website: website || undefined,
    legal_form: form ? sentenceCase(form) : undefined,
    industry: industry || undefined,
    people,
  };
}

async function krs(number: string): Promise<Partial<CompanyFacts> | null> {
  const n = String(number).replace(/\D/g, '').padStart(10, '0');
  if (!/^\d{10}$/.test(n)) return null;
  for (const rejestr of ['P', 'S']) {
    try {
      const r = await getJson(`https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/${n}?rejestr=${rejestr}&format=json`);
      if (r.status === 200 && r.json) return parseKrs(r.json);
    } catch { /* try the other register, then give up quietly */ }
  }
  return null;
}

/**
 * CEIDG — sole traders. Needs a free token from biznes.gov.pl, so it is
 * optional; without one a sole trader still gets the white-list data. Read
 * defensively (`deepFind`), because the response shape has moved between
 * API versions and a renamed key should cost one field, not the lookup.
 */
export function parseCeidg(json: any): Partial<CompanyFacts> {
  const firma = Array.isArray(json?.firmy) ? json.firmy[0] : Array.isArray(json?.firma) ? json.firma[0] : json?.firma ?? json;
  if (!firma) return {};
  const pkd = deepFind(firma, ['pkdGlowny', 'pkdPrzewazajace']);
  const pkdText = typeof pkd === 'string' ? '' : pkd?.nazwa || pkd?.opis || '';
  return {
    email: cleanEmail(String(deepFind(firma, ['email', 'adresEmail']) || '')) || undefined,
    phone: cleanPhone(String(deepFind(firma, ['telefon', 'numerTelefonu']) || '')) || undefined,
    website: cleanWebsite(String(deepFind(firma, ['www', 'adresStronyInternetowej', 'stronaWWW']) || '')) || undefined,
    industry: pkdText ? sentenceCase(pkdText) : undefined,
  };
}

async function ceidg(nip: string): Promise<Partial<CompanyFacts> | null> {
  const token = process.env.CEIDG_API_TOKEN;
  if (!token) return null;
  try {
    const r = await getJson(`https://dane.biznes.gov.pl/api/ceidg/v2/firmy?nip=${nip}`, { headers: { authorization: `Bearer ${token}` } });
    return r.status === 200 && r.json ? parseCeidg(r.json) : null;
  } catch { return null; }
}

// ── EU VIES ──────────────────────────────────────────────────────────────────

const viesClean = (v: any) => { const s = String(v ?? '').trim(); return !s || s === '---' ? '' : s; };

async function vies(country: string, number: string): Promise<Partial<CompanyFacts> | { error: string; invalid?: boolean }> {
  let r;
  try { r = await getJson(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${country}/vat/${number}`); }
  catch { return { error: 'VIES did not answer. Try again shortly.' }; }
  if (r.status !== 200) return { error: `VIES lookup failed (HTTP ${r.status}). Try again shortly.` };
  const j = r.json || {};
  const valid = j.isValid ?? j.valid;
  // VIES answers an invalid number with userError "INVALID" — that is an
  // answer, not an outage (it was reported as "having trouble" until 2026-10).
  if (j.userError === 'INVALID') return { error: `${country}${number} is not a valid VAT number in VIES.`, invalid: true };
  if (j.userError && j.userError !== 'VALID') return { error: `VIES is having trouble (${j.userError}). Try again in a moment.` };
  if (valid === false) return { error: `${country}${number} is not a valid VAT number in VIES.`, invalid: true };
  const name = viesClean(j.name ?? j.traderName);
  return {
    name: name || undefined,
    address: viesClean(j.address ?? j.traderAddress).replace(/\s*\n\s*/g, ', ') || undefined,
    vat_status: 'Valid (VIES)',
    vat_active: true,
    notes: name ? [] : [`The VAT number is valid, but ${country === 'EL' ? 'Greece' : country} does not share company names through VIES — fill in the name yourself.`],
  } as any;
}

// ── Putting it together ──────────────────────────────────────────────────────

function merge(into: CompanyFacts, add: Partial<CompanyFacts> | null | undefined, source: string) {
  if (!add) return;
  for (const [k, v] of Object.entries(add)) {
    if (k === 'notes') { into.notes.push(...((v as string[]) || [])); continue; }
    if (k === 'people') {
      if (!into.people.length && Array.isArray(v) && v.length) { into.people = v as CompanyPerson[]; into.sources.people = source; }
      continue;
    }
    if (v === undefined || v === null || v === '') continue;
    if ((into as any)[k] === undefined || (into as any)[k] === '') {
      (into as any)[k] = v;
      if (!['vat_active', 'country', 'tax_id'].includes(k)) into.sources[k] = source;
    }
  }
}

const cache = new Map<string, { at: number; facts: CompanyFacts }>();

export interface LookupInput {
  country?: string;
  /** NIP, EU VAT number — any shape. */
  taxId?: string;
  /** The company's website, when known. Never supplied by a model (see tools.ts). */
  website?: string;
  /** The company's name, for the LEI register when there is nothing else. */
  name?: string;
  /**
   * Websites a web search turned up (the browser runs it — lib/company/websearch.ts).
   * Each is only a lead: one is used when its legal notice prints the tax
   * number typed, or — with no number — the exact name. Never from a model.
   */
  candidates?: string[];
}

type Asked<T> = { r: T } | { fail: string };
const ask = <T>(p: Promise<T>): Promise<Asked<T>> => p.then((r) => ({ r }), (e) => ({ fail: String(e?.message || e) }));

/** A national register's answer, merged under its own name as the source. */
function mergeFound(facts: CompanyFacts, f: R.Found | null | undefined) {
  if (!f) return;
  const { source, ...rest } = f;
  merge(facts, rest as Partial<CompanyFacts>, source);
}

/**
 * The national register for an EU VAT number, when the country has a free one:
 * the authority on name and address, ahead of VIES's one-line summary.
 */
function nationalRegister(country: string, id: string): Promise<R.Found | null> | null {
  if (country === 'FR') { const siren = R.sirenFromFrVat(id); return siren ? R.franceBySiren(siren) : null; }
  if (country === 'CZ' && /^\d{8}$/.test(id)) return R.czechByIco(id);
  if (country === 'FI') { const b = R.finnishId(id); return b ? R.finlandById(b) : null; }
  if (country === 'RO') return R.romaniaByCui(id);
  return null;
}

const REGISTER_NAME: Record<string, string> = {
  FR: 'The French register', CZ: 'ARES', FI: 'The Finnish register', RO: 'ANAF', EE: 'The Estonian register',
  CH: 'The Swiss UID register', NO: 'Brønnøysund', US: 'SEC EDGAR / ProPublica', BR: 'BrasilAPI',
};

/** The tax registers for one number, merged into `facts`. Throws LookupError for a number that is wrong. */
async function fromTaxId(facts: CompanyFacts, country: string, idIn: string): Promise<void> {
  let id = idIn;
  if (country === 'PL' && !validNip(id)) throw new LookupError('That is not a valid NIP — check the ten digits.');
  if (country !== 'PL' && !VIES.has(country) && !NON_EU_TAX.has(country)) {
    throw new LookupError(`Tax numbers are looked up for the EU, the UK, Switzerland, Norway, the US (EIN) and Brazil (CNPJ); ${country} is not one of them. Try the website or the name instead.`);
  }
  // A French SIREN or SIRET typed on its own: VIES needs the full number, whose
  // two-digit key is computed from the SIREN.
  if (country === 'FR' && /^\d{9}(\d{5})?$/.test(id)) {
    const siren = id.slice(0, 9);
    id = `${String((12 + 3 * (Number(siren) % 97)) % 97).padStart(2, '0')}${siren}`;
  }
  facts.country = country === 'EL' ? 'GR' : country;
  facts.tax_id = id;

  if (country === 'PL') {
    const wl = await whiteList(id);
    if ('error' in wl) {
      // Not on the white list is normal for a business that is not VAT
      // registered; VIES and CEIDG may still know it.
      const [v, c] = await Promise.all([vies('PL', id), ceidg(id)]);
      if (!('error' in v)) merge(facts, v, 'EU VIES');
      merge(facts, c, 'CEIDG');
      if (!facts.name) throw new LookupError(wl.notFound ? 'No company with that NIP on the Ministry of Finance white list or in VIES.' : wl.error);
      facts.notes.push(wl.notFound
        ? 'Not on the VAT white list — check the VAT status before invoicing.'
        : `The Ministry of Finance register could not be checked (${wl.error}), so the VAT status and bank account are missing.`);
    } else {
      merge(facts, wl, 'Ministry of Finance white list');
      if (facts.vat_active === false) facts.notes.push(`VAT status on the white list: ${facts.vat_status}. Check before charging VAT.`);
      const [k, c] = await Promise.all([facts.krs ? krs(facts.krs) : null, facts.krs ? null : ceidg(id)]);
      merge(facts, k, 'KRS (court register)');
      merge(facts, c, 'CEIDG');
    }
    return;
  }

  // ── Outside VIES: one register each ────────────────────────────────────────
  if (NON_EU_TAX.has(country)) {
    if (country === 'GB') {
      // HMRC's VAT check needs an OAuth app and Companies House a key; the
      // company's own site prints its VAT number by law, which is where the
      // web step looks (and the Peppol directory, scheme 9932, may know it).
      const p = await ask(peppolByVat('GB', id));
      const card = 'r' in p ? p.r : null;
      if (card) merge(facts, { name: card.name, address: looksLikeAddress(card.geo) ? card.geo : undefined, website: card.website, email: card.email, phone: card.phone } as Partial<CompanyFacts>, 'Peppol e-invoicing directory');
      return;
    }
    const shape: Record<string, [RegExp, string]> = {
      CH: [/^\d{9}$/, 'A Swiss UID has nine digits: CHE-123.456.789.'],
      NO: [/^\d{9}$/, 'A Norwegian organisation number has nine digits: NO 123 456 789 MVA.'],
      US: [/^\d{9}$/, 'An EIN has nine digits: 12-3456789.'],
      BR: [/^\d{14}$/, 'A CNPJ has fourteen digits: 00.000.000/0001-00.'],
    };
    if (shape[country] && !shape[country][0].test(id)) throw new LookupError(shape[country][1]);
    const call = country === 'CH' ? R.swissByUid(id) : country === 'NO' ? R.norwayByOrgnr(id)
      : country === 'US' ? R.usByEin(id) : R.brazilByCnpj(id);
    const got = await ask(call);
    if ('fail' in got) throw new LookupError(`${REGISTER_NAME[country]} could not be asked just now (${got.fail}). Try again in a minute.`);
    if (!got.r) {
      if (country === 'BR' && !R.validCnpj(id)) throw new LookupError('That is not a valid CNPJ — check the fourteen digits.');
      throw new LookupError(country === 'US'
        ? 'No public record carries that EIN — only SEC filers and tax-exempt organisations are listed. Try the company name or website.'
        : `${REGISTER_NAME[country]} has no company with that number.`);
    }
    mergeFound(facts, got.r);
    return;
  }

  // ── EU: VIES + the national register + the Peppol directory + Wikidata ────
  // VIES says whether the number is real; the national register is the
  // authority on name and address; the Peppol directory and Wikidata say
  // WHOSE it is where VIES will not (Germany, Spain). All at once — each is a
  // few hundred milliseconds and none depends on another.
  const vat = `${country}${id}`;
  // An Estonian registry code (8 digits) is not its VAT number: the register, no VIES.
  const estonianCode = country === 'EE' && /^\d{8}$/.test(id);
  const [v, n, p, w] = await Promise.all([
    estonianCode ? Promise.resolve({ error: 'skipped' } as { error: string; invalid?: boolean }) : vies(country, id),
    ask(estonianCode ? R.estoniaByCode(id) : nationalRegister(country, id) ?? Promise.resolve(null)),
    ask(peppolByVat(country, id)),
    ask(wikidataByVat(vat)),
  ]);
  const national = 'r' in n ? n.r : null;
  if (national) mergeFound(facts, national);

  if ('error' in v && v.invalid) {
    // A company the national register knows but VIES does not is real and
    // simply not VAT-registered for EU trade — worth a warning, not a refusal.
    if (!national) throw new LookupError(v.error);
    facts.vat_active = false;
    facts.vat_status = facts.vat_status || 'Not in VIES';
    facts.notes.push(`${vat} is not active in VIES — the company is not registered for intra-EU VAT. Check before invoicing without VAT.`);
  } else if ('error' in v && country === 'DE' && !validDeVat(id)) {
    throw new LookupError(`DE${id} is not a valid German VAT number — check the nine digits.`);
  }
  if (!('error' in v)) merge(facts, v, 'EU VIES');

  const card = 'r' in p ? p.r : null;
  if (card) {
    merge(facts, {
      name: card.name,
      address: looksLikeAddress(card.geo) ? card.geo : undefined,
      website: card.website, email: card.email, phone: card.phone,
    } as Partial<CompanyFacts>, 'Peppol e-invoicing directory');
  }
  const wd = 'r' in w ? w.r : null;
  if (wd) {
    merge(facts, { name: wd.name, website: wd.website, address: wd.address } as Partial<CompanyFacts>, 'Wikidata');
    if (wd.lei && !facts.address) {
      const g = await gleifByLei(wd.lei).catch(() => null);
      if (g) merge(facts, { address: g.address, krs: g.register } as Partial<CompanyFacts>, 'GLEIF (LEI register)');
    }
  }

  if ('error' in v && !v.invalid && !estonianCode) {
    // VIES is down for one member state more often than anyone would like.
    // A company another register named is still worth filling in.
    if (!facts.name) throw new LookupError(v.error);
    facts.notes.push(`VIES could not be asked just now (${v.error.replace(/\.$/, '')}), so the VAT number is not confirmed as active.`);
  }
  if (estonianCode && !national) {
    throw new LookupError('fail' in n ? `The Estonian register could not be asked just now (${n.fail}).` : 'No company with that registry code in the Estonian e-Business Register.');
  }
  if (!facts.name || !facts.address) {
    const failed = [
      ('fail' in n) && `${REGISTER_NAME[country] || 'national register'}: ${n.fail}`,
      ('fail' in p) && `Peppol directory: ${p.fail}`,
      ('fail' in w) && `Wikidata: ${w.fail}`,
    ].filter(Boolean);
    if (failed.length) facts.notes.push(`Some registers did not answer (${failed.join('; ')}). Try again in a minute.`);
  }
}

// ── By name, in the country's own register ──────────────────────────────────

/** Exactly this name, or the only one that starts with it — never a near miss. */
function pickByName<T>(rows: T[], nameOf: (r: T) => string, want: string): T | null {
  const w = comparable(want);
  if (w.length < 2) return null;
  const same = rows.filter((r) => comparable(nameOf(r)) === w);
  if (same.length) return same[0];
  const starts = rows.filter((r) => comparable(nameOf(r)).startsWith(w));
  return starts.length === 1 ? starts[0] : null;
}

/** The company with this name in the national register of `country`, when that register can be searched by name. */
export async function registerByName(name: string, country: string): Promise<R.Found | null> {
  const c = country.toUpperCase();
  if (c === 'FR') {
    const hit = pickByName(await R.franceByName(name), (r: any) => r.nom_raison_sociale || r.nom_complet || '', name);
    return hit ? R.parseFrance(hit) : null;
  }
  if (c === 'CZ') { const hit = pickByName(await R.czechByName(name), (r: any) => r.obchodniJmeno || '', name); return hit ? R.parseCzech(hit) : null; }
  if (c === 'NO') { const hit = pickByName(await R.norwayByName(name), (r: any) => r.navn || '', name); return hit ? R.parseNorway(hit) : null; }
  if (c === 'FI') {
    const nameOf = (r: any) => (Array.isArray(r.names) ? (r.names.find((n: any) => String(n?.type) === '1' && !n?.endDate) ?? r.names[0])?.name : '') || '';
    const hit = pickByName(await R.finlandByName(name), nameOf, name);
    return hit ? R.parseFinland(hit) : null;
  }
  if (c === 'EE') { const hit = pickByName(await R.estoniaSearch(name), (r: any) => r.name || '', name); return hit ? R.parseEstonia(hit) : null; }
  if (c === 'US') {
    const res: any = await R.usByName(name);
    const hit = pickByName(res?._candidates || [], (r: any) => r.name, name) as any;
    const sub = hit?.cik ? await R.secByCik(hit.cik) : null;
    return sub ? R.parseSec(sub) : null;
  }
  return null;
}

// ── The company's own website, found by a web search ────────────────────────

/**
 * The first of `candidates` whose legal notice prints `printed` (DE123456789,
 * CHE123456789…), read two at a time. A notice that lists many VAT numbers is
 * a group page or a directory, not the company's own, and is not believed.
 */
async function verifiedSite(candidates: string[], printed: string): Promise<{ url: string; notice: Awaited<ReturnType<typeof readLegalNotice>> } | null> {
  const list = [...new Set(candidates.map((c) => cleanWebsite(c)).filter(Boolean))].slice(0, 6);
  for (let i = 0; i < list.length; i += 2) {
    const batch = await Promise.all(list.slice(i, i + 2).map(async (url) => ({ url, notice: await readLegalNotice(url).catch(() => null) })));
    const hit = batch.find((b) => b.notice && b.notice.vatIds.includes(printed) && b.notice.vatIds.length <= 3);
    if (hit) return hit as any;
  }
  return null;
}

/**
 * The server's own web step, for callers with no browser (the Copilot): search
 * the number, read the company sites among the results, then — when a register
 * gave a name — the name with "Impressum". Every site must carry the number.
 */
async function webCandidates(printed: string, country: string, name?: string): Promise<{ sites: string[]; hits: WebHit[] }> {
  const key = process.env.FIRECRAWL_API_KEY || undefined;
  const hits = await searchWeb(`"${printed}"`, { key }).catch(() => [] as WebHit[]);
  let sites = ownSites(hits);
  const names = [name, ...nameHints(hits)].filter(Boolean) as string[];
  if (sites.length < 2 && names.length) {
    const more = await searchWeb(legalQuery(names[0], country), { key, limit: 6 }).catch(() => [] as WebHit[]);
    sites = [...new Set([...sites, ...ownSites(more)])];
  }
  return { sites, hits };
}

/**
 * Everything public about a company, from whatever is known about it.
 *
 *   tax number → the registers: the national one where it is free (PL, FR, CZ,
 *                FI, RO, EE, CH, NO, US, BR), VIES, the Peppol directory and
 *                Wikidata
 *   website    → its legal notice (Impressum): name, address, VAT ID, register
 *                number, phone, email, managing directors — and a VAT ID found
 *                there goes back through the registers
 *   candidates → websites a web search found; one is read only when its legal
 *                notice prints the number typed (or the exact name)
 *   name       → the national register by name where it can be searched, then
 *                the LEI register (GLEIF), worldwide — exact matches only
 *
 * Registers decide the official fields; the website and GLEIF only fill what
 * is still blank. Each value says where it came from.
 */
export async function lookupCompany(input: LookupInput, opts: { readWebsites?: boolean; webSearch?: boolean } = {}): Promise<CompanyFacts> {
  const readWebsites = opts.readWebsites !== false;
  const tax = normalizeTaxId(String(input.country || ''), String(input.taxId || ''));
  const websiteIn = input.website ? cleanWebsite(String(input.website)) : '';
  const nameIn = String(input.name || '').trim().slice(0, 160);
  const candidates = (Array.isArray(input.candidates) ? input.candidates : []).map((c) => cleanWebsite(String(c))).filter(Boolean).slice(0, 6);
  if (!tax.id && !websiteIn && !nameIn) throw new LookupError('Enter a tax number, a website or a name.');
  if (tax.id && !tax.country) throw new LookupError('Pick the country, or type the number with its country prefix (DE123456789).');

  const key = JSON.stringify([tax.country, tax.id, websiteIn, nameIn.toLowerCase(), readWebsites, candidates, !!opts.webSearch]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return structuredClone(hit.facts);

  const facts: CompanyFacts = {
    country: String(input.country || '').toUpperCase() === 'EL' ? 'GR' : String(input.country || '').toUpperCase(),
    tax_id: '', people: [], sources: {}, notes: [],
  };

  if (tax.id) await fromTaxId(facts, tax.country, tax.id);

  // ── The company's own website, found by a web search ───────────────────────
  // Only when the registers left the name or address blank, and only for a
  // number a website would print (an EIN or a CNPJ is not).
  let website = websiteIn || '';
  let preread: Awaited<ReturnType<typeof readLegalNotice>> | null = null;
  const printed = facts.tax_id ? printedTaxId(facts.country === 'GR' ? 'EL' : facts.country, facts.tax_id) : '';
  const wantsWeb = readWebsites && !websiteIn && (!facts.name || !facts.address);
  if (wantsWeb && printed && !['PL', 'US', 'BR'].includes(facts.country)) {
    let leads = candidates;
    if (!leads.length && opts.webSearch) {
      const found = await webCandidates(printed, facts.country, facts.name);
      leads = found.sites;
      if (found.hits.length) facts.web_hits = found.hits.slice(0, 6);
    }
    const ok = leads.length ? await verifiedSite(leads, printed) : null;
    if (ok) { website = ok.url; preread = ok.notice; facts.site_verified = ok.url; }
  } else if (wantsWeb && !tax.id && nameIn && candidates.length) {
    // A name and some sites: the one whose legal notice is that exact company.
    for (const url of candidates.slice(0, 4)) {
      const notice = await readLegalNotice(url).catch(() => null);
      if (notice?.name && comparable(notice.name) === comparable(nameIn)) { website = url; preread = notice; facts.site_verified = url; break; }
    }
  }

  // ── The company's own website ──────────────────────────────────────────────
  if (!website) website = facts.website || '';
  let guessed = false;
  if (!website && facts.email) {
    // A company email on its own domain names its website when no register does.
    const d = facts.email.split('@')[1] || '';
    if (d && !FREEMAIL.test(d)) { website = `https://${d}/`; guessed = true; }
  }

  if (website && readWebsites) {
    const notice = preread ?? await readLegalNotice(website).catch(() => null);
    const answered = !!notice?.checked.length;
    if (guessed && !answered) {
      website = ''; // a guess that does not answer was never a website
    } else if (notice) {
      // A VAT ID the company prints about itself goes through the registers,
      // which then decide the official name and address.
      if (!tax.id && notice.vatIds.length) {
        const own = notice.vatIds.find((v) => !facts.country || v.startsWith(facts.country === 'GR' ? 'EL' : facts.country)) ?? notice.vatIds[0];
        const t = normalizeTaxId('', own);
        try { await fromTaxId(facts, t.country, t.id); facts.sources.tax_id = 'Company website'; }
        catch (e: any) { facts.notes.push(`The website gives VAT ID ${own}, but ${e?.message || 'it could not be checked'}.`); }
      } else if (tax.id && notice.vatIds.length && !preread) {
        const entered = printedTaxId(tax.country, facts.tax_id || tax.id);
        if (!notice.vatIds.includes(entered)) facts.notes.push(`The website gives VAT ID ${notice.vatIds[0]}, not the number entered — check this is the right company.`);
      }
      merge(facts, {
        name: notice.name, address: notice.address, krs: notice.register,
        email: notice.emails[0], phone: notice.phone, people: notice.people,
      } as Partial<CompanyFacts>, preread ? 'Company website (its legal notice carries this VAT number)' : 'Company website');
      if (notice.note) facts.notes.push(`Website: ${notice.note}`);
    }
  }
  if (website) {
    merge(facts, { website }, guessed ? 'Domain of the registered email' : websiteIn ? 'Entered' : preread ? 'Web search, confirmed by its legal notice' : 'Company website');
    if (!facts.website) facts.website = website;
  }

  // ── By name: the national register, then the LEI register ──────────────────
  const byName = facts.name || nameIn;
  const nameCountry = facts.country || tax.country;
  if (byName && (!facts.name || !facts.address) && nameCountry) {
    const n = await registerByName(byName, nameCountry).catch(() => null);
    if (n) mergeFound(facts, n);
  }
  if (byName && (!facts.name || !facts.address)) {
    const g = await gleifByName(byName, facts.country || undefined).catch(() => null);
    if (g) merge(facts, { name: g.name, address: g.address, krs: g.register, country: g.country } as Partial<CompanyFacts>, 'GLEIF (LEI register)');
  }
  // VIES's "fill in the name yourself" is moot once something else found it.
  if (facts.name) facts.notes = facts.notes.filter((n) => !/does not share company names/.test(n));
  if (facts.address || facts.site_verified) delete facts.web_hits;

  if (facts.website) {
    try { facts.domain = new URL(facts.website).hostname.replace(/^www\./, ''); } catch { /* no domain */ }
  }

  if (!facts.name && !facts.address) {
    if (facts.tax_id && !websiteIn) {
      const de = facts.country === 'DE';
      facts.notes = facts.notes.filter((n) => !/does not share company names/.test(n));
      facts.notes.push(`The number is valid, but no free register named its owner${candidates.length || opts.webSearch ? ', and no website found by searching for it prints it' : ''}. Paste the company's website into Website and press Fill in again — ${de ? 'a German website must show the legal name, address, register number and VAT ID in its Impressum, and everything is read from there' : 'its legal notice usually lists the legal name and address'}.`);
      facts.web_search = `https://www.google.com/search?q=${encodeURIComponent(`"${printed}"`)}`;
    } else if (!facts.tax_id && !facts.email && !facts.phone) {
      throw new LookupError(websiteIn
        ? 'Nothing could be read from that website. Check the address, or try the tax number.'
        : `No company with that exact name in ${nameCountry && ['FR', 'CZ', 'NO', 'FI', 'EE', 'US'].includes(nameCountry) ? 'the national register or ' : ''}the LEI register. Try its tax number or website.`);
    }
  }
  if (facts.name && !facts.email && !facts.phone) facts.notes.push('No public email or phone was found. Add them yourself once you have them.');

  // Only an answer is kept for a day. "Nobody named it" or "a register was
  // down" is worth asking again in a minute, not tomorrow.
  if (facts.name && !facts.notes.some((x) => /did not answer|could not be asked/.test(x))) {
    if (cache.size > 500) cache.clear();
    cache.set(key, { at: Date.now(), facts: structuredClone(facts) });
  }
  return facts;
}
