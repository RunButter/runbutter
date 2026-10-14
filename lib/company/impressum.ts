// A company's own legal notice, read for the facts it is obliged to publish.
//
// Germany and Austria REQUIRE every commercial website to carry an Impressum
// (DDG § 5, ECG § 5) stating the legal name, the address, the register court
// and number, the VAT ID, a phone or email, and who manages the company. The
// rest of the EU has milder versions — mentions légales, aviso legal, note
// legali — and Polish sites usually print NIP, REGON and KRS in the footer.
//
// That matters because VIES confirms a German VAT number and refuses to say
// whose it is: there is no free register that turns DE123456789 into a name.
// The company's own website will, by law. So "fill in from the website" is the
// route that works for German companies, and it works for most others too.
//
// Heuristic by nature — a legal notice is prose — so every extractor here is
// conservative: a value is taken only when it has the shape it must have (a
// VAT ID that passes its country's format, a postcode line, a name carrying a
// legal form), and nothing is inferred from a near miss.
import { decodeEntities, extractContacts, readSite } from '@/lib/leads/enrich';
import { cleanPhone } from '@/lib/leads/osm';
import type { CompanyPerson } from './lookup';

/** Links that lead to the legal notice, in the languages this product is used in. */
/** The legal notice itself, as opposed to a contact or about page — read first. */
export const LEGAL_NOTICE_PAGE = /(impressum|imprint|legal[-_ ]?notice|mentions[-_ ]?l[ée]gales|aviso[-_ ]?legal|note[-_ ]?legali|colofon|nota[-_ ]?prawna|dane[-_ ]?firmy|informacje[-_ ]?prawne|legal[-_ ]?info)/i;

export const LEGAL_PAGE = /(impressum|imprint|legal[-_ ]?notice|legal[-_ ]?info|mentions[-_ ]?l[ée]gales|aviso[-_ ]?legal|note[-_ ]?legali|colofon|nota[-_ ]?prawna|dane[-_ ]?firmy|informacje[-_ ]?prawne|kontakt|contact|about|o[-_ ]?nas|o[-_ ]?firmie)/i;
const LEGAL_FIRST = /(impressum|imprint|legal|mentions|aviso|note[-_ ]?legali|colofon|nota[-_ ]?prawna|dane[-_ ]?firmy)/i;

// ── HTML → lines ─────────────────────────────────────────────────────────────

/** Block ends become line breaks, so "Musterstraße 1<br>12345 Berlin" stays two lines. */
export function htmlToLines(html: string): string[] {
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<!--[\s\S]*?-->/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|td|th|address|section|article|dd|dt|footer|header)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  );
  return text.split('\n').map((l) => l.replace(/[ \s]+/g, ' ').trim()).filter(Boolean);
}

// ── VAT IDs ──────────────────────────────────────────────────────────────────

/** EU VAT formats (the country prefix included), after spaces, dots and dashes are removed. */
const VAT_FORMAT: Record<string, RegExp> = {
  AT: /^ATU\d{8}$/, BE: /^BE[01]\d{9}$/, BG: /^BG\d{9,10}$/, CY: /^CY\d{8}[A-Z]$/, CZ: /^CZ\d{8,10}$/,
  DE: /^DE\d{9}$/, DK: /^DK\d{8}$/, EE: /^EE\d{9}$/, EL: /^EL\d{9}$/, ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^FI\d{8}$/, FR: /^FR[A-HJ-NP-Z0-9]{2}\d{9}$/, HR: /^HR\d{11}$/, HU: /^HU\d{8}$/,
  IE: /^IE\d[A-Z0-9+*]\d{5}[A-Z]{1,2}$/, IT: /^IT\d{11}$/, LT: /^LT(\d{9}|\d{12})$/, LU: /^LU\d{8}$/,
  LV: /^LV\d{11}$/, MT: /^MT\d{8}$/, NL: /^NL\d{9}B\d{2}$/, PL: /^PL\d{10}$/, PT: /^PT\d{9}$/,
  RO: /^RO\d{2,10}$/, SE: /^SE\d{12}$/, SI: /^SI\d{8}$/, SK: /^SK\d{10}$/,
  GB: /^GB(\d{9}|\d{12})$/, XI: /^XI(\d{9}|\d{12})$/,
};

/**
 * VAT IDs in the text, in order of appearance. A candidate is a country prefix
 * followed by digits/letters with optional separators ("DE 123 456 789",
 * "ATU12345678"), accepted only if it then matches that country's format.
 * A Polish "NIP: 526-025-09-95" with no prefix is read as PL.
 */
export function findVatIds(text: string): string[] {
  const out: string[] = [];
  const add = (v: string) => { if (!out.includes(v)) out.push(v); };
  for (const m of text.matchAll(/\b(ATU|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|GB|XI)[\s.\-]?([0-9A-Z][0-9A-Z\s.\-+*]{6,16}[0-9A-Z])/g)) {
    const prefix = m[1] === 'ATU' ? 'AT' : m[1];
    const raw = (m[1] + m[2]).replace(/[\s.\-]/g, '');
    // A run that swallowed the next word is cut back to the longest valid prefix.
    for (let len = raw.length; len >= 8; len--) {
      if (VAT_FORMAT[prefix]?.test(raw.slice(0, len))) { add(raw.slice(0, len)); break; }
    }
  }
  // Switzerland "CHE-123.456.789 MWST" and Norway "NO 123 456 789 MVA" — outside
  // the EU, so not in the table above, and printed the same way in a footer.
  for (const m of text.matchAll(/\bCHE[\s\-]?(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})\b/g)) add(`CHE${m[1]}${m[2]}${m[3]}`);
  for (const m of text.matchAll(/\bNO[\s\-]?(\d{3})\s?(\d{3})\s?(\d{3})\s?MVA\b/g)) add(`NO${m[1]}${m[2]}${m[3]}MVA`);
  // Printed without the prefix, which is how most sites in these countries do it.
  for (const m of text.matchAll(/\b(?:C\.?I\.?F\.?|N\.?I\.?F\.?)\s*:?\s*(?:ES)?\s*([A-Z]-?\d{7}-?[A-Z0-9]|\d{8}-?[A-Z])\b/g)) add(`ES${m[1].replace(/-/g, '')}`);
  for (const m of text.matchAll(/\b(?:P\.?\s?IVA|Partita\s+IVA)\s*:?\s*(?:IT)?\s*(\d{11})\b/gi)) add(`IT${m[1]}`);
  for (const m of text.matchAll(/\bVAT\s*(?:Reg(?:istration|\.)?\s*)?(?:No\.?|Number|#)\s*:?\s*(?:GB)?\s*(\d{3})\s?(\d{4})\s?(\d{2})\b/gi)) add(`GB${m[1]}${m[2]}${m[3]}`);
  for (const m of text.matchAll(/\bNIP\s*:?\s*(\d{3}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}|\d{3}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{3})\b/gi)) {
    add('PL' + m[1].replace(/\D/g, ''));
  }
  return out;
}

// ── Name, address, register, people ─────────────────────────────────────────

const LEGAL_FORM = /\b(GmbH\s*&\s*Co\.?\s*KG(aA)?|gGmbH|GmbH|UG\s*\(haftungsbeschr[aä]nkt\)|AG|SE|KGaA|KG|OHG|e\.\s?K\.|e\.\s?V\.|Ltd\.?|Limited|LLC|LLP|PLC|Inc\.?|S\.A\.S\.?|SAS|SARL|S\.?A\.?R\.?L\.?|S\.A\.|S\.L\.U?\.?|S\.p\.A\.|S\.r\.l\.|B\.V\.|N\.V\.|sp\.\s*z\s*o\.\s*o\.|spółka\s+z\s+ograniczoną\s+odpowiedzialnością|spółka\s+akcyjna|sp\.\s*k\.|S\.K\.A\.|Oy|Oyj|AB|ApS|A\/S|AS|ASA|s\.r\.o\.|a\.s\.|Kft\.?|Zrt\.?|d\.o\.o\.|SIA|UAB|OÜ)(?=$|[\s,.;)])/i;
const NOISE = /©|copyright|all rights reserved|alle rechte|cookie|datenschutz|privacy|newsletter|powered by|design by|webdesign/i;

const HEADING = /^(impressum|imprint|legal notice|angaben gemäß|angaben gem\.|informationen gemäß|mentions légales|aviso legal|note legali|dane firmy|nota prawna)/i;

/**
 * The company name out of the sentence it sits in: "Diese Website wird
 * betrieben von der LIPINSKI TELEKOM GmbH." → "LIPINSKI TELEKOM GmbH",
 * "Impressum der Miettex Service Meeß GmbH aus Sankt Augustin" → "Miettex
 * Service Meeß GmbH", "Terma GmbH Hochwertige Industriereiniger" → "Terma GmbH".
 * Everything after the LAST legal form goes — a name ends with its form.
 */
export function tidyName(raw: string): string {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^.*?\b(?:betrieben\s+(?:von|durch)|operated\s+by|published\s+by|herausgegeben\s+von|impressum|imprint|anbieter(?:in)?|betreiber(?:in)?|diensteanbieter|verantwortlich(?:\s+f[uü]r\s+den\s+inhalt)?)\b\s*:?\s*(?:(?:der|die|des|dem|the|von)\s+)?/i, '');
  let last: RegExpMatchArray | null = null;
  for (const m of s.matchAll(new RegExp(LEGAL_FORM.source, 'gi'))) last = m;
  if (last && last.index !== undefined) s = s.slice(0, last.index + last[0].length);
  return s.replace(/^[\s,.;:]+|[\s,;:]+$/g, '');
}

export function findCompanyName(lines: string[]): string | undefined {
  const start = Math.max(0, lines.findIndex((l) => HEADING.test(l)));
  const look = (from: number) => {
    for (let i = from; i < Math.min(lines.length, from + 60); i++) {
      const l = lines[i].replace(/^(firma|firmenname|company|anbieter|betreiber|herausgeber|name)\s*:\s*/i, '');
      if (l.length > 120 || NOISE.test(l) || !LEGAL_FORM.test(l)) continue;
      // "Acme GmbH, Musterstraße 1, 12345 Berlin" → the part carrying the legal form.
      const part = tidyName(l.split(/\s[|•·–—]\s|,\s(?=\D*\d{4,5}\b)/)[0].trim());
      if (part.length >= 3 && LEGAL_FORM.test(part)) return part;
    }
    return undefined;
  };
  return look(start) ?? (start > 0 ? look(0) : undefined);
}

/** A postcode followed by a place, per country shape. */
const POSTCODE_LINE = /^(?:(?:D|A|CH|PL|F|NL|B|L)\s?-\s?)?(\d{5}|\d{4}\s?[A-Z]{2}|\d{2}-\d{3}|\d{4})\s+\p{L}[\p{L}\s.\-()]{1,40}$/u;
const STREET_LINE = /^(?=.*\p{L})(?=.*\d)[\p{L}\d .,'\/\-]{3,70}$/u;

export function findAddress(lines: string[], name?: string): string | undefined {
  const from = Math.max(0, name ? lines.findIndex((l) => l.includes(name)) : lines.findIndex((l) => HEADING.test(l)));
  const scan = (a: number, b: number) => {
    for (let i = Math.max(0, a); i < Math.min(lines.length, b); i++) {
      const line = lines[i].replace(/^(anschrift|adresse|address|sitz|siedziba|adres)\s*:\s*/i, '');
      // One line: "Musterstraße 1, 12345 Berlin"
      const one = line.match(/^(.{3,70}?\d+[a-zA-Z]?(?:\s?[-\/]\s?\d+[a-zA-Z]?)?)\s*,\s*((?:[A-Z]{1,2}-)?(?:\d{5}|\d{4}\s?[A-Z]{2}|\d{2}-\d{3}|\d{4})\s+\p{L}[\p{L}\s.\-]{1,40})$/u);
      if (one && !LEGAL_FORM.test(one[1])) return `${one[1].trim()}, ${one[2].trim()}`;
      if (POSTCODE_LINE.test(line) && i > 0) {
        const street = lines[i - 1].replace(/^(anschrift|adresse|address)\s*:\s*/i, '');
        if (STREET_LINE.test(street) && !LEGAL_FORM.test(street) && !/^(tel|fax|phone|e-?mail)/i.test(street)) return `${street}, ${line}`;
        return line;
      }
    }
    return undefined;
  };
  return scan(from, from + 25) ?? scan(0, lines.length);
}

export function findRegister(text: string): string | undefined {
  const krs = text.match(/\bKRS\s*:?\s*(\d{10})\b/i);
  if (krs) return krs[1];
  const hr = text.match(/\b(HR[AB])\s*:?\s*(\d{1,6}(?:\s?[A-Z]{1,2})?)\b/);
  if (!hr) return undefined;
  const court = text.match(/\b(?:Amtsgericht|Registergericht\s*:?\s*(?:Amtsgericht)?|Handelsregister\s+(?:des\s+)?Amtsgerichts?)\s+([\p{L}][\p{L}\-. ]{1,40}?)(?=[,;\n]|\s+(?:unter|HR[AB]|Register|Nr|$))/u);
  return `${hr[1]} ${hr[2].trim()}${court ? ` (Amtsgericht ${court[1].trim()})` : ''}`;
}

const ROLE = /^(gesch[aä]ftsf[uü]hr(?:er|erin|ung|ende)?|vertreten durch(?: den gesch[aä]ftsf[uü]hrer| die gesch[aä]ftsf[uü]hrer(?:in)?)?|vorstand|inhaber(?:in)?|managing directors?|directors?|ceo|g[ée]rant|administrador(?:es)?|amministratore|zarz[aą]d|prezes zarz[aą]du|w[lł]a[sś]ciciel)\s*:?\s*(.*)$/i;

export function findPeople(lines: string[]): CompanyPerson[] {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ROLE);
    if (!m) continue;
    const roleWord = m[1].toLowerCase();
    const role = /gesch|vertreten/.test(roleWord) ? 'Geschäftsführer' : /vorstand/.test(roleWord) ? 'Vorstand'
      : /inhaber/.test(roleWord) ? 'Inhaber' : /zarz|prezes/.test(roleWord) ? 'Zarząd' : /w[lł]a/.test(roleWord) ? 'Właściciel'
      : /g[ée]rant/.test(roleWord) ? 'Gérant' : 'Managing director';
    const value = (m[2] || lines[i + 1] || '').replace(/\(.*?\)/g, ' ');
    const names = value.split(/\s*(?:,|;|\/|&|\bund\b|\band\b|\bi\b|\bet\b|\by\b)\s*/i)
      // Every leading title, however many and however joined: "Prof. Dr.-Ing.",
      // "Dipl.-Kfm.", "Herr Dr." — a name that kept one fails the shape test below.
      .map((s) => s.replace(/^(?:(?:herr|frau|mr|mrs|ms|pan|pani)\.?\s+|(?:dr|prof|mag|dipl|ing|rer|nat|med)\.?(?:-[\p{L}]+\.?)*\s+)+/giu, '').trim())
      .filter((s) => /^\p{Lu}[\p{L}'\-]+(?:\s\p{Lu}[\p{L}'\-]+){1,3}$/u.test(s));
    if (!names.length) continue;
    return names.slice(0, 6).map((n) => {
      const parts = n.split(' ');
      return { first_name: parts.slice(0, -1).join(' '), last_name: parts[parts.length - 1], role };
    });
  }
  return [];
}

function findTextPhone(lines: string[]): string | undefined {
  for (const l of lines) {
    const m = l.match(/^(?:tel(?:efon)?|phone|telephone|t[ée]l[ée]phone|tel\.|fon|t)\s*\.?\s*:?\s*(\+?[\d\s()\/.\-]{7,24})/i);
    const p = m ? cleanPhone(m[1]) : '';
    if (p) return p;
  }
  return undefined;
}

// ── The whole read ───────────────────────────────────────────────────────────

export interface LegalNotice {
  name?: string;
  address?: string;
  vatIds: string[];
  register?: string;
  emails: string[];
  phone?: string;
  people: CompanyPerson[];
  /** Pages read, legal notice first. */
  checked: string[];
  note?: string;
}

/** Parse pages already fetched: the legal notice page first, then the rest. */
export function parseLegalPages(pages: { url: string; html: string }[]): LegalNotice {
  const ordered = [...pages].sort((a, b) => Number(LEGAL_FIRST.test(b.url)) - Number(LEGAL_FIRST.test(a.url)));
  const out: LegalNotice = { vatIds: [], emails: [], people: [], checked: ordered.map((p) => p.url) };
  for (const p of ordered) {
    const lines = htmlToLines(p.html);
    const text = lines.join('\n');
    out.name ??= findCompanyName(lines);
    out.address ??= findAddress(lines, out.name);
    out.register ??= findRegister(text);
    for (const v of findVatIds(text)) if (!out.vatIds.includes(v)) out.vatIds.push(v);
    const c = extractContacts(p.html, p.url);
    for (const e of c.emails) if (!out.emails.includes(e)) out.emails.push(e);
    out.phone ??= c.phones[0] || findTextPhone(lines);
    if (!out.people.length) out.people = findPeople(lines);
  }
  return out;
}

export async function readLegalNotice(website: string): Promise<LegalNotice> {
  const site = await readSite(website, { pick: LEGAL_PAGE, prefer: LEGAL_NOTICE_PAGE, paths: ['/impressum', '/imprint', '/kontakt', '/contact'], maxPages: 3 });
  if (!site.pages.length) return { vatIds: [], emails: [], people: [], checked: [], note: site.note };
  return parseLegalPages(site.pages);
}
