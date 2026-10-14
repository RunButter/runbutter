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
import { gleifByName, gleifByLei } from './gleif';
import { peppolByVat, looksLikeAddress } from './peppol';
import { wikidataByVat } from './wikidata';
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
}

export class LookupError extends Error {}

// ── Identifiers ──────────────────────────────────────────────────────────────

/** Polish NIP checksum. A typo is caught here, not reported as "no such company". */
export function validNip(nip: string): boolean {
  if (!/^\d{10}$/.test(nip)) return false;
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = w.reduce((s, x, i) => s + x * Number(nip[i]), 0) % 11;
  return sum !== 10 && sum === Number(nip[9]);
}

/**
 * German VAT ID check digit (ISO 7064 MOD 11,10, as the BZSt publishes it).
 * Used only when VIES cannot be asked: a typo is then still caught, and VIES's
 * own answer always wins when there is one.
 */
export function validDeVat(id: string): boolean {
  if (!/^[1-9]\d{8}$/.test(id)) return false;
  let p = 10;
  for (let i = 0; i < 8; i++) {
    let s = (Number(id[i]) + p) % 10;
    if (s === 0) s = 10;
    p = (2 * s) % 11;
  }
  const check = (11 - p) % 10;
  return check === Number(id[8]);
}

/** EU members VIES accepts, by the code VIES uses (Greece is EL there, not GR). */
const VIES = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI']);

/**
 * "PL 526-025-09-95", "pl5260250995", "5260250995" with no country, "DE123456789"
 * with the country left on Poland — all mean something, and the form used to
 * accept only the one shape.
 */
export function normalizeTaxId(countryIn: string, raw: string): { country: string; id: string } {
  let id = String(raw || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  let country = String(countryIn || '').toUpperCase().trim();
  const prefix = id.slice(0, 2);
  if (/^[A-Z]{2}$/.test(prefix) && (VIES.has(prefix) || prefix === 'GR')) {
    country = prefix; id = id.slice(2);
  }
  if (!country && validNip(id)) country = 'PL';
  if (country === 'GR') country = 'EL';
  return { country, id };
}

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
}

/** The tax registers for one number, merged into `facts`. Throws LookupError for a number that is wrong. */
async function fromTaxId(facts: CompanyFacts, country: string, id: string): Promise<void> {
  if (country === 'PL' && !validNip(id)) throw new LookupError('That is not a valid NIP — check the ten digits.');
  if (country !== 'PL' && !VIES.has(country)) throw new LookupError(`Tax numbers can be looked up for Poland and the EU; ${country} is not one of them. Try the website or the name instead.`);
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
  } else {
    // VIES says whether the number is real; the Peppol directory and Wikidata
    // say WHOSE it is, which VIES will not for Germany and Spain. All three at
    // once — each is a few hundred milliseconds and none depends on another.
    const vat = `${country}${id}`;
    const [v, p, w] = await Promise.all([
      vies(country, id),
      peppolByVat(country, id).then((r) => ({ r }), (e) => ({ fail: String(e?.message || e) })),
      wikidataByVat(vat).then((r) => ({ r }), (e) => ({ fail: String(e?.message || e) })),
    ]);
    if ('error' in v && v.invalid) throw new LookupError(v.error);
    if ('error' in v && country === 'DE' && !validDeVat(id)) {
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

    if ('error' in v) {
      // VIES is down for one member state more often than anyone would like.
      // A company another register named is still worth filling in.
      if (!facts.name) throw new LookupError(v.error);
      facts.notes.push(`VIES could not be asked just now (${v.error.replace(/\.$/, '')}), so the VAT number is not confirmed as active.`);
    }
    if (!facts.name) {
      const failed = [('fail' in p) && `Peppol directory: ${p.fail}`, ('fail' in w) && `Wikidata: ${w.fail}`].filter(Boolean);
      if (failed.length) facts.notes.push(`Some registers did not answer (${failed.join('; ')}). Try again in a minute.`);
    }
  }
}

/**
 * Everything public about a company, from whatever is known about it.
 *
 *   tax number → the registers (white list, KRS, CEIDG, VIES)
 *   website    → its legal notice (Impressum): name, address, VAT ID, register
 *                number, phone, email, managing directors — and a VAT ID found
 *                there goes back through the registers
 *   name       → the LEI register (GLEIF), worldwide, exact matches only
 *
 * Registers decide the official fields; the website and GLEIF only fill what
 * is still blank. Each value says where it came from.
 */
export async function lookupCompany(input: LookupInput, opts: { readWebsites?: boolean } = {}): Promise<CompanyFacts> {
  const readWebsites = opts.readWebsites !== false;
  const tax = normalizeTaxId(String(input.country || ''), String(input.taxId || ''));
  const websiteIn = input.website ? cleanWebsite(String(input.website)) : '';
  const nameIn = String(input.name || '').trim().slice(0, 160);
  if (!tax.id && !websiteIn && !nameIn) throw new LookupError('Enter a tax number, a website or a name.');
  if (tax.id && !tax.country) throw new LookupError('Pick the country, or type the number with its country prefix (DE123456789).');

  const key = JSON.stringify([tax.country, tax.id, websiteIn, nameIn.toLowerCase(), readWebsites]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return structuredClone(hit.facts);

  const facts: CompanyFacts = {
    country: String(input.country || '').toUpperCase() === 'EL' ? 'GR' : String(input.country || '').toUpperCase(),
    tax_id: '', people: [], sources: {}, notes: [],
  };

  if (tax.id) await fromTaxId(facts, tax.country, tax.id);

  // ── The company's own website ──────────────────────────────────────────────
  let website = websiteIn || facts.website || '';
  let guessed = false;
  if (!website && facts.email) {
    // A company email on its own domain names its website when no register does.
    const d = facts.email.split('@')[1] || '';
    if (d && !FREEMAIL.test(d)) { website = `https://${d}/`; guessed = true; }
  }

  if (website && readWebsites) {
    const notice = await readLegalNotice(website).catch(() => null);
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
      } else if (tax.id && notice.vatIds.length) {
        const entered = `${tax.country === 'PL' ? 'PL' : tax.country}${tax.id}`;
        if (!notice.vatIds.includes(entered)) facts.notes.push(`The website gives VAT ID ${notice.vatIds[0]}, not the number entered — check this is the right company.`);
      }
      merge(facts, {
        name: notice.name, address: notice.address, krs: notice.register,
        email: notice.emails[0], phone: notice.phone, people: notice.people,
      } as Partial<CompanyFacts>, 'Company website');
      if (notice.note) facts.notes.push(`Website: ${notice.note}`);
    }
  }
  if (website) {
    merge(facts, { website }, guessed ? 'Domain of the registered email' : websiteIn ? 'Entered' : 'Company website');
    if (!facts.website) facts.website = website;
  }

  // ── The LEI register, by name ──────────────────────────────────────────────
  const byName = facts.name || nameIn;
  if (byName && (!facts.name || !facts.address)) {
    const g = await gleifByName(byName, facts.country || undefined).catch(() => null);
    if (g) merge(facts, { name: g.name, address: g.address, krs: g.register, country: g.country } as Partial<CompanyFacts>, 'GLEIF (LEI register)');
  }
  // VIES's "fill in the name yourself" is moot once something else found it.
  if (facts.name) facts.notes = facts.notes.filter((n) => !/does not share company names/.test(n));

  if (facts.website) {
    try { facts.domain = new URL(facts.website).hostname.replace(/^www\./, ''); } catch { /* no domain */ }
  }

  if (!facts.name && !facts.address) {
    if (facts.tax_id && !websiteIn) {
      const de = facts.country === 'DE';
      facts.notes = facts.notes.filter((n) => !/does not share company names/.test(n));
      facts.notes.push(`The number is valid, but no free register named its owner. Search the web for it, paste the company's website into Website and press Fill in again — ${de ? 'a German website must show the legal name, address, register number and VAT ID in its Impressum, and everything is read from there' : 'its legal notice usually lists the legal name and address'}.`);
      facts.web_search = `https://www.google.com/search?q=${encodeURIComponent(`"${facts.country === 'GR' ? 'EL' : facts.country}${facts.tax_id}"`)}`;
    } else if (!facts.tax_id && !facts.email && !facts.phone) {
      throw new LookupError(websiteIn
        ? 'Nothing could be read from that website. Check the address, or try the tax number.'
        : 'No company with that exact name in the LEI register. Try its tax number or website.');
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
