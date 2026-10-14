// Tax identifiers: what was typed, which country it belongs to, and how it is
// printed. Pure and import-free, so the browser (lib/company/client.ts) and the
// server (lookup.ts) parse a number the same way.

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
export const VIES = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI']);

/** Tax numbers outside VIES that a free register answers for (lib/company/registers.ts), plus the UK. */
export const NON_EU_TAX = new Set(['CH', 'NO', 'GB', 'US', 'BR']);

/**
 * "PL 526-025-09-95", "pl5260250995", "5260250995" with no country, "DE123456789"
 * with the country left on Poland — all mean something, and the form used to
 * accept only the one shape. Outside the EU: "CHE-105.909.036 MWST", "NO 923 609
 * 016 MVA", "GB 220 4302 31", an EIN "94-2404110", a CNPJ "00.000.000/0001-91".
 */
export function normalizeTaxId(countryIn: string, raw: string): { country: string; id: string } {
  const typed = String(raw || '').trim();
  let id = typed.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  let country = String(countryIn || '').toUpperCase().trim();
  if (/^CHE\d{9}(MWST|TVA|IVA|HR)?$/.test(id)) return { country: 'CH', id: id.slice(3, 12) };
  if (/^NO\d{9}(MVA)?$/.test(id)) return { country: 'NO', id: id.slice(2, 11) };
  if (/^GB(\d{9}|\d{12})$/.test(id)) return { country: 'GB', id: id.slice(2) };
  const prefix = id.slice(0, 2);
  if (/^[A-Z]{2}$/.test(prefix) && (VIES.has(prefix) || prefix === 'GR')) {
    country = prefix; id = id.slice(2);
  }
  if (country === 'CH') id = id.replace(/^CHE/, '').replace(/(MWST|TVA|IVA|HR)$/, '');
  if (country === 'NO') id = id.replace(/MVA$/, '');
  if (!country && validNip(id)) country = 'PL';
  if (!country && /^\d{2}-\d{7}$/.test(typed)) country = 'US';
  if (!country && /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(typed)) country = 'BR';
  if (country === 'GR') country = 'EL';
  return { country, id };
}

/** The number as it is printed (and searched for): DE123456789, CHE123456789, NO123456789MVA. */
export function printedTaxId(country: string, id: string): string {
  if (country === 'CH') return `CHE${id}`;
  if (country === 'NO') return `NO${id}MVA`;
  if (country === 'US') return id.length === 9 ? `${id.slice(0, 2)}-${id.slice(2)}` : id;
  if (country === 'BR' || country === 'PL') return country === 'PL' ? `PL${id}` : id;
  return `${country === 'GR' ? 'EL' : country}${id}`;
}
