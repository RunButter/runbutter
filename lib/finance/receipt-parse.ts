// Pull structured fields out of an invoice or receipt's text.
//
// WHY REGEX FIRST AND NOT A MODEL: most B2B invoices arrive as PDFs with a real
// text layer, and for those, extraction is a parsing problem, not a vision
// problem — the PDF text layer already gives us the characters. Running every upload
// through an LLM would put a per-document price on bookkeeping and break the
// cost rule. Vision is the fallback for photos, on the customer's own AI key.
//
// Tuned for Polish and EU invoices because that is what the product already
// handles (KSeF, NIP, Biała lista). The English keywords are there so a UK/US
// invoice still yields an amount and a date.

export interface ParsedReceipt {
  /** Gross total — what actually gets paid. */
  total: number | null;
  currency: string | null;
  /** Issue date, ISO yyyy-mm-dd. */
  date: string | null;
  /** Seller tax id (PL NIP, 10 digits, checksum-verified). */
  nip: string | null;
  /** EU VAT id including country prefix, when present. */
  vatId: string | null;
  /** Seller bank account, checksum-verified upstream by lib/finance/iban. */
  iban: string | null;
  invoiceNumber: string | null;
  /** VAT percentages seen on the document. */
  vatRates: number[];
  /** Best-guess vendor name from the first meaningful line. Weakest field. */
  vendorGuess: string | null;
}

// ── Numbers ─────────────────────────────────────────────────────────────────
// European invoices use comma as the decimal separator and space or dot as the
// thousands separator: "1 234,56", "1.234,56". US/UK use "1,234.56". Guessing
// wrong turns 1.234,56 into 1.23 — a 1000x error on a payable — so decide from
// which separator comes LAST rather than assuming a locale.
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/[^\d.,-]/g, '');
  if (!s || !/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let normalised: string;

  if (lastComma > lastDot) {
    // comma is the decimal mark → dots are thousands
    normalised = s.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    normalised = s.replace(/,/g, '');
  } else {
    normalised = s;   // no separators at all
  }

  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

// ── NIP ─────────────────────────────────────────────────────────────────────
/**
 * Polish NIP checksum (weights 6,5,7,2,3,4,5,6,7 mod 11).
 *
 * Validated rather than pattern-matched because an invoice is full of 10-digit
 * numbers — phone numbers, account fragments, order refs. The checksum is what
 * separates a tax id from noise, and a wrong NIP means the Biała lista lookup
 * silently fills in the wrong company.
 */
export function isValidNip(input: string): boolean {
  const d = String(input || '').replace(/\D/g, '');
  if (d.length !== 10 || /^(\d)\1{9}$/.test(d)) return false;
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = w.reduce((acc, weight, i) => acc + weight * Number(d[i]), 0);
  const check = sum % 11;
  return check !== 10 && check === Number(d[9]);
}

const AMOUNT_TOKEN = '([0-9][0-9 .,]{0,15}[0-9]|[0-9])';

// Ordered most-specific first: "do zapłaty" (amount due) beats "razem" (subtotal
// row) beats a bare "total", because invoices contain several of these and the
// payable is the one that matters.
const TOTAL_PATTERNS: RegExp[] = [
  new RegExp(`do\\s*zap[łl]aty[^0-9-]{0,20}${AMOUNT_TOKEN}`, 'i'),
  new RegExp(`kwota\\s*do\\s*zap[łl]aty[^0-9-]{0,20}${AMOUNT_TOKEN}`, 'i'),
  new RegExp(`amount\\s*due[^0-9-]{0,20}${AMOUNT_TOKEN}`, 'i'),
  new RegExp(`grand\\s*total[^0-9-]{0,20}${AMOUNT_TOKEN}`, 'i'),
  new RegExp(`\\btotal\\s*(?:gross|incl[^0-9]{0,12})?[^0-9-]{0,20}${AMOUNT_TOKEN}`, 'i'),
  new RegExp(`razem\\s*(?:brutto)?[^0-9-]{0,20}${AMOUNT_TOKEN}`, 'i'),
  new RegExp(`suma\\s*(?:brutto)?[^0-9-]{0,20}${AMOUNT_TOKEN}`, 'i'),
  new RegExp(`brutto[^0-9-]{0,20}${AMOUNT_TOKEN}`, 'i'),
  // Last resort: any "…total" including Subtotal. Only reached when nothing
  // above matched, so a subtotal beats reporting no amount at all.
  new RegExp(`total[^0-9-]{0,20}${AMOUNT_TOKEN}`, 'i'),
];

const CURRENCY_MAP: Record<string, string> = {
  'zł': 'PLN', 'zl': 'PLN', pln: 'PLN', '€': 'EUR', eur: 'EUR',
  '$': 'USD', usd: 'USD', '£': 'GBP', gbp: 'GBP', chf: 'CHF', czk: 'CZK', huf: 'HUF',
};

function findCurrency(text: string): string | null {
  const lower = text.toLowerCase();
  // Longest tokens first so "pln" isn't shadowed by a stray "n".
  for (const key of ['pln', 'eur', 'usd', 'gbp', 'chf', 'czk', 'huf', 'zł', 'zl', '€', '$', '£']) {
    if (lower.includes(key)) return CURRENCY_MAP[key];
  }
  return null;
}

/** Normalise to ISO. Two-digit years are assumed 20xx — invoices aren't from 1998. */
function toIso(y: string, m: string, d: string): string | null {
  let year = Number(y);
  if (year < 100) year += 2000;
  const month = Number(m), day = Number(d);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const PL_MONTHS = ['stycznia','lutego','marca','kwietnia','maja','czerwca','lipca','sierpnia','września','października','listopada','grudnia'];

function findDate(text: string): string | null {
  // ISO first — unambiguous, so prefer it wherever it appears.
  const iso = text.match(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/);
  if (iso) { const v = toIso(iso[1], iso[2], iso[3]); if (v) return v; }

  // dd.mm.yyyy — the European order. Deliberately NOT trying to support
  // mm/dd/yyyy: the two are indistinguishable below the 13th, and silently
  // guessing would put invoices in the wrong month.
  const dmy = text.match(/\b(\d{1,2})[-./](\d{1,2})[-./](20\d{2}|\d{2})\b/);
  if (dmy) { const v = toIso(dmy[3], dmy[2], dmy[1]); if (v) return v; }

  // "12 marca 2026"
  const named = text.toLowerCase().match(new RegExp(`\\b(\\d{1,2})\\s+(${PL_MONTHS.join('|')})\\s+(20\\d{2})\\b`));
  if (named) {
    const v = toIso(named[3], String(PL_MONTHS.indexOf(named[2]) + 1), named[1]);
    if (v) return v;
  }
  return null;
}

function findNip(text: string): string | null {
  // Every 10-digit run is a candidate; the checksum decides. Prefer one that is
  // actually labelled NIP, so a buyer's id doesn't win over the seller's.
  const labelled = text.match(/NIP[^0-9]{0,10}((?:\d[\s-]?){10})/i);
  if (labelled) {
    const d = labelled[1].replace(/\D/g, '');
    if (isValidNip(d)) return d;
  }
  for (const m of text.matchAll(/(?<!\d)((?:\d[\s-]?){9}\d)(?!\d)/g)) {
    const d = m[1].replace(/\D/g, '');
    if (isValidNip(d)) return d;
  }
  return null;
}

/**
 * Invoice number, scanned line by line.
 *
 * A character-class separator ("Faktura" then up to N non-letters) fails on the
 * very common "Faktura VAT nr FV/2026/07/123" — the words in between are
 * letters. Taking the keyword's own line and picking the first
 * invoice-number-shaped token out of it is both simpler and more robust.
 */
function findInvoiceNumber(text: string): string | null {
  for (const line of text.split('\n')) {
    if (!/faktura|invoice|rachunek|paragon/i.test(line)) continue;
    // Prefer a slashed/hyphenated reference; fall back to a bare run of digits.
    const ref = line.match(/\b([A-Z0-9]+(?:[\/-][A-Z0-9]+){1,4})\b/i);
    if (ref && /\d/.test(ref[1]) && !/^(?:vat|nip)$/i.test(ref[1])) return ref[1];
    const bare = line.match(/(?:nr|no|#|:)\s*(\d{2,12})\b/i);
    if (bare) return bare[1];
  }
  return null;
}

export function parseReceiptText(text: string): ParsedReceipt {
  const t = String(text || '').replace(/ /g, ' ');

  let total: number | null = null;
  for (const re of TOTAL_PATTERNS) {
    const m = t.match(re);
    if (m) {
      const v = parseAmount(m[1]);
      // Reject 0 and absurd values: a matched-but-nonsense total is worse than
      // no total, because it looks filled in.
      if (v !== null && v > 0 && v < 1e9) { total = v; break; }
    }
  }

  const vatRates = [...new Set(
    [...t.matchAll(/\b(0|3|5|7|8|9|10|12|13|15|17|19|20|21|22|23|24|25|27)\s*%/g)].map((m) => Number(m[1])),
  )].sort((a, b) => a - b);

  const ibanMatch = t.match(/\b([A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{2,4}){2,8})\b/);
  const vatIdMatch = t.match(/\b((?:AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)[\s-]?[0-9A-Z]{8,12})\b/);
  const invoiceNumber = findInvoiceNumber(t);

  // First line with letters and no money on it — a header, usually the seller.
  // Genuinely unreliable, which is why the NIP → Biała lista path exists.
  const vendorGuess = t.split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 2 && l.length < 60 && /[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3}/.test(l) && !/\d[.,]\d{2}/.test(l)) ?? null;

  return {
    total,
    currency: findCurrency(t),
    date: findDate(t),
    nip: findNip(t),
    vatId: vatIdMatch ? vatIdMatch[1].replace(/[\s-]/g, '') : null,
    iban: ibanMatch ? ibanMatch[1].replace(/\s/g, '') : null,
    invoiceNumber,
    vatRates,
    vendorGuess,
  };
}

// ── Category suggestion ─────────────────────────────────────────────────────
/**
 * Suggest a category from the workspace's OWN history, not a model.
 *
 * Whatever they filed "Microsoft" under last time is a better predictor than any
 * general classifier, it costs nothing, it improves as they use the product, and
 * it never invents a category that isn't in their books. The keyword table is
 * only a cold-start fallback for a vendor they've never entered.
 */
const KEYWORD_CATEGORIES: [RegExp, string][] = [
  [/aws|amazon web|google cloud|azure|vercel|netlify|render|heroku|digitalocean|cloudflare|supabase/i, 'software'],
  [/microsoft|adobe|slack|notion|figma|atlassian|jira|github|gitlab|openai|anthropic|zoom|canva/i, 'software'],
  [/orlen|shell|bp |circle k|lotos|uber|bolt|taxi|pkp|intercity|ryanair|lot |wizzair|lufthansa|booking|airbnb|hotel/i, 'travel'],
  [/biedronka|lidl|żabka|zabka|carrefour|auchan|kaufland|tesco|restauracja|restaurant|catering|pizza|cafe|coffee/i, 'office'],
  [/orange|t-mobile|play |plus |vodafone|telekom|upc|netia/i, 'office'],
  [/zus|urząd skarbowy|urzad skarbowy|podatek|tax office|hmrc/i, 'payroll'],
  [/kancelaria|adwokat|radca|notariusz|legal|solicitor|accountant|księgow|ksiegow/i, 'other'],
];

export interface CategoryHistoryEntry { vendor: string; category: string }

const normaliseVendor = (v: string) =>
  String(v || '').toLowerCase().replace(/[^a-z0-9ąćęłńóśźż ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function suggestCategory(
  vendor: string | null,
  history: CategoryHistoryEntry[] = [],
): { category: string | null; source: 'history' | 'keyword' | null } {
  const v = normaliseVendor(vendor || '');
  if (!v) return { category: null, source: null };

  // Their own past choices win. Count them so the most-used category for a
  // vendor beats a one-off miscategorisation.
  const tally = new Map<string, number>();
  for (const h of history) {
    const hv = normaliseVendor(h.vendor);
    if (!hv || !h.category) continue;
    // Substring either way: "Microsoft" should match "Microsoft Ireland Ltd".
    if (hv === v || hv.includes(v) || v.includes(hv)) {
      tally.set(h.category, (tally.get(h.category) ?? 0) + 1);
    }
  }
  if (tally.size > 0) {
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { category: best, source: 'history' };
  }

  for (const [re, category] of KEYWORD_CATEGORIES) {
    if (re.test(v)) return { category, source: 'keyword' };
  }
  return { category: null, source: null };
}
