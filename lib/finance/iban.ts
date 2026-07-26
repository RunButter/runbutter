// IBAN validation — ISO 13616, done locally.
//
// Deliberately NOT an API call. The whole check is a length table plus the
// mod-97 checksum, both of which are part of the standard, so there is nothing
// to fetch, nothing to rate-limit and nothing to leak: a customer's bank
// account never leaves the browser. A wrong IBAN on an invoice means the money
// never arrives, and the checksum catches essentially every single-character
// typo and adjacent transposition — which is what people actually get wrong.
//
// What this CANNOT tell you: whether the account exists, or whether it belongs
// to who you think. Only the bank knows that. `valid` here means "structurally
// a real IBAN", nothing more — the UI copy should not overpromise.

/** IBAN total length per country, from the SWIFT IBAN registry. */
const IBAN_LENGTH: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27,
  BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28,
  EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23,
  GL: 18, GR: 27, GT: 28, HN: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26,
  IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21,
  LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MN: 20, MR: 27, MT: 31, MU: 30, MZ: 25,
  NI: 28, NL: 18, NO: 15, OM: 23, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24,
  RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27, SO: 23,
  ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20,
};

/** Country names for the ones above, so the UI can confirm what was detected. */
const COUNTRY_NAME: Record<string, string> = {
  AD: 'Andorra', AE: 'United Arab Emirates', AL: 'Albania', AT: 'Austria', AZ: 'Azerbaijan',
  BA: 'Bosnia and Herzegovina', BE: 'Belgium', BG: 'Bulgaria', BH: 'Bahrain', BI: 'Burundi',
  BR: 'Brazil', BY: 'Belarus', CH: 'Switzerland', CR: 'Costa Rica', CY: 'Cyprus',
  CZ: 'Czechia', DE: 'Germany', DJ: 'Djibouti', DK: 'Denmark', DO: 'Dominican Republic',
  EE: 'Estonia', EG: 'Egypt', ES: 'Spain', FI: 'Finland', FK: 'Falkland Islands',
  FO: 'Faroe Islands', FR: 'France', GB: 'United Kingdom', GE: 'Georgia', GI: 'Gibraltar',
  GL: 'Greenland', GR: 'Greece', GT: 'Guatemala', HN: 'Honduras', HR: 'Croatia',
  HU: 'Hungary', IE: 'Ireland', IL: 'Israel', IQ: 'Iraq', IS: 'Iceland', IT: 'Italy',
  JO: 'Jordan', KW: 'Kuwait', KZ: 'Kazakhstan', LB: 'Lebanon', LC: 'Saint Lucia',
  LI: 'Liechtenstein', LT: 'Lithuania', LU: 'Luxembourg', LV: 'Latvia', LY: 'Libya',
  MC: 'Monaco', MD: 'Moldova', ME: 'Montenegro', MK: 'North Macedonia', MN: 'Mongolia',
  MR: 'Mauritania', MT: 'Malta', MU: 'Mauritius', MZ: 'Mozambique', NI: 'Nicaragua',
  NL: 'Netherlands', NO: 'Norway', OM: 'Oman', PK: 'Pakistan', PL: 'Poland',
  PS: 'Palestine', PT: 'Portugal', QA: 'Qatar', RO: 'Romania', RS: 'Serbia',
  RU: 'Russia', SA: 'Saudi Arabia', SC: 'Seychelles', SD: 'Sudan', SE: 'Sweden',
  SI: 'Slovenia', SK: 'Slovakia', SM: 'San Marino', SO: 'Somalia', ST: 'Sao Tome and Principe',
  SV: 'El Salvador', TL: 'Timor-Leste', TN: 'Tunisia', TR: 'Turkey', UA: 'Ukraine',
  VA: 'Vatican City', VG: 'Virgin Islands (British)', XK: 'Kosovo',
};

export interface IbanCheck {
  valid: boolean;
  /** Machine-readable failure reason; null when valid. */
  reason: 'empty' | 'charset' | 'unknown_country' | 'length' | 'checksum' | null;
  /** Human-readable message, safe to render directly. */
  message: string;
  /** ISO country code parsed from the first two characters, when plausible. */
  country: string | null;
  countryName: string | null;
  /** Canonical, space-free uppercase form — store this. */
  compact: string;
  /** Grouped in fours for display. */
  formatted: string;
  /** Expected total length for the detected country, when known. */
  expectedLength: number | null;
}

/** Strip spaces/punctuation and uppercase. The canonical storage form. */
export function compactIban(input: string): string {
  return String(input || '').replace(/[\s .\-_/]/g, '').toUpperCase();
}

/** Group in fours — how IBANs are printed on invoices and bank statements. */
export function formatIban(input: string): string {
  return compactIban(input).replace(/(.{4})/g, '$1 ').trim();
}

// mod-97-10 over a string that can be 30+ digits once letters expand, which
// overflows a double. Fold it 7 digits at a time instead — the classic trick,
// and it avoids depending on BigInt.
function mod97(digits: string): number {
  let remainder = 0;
  for (let i = 0; i < digits.length; i += 7) {
    remainder = Number(String(remainder) + digits.slice(i, i + 7)) % 97;
  }
  return remainder;
}

/**
 * Validate an IBAN's structure and checksum.
 *
 * Returns a rich result rather than a boolean so the form can say WHY it is
 * rejected — "should be 28 characters for Poland, you typed 27" is actionable,
 * "invalid IBAN" is not.
 */
export function validateIban(input: string): IbanCheck {
  const compact = compactIban(input);
  const formatted = formatIban(compact);
  const base: Omit<IbanCheck, 'valid' | 'reason' | 'message'> = {
    country: null, countryName: null, compact, formatted, expectedLength: null,
  };

  if (!compact) {
    return { ...base, valid: false, reason: 'empty', message: '' };
  }
  if (!/^[A-Z0-9]+$/.test(compact)) {
    return { ...base, valid: false, reason: 'charset', message: 'An IBAN contains only letters and digits.' };
  }

  const country = compact.slice(0, 2);
  const expectedLength = IBAN_LENGTH[country] ?? null;
  const countryName = COUNTRY_NAME[country] ?? null;
  const ctx = { ...base, country, countryName, expectedLength };

  if (!/^[A-Z]{2}\d{2}/.test(compact)) {
    return { ...ctx, valid: false, reason: 'charset', message: 'An IBAN starts with two country letters and two check digits.' };
  }
  if (expectedLength === null) {
    return { ...ctx, valid: false, reason: 'unknown_country', message: `"${country}" is not an IBAN country code.` };
  }
  if (compact.length !== expectedLength) {
    const diff = compact.length - expectedLength;
    const off = diff > 0 ? `${diff} too many` : `${-diff} missing`;
    return {
      ...ctx, valid: false, reason: 'length',
      message: `${countryName} IBANs are ${expectedLength} characters — this has ${compact.length} (${off}).`,
    };
  }

  // Move the first four characters to the end, expand letters to numbers
  // (A=10 … Z=35), then the whole thing mod 97 must be exactly 1.
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let digits = '';
  for (const ch of rearranged) {
    digits += ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
  }
  if (mod97(digits) !== 1) {
    return {
      ...ctx, valid: false, reason: 'checksum',
      message: 'Checksum failed — there is a typo somewhere in this number.',
    };
  }

  return { ...ctx, valid: true, reason: null, message: `Valid ${countryName} IBAN.` };
}

/** Convenience boolean for callers that only need pass/fail. */
export const isValidIban = (input: string): boolean => validateIban(input).valid;
