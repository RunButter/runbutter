// Tiny dependency-free CSV parser. Handles quoted fields, escaped quotes (""),
// embedded commas/newlines, and CRLF. Good enough for spreadsheet exports.
export function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const rows = parseCSVRows(text);
  const headers = (rows.shift() || []).map((h) => h.trim());
  return { headers, rows };
}

// Same parser, but every line is data. Government exports (the OFAC sanctions
// lists, for one) ship without a header row, and treating the first sanctioned
// party as column names loses a record.
export function parseCSVRows(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); out.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); out.push(row); }

  return out.filter((r) => r.some((cell) => cell.trim() !== ''));
}

// Serialise rows to CSV text (RFC-4180-ish: quote fields with comma/quote/newline).
export function toCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');
}

// Trigger a client-side CSV download.
export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

// Best-effort auto-match a form field to a CSV header (case/space/underscore-insensitive).
export function autoMatch(fieldKey: string, fieldLabel: string, headers: string[]): number {
  const norm = (x: string) => x.toLowerCase().replace(/[\s_-]+/g, '');
  const targets = [norm(fieldKey), norm(fieldLabel)];
  return headers.findIndex((h) => targets.includes(norm(h)));
}

// ── Importing someone else's export ──────────────────────────────────────────
// Lead lists arrive from Google Maps scrapers (gosom's `title`, `link`,
// `review_rating`…; Apify's `totalScore`, `categoryName`…) and from other
// CRMs. Each name below means the field it is listed under. They are tried
// only AFTER every exact match, and only on columns nothing else claimed — so
// a People import's `title` column still lands in Title, never in Name.
const norm = (x: string) => x.toLowerCase().replace(/[\s_.-]+/g, '');
const SYNONYMS: Record<string, string[]> = {
  name: ['title', 'businessname', 'company', 'companyname', 'placename', 'organization', 'organisation'],
  source: ['link', 'googlemapsurl', 'googlemapslink', 'mapsurl', 'locationlink', 'url', 'placeurl'],
  email: ['emails', 'emailaddress', 'mail', 'email1', 'emailaddresses'],
  phone: ['phonenumber', 'telephone', 'tel', 'phone1', 'internationalphonenumber', 'phones', 'mobile'],
  website: ['site', 'homepage', 'web', 'www', 'websiteurl'],
  rating: ['reviewrating', 'stars', 'totalscore', 'averagerating', 'score'],
  reviews: ['reviewcount', 'reviewscount', 'numberofreviews', 'userratingstotal', 'ratingcount'],
  category: ['type', 'maincategory', 'categoryname', 'categories', 'businesstype'],
  address: ['fulladdress', 'formattedaddress', 'street', 'streetaddress'],
  city: ['town', 'locality'],
  country: ['countrycode'],
  opening_hours: ['openhours', 'hours', 'openinghours', 'workinghours'],
  tax_id: ['nip', 'vat', 'vatid', 'vatnumber', 'taxnumber', 'ustidnr'],
  industry: ['sector'],
};

/** Which column fills which field: exact names first, then the synonyms above on what is left. */
export function matchColumns(fields: { key: string; label: string }[], headers: string[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const f of fields) m[f.key] = autoMatch(f.key, f.label, headers);
  const taken = new Set(Object.values(m).filter((i) => i >= 0));
  for (const f of fields) {
    if (m[f.key] >= 0) continue;
    for (const syn of SYNONYMS[f.key] || []) {
      const i = headers.findIndex((h, k) => !taken.has(k) && norm(h) === syn);
      if (i >= 0) { m[f.key] = i; taken.add(i); break; }
    }
  }
  return m;
}

const EMAIL_RE = /[^\s@,;<>"'()]+@[^\s@,;<>"'()]+\.[a-z]{2,}/i;

/**
 * A cell as the field wants it. Scrapers put every email in one cell
 * ("a@x.pl, b@x.pl") and write "4,6" for a rating in a Polish locale; a custom
 * field fails CLOSED on either, and import_records skips a row that raises —
 * so without this a whole scraped list imports as nothing.
 */
export function cleanImportValue(f: { key: string; label: string; input: string; options?: string[] }, raw: string): string {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  // A pick-list takes only its own options. A scraper's `status` column says
  // "Open", which is not a lead status — and a rejected option skips the WHOLE
  // row, so it is left blank instead.
  if (f.input === 'select' && f.options?.length) {
    return f.options.find((o) => o.toLowerCase() === v.toLowerCase()) ?? '';
  }
  // Opening hours arrive as JSON from scrapers: {"Monday":["9 AM–5 PM"],…}.
  if (f.key === 'opening_hours' && v.startsWith('{')) {
    try {
      const o = JSON.parse(v);
      return Object.entries(o).map(([d, h]) => `${d}: ${Array.isArray(h) ? h.join(', ') : String(h)}`).join('; ').slice(0, 500);
    } catch { /* not JSON after all — keep the text */ }
  }
  if (f.key === 'email' || /e-?mail/i.test(f.label)) {
    const m = EMAIL_RE.exec(v);
    return m ? m[0].toLowerCase() : '';
  }
  if (f.input === 'number') {
    const t = v.replace(/[\s\u00a0]/g, '');
    // "1,234.5" and "1.234,5" are the same number; "4,6" is 4.6; "1,234" is 1234.
    const comma = t.lastIndexOf(','), dot = t.lastIndexOf('.');
    const decimalComma = comma > dot && (dot >= 0 || /,\d{1,2}$/.test(t));
    const n = decimalComma ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    return /^-?\d+(\.\d+)?$/.test(n) ? n : '';
  }
  if (f.key === 'phone' || f.key.endsWith('_phone')) return v.split(/[,;|]/)[0].trim();
  return v;
}
