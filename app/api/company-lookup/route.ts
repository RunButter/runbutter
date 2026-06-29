import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * POST /api/company-lookup  Body: { country, taxId }
 * Looks up a company by tax/VAT id and returns { name, address, tax_id, ... }.
 *   PL -> Ministry of Finance "Biała lista" (NIP), free, no key.
 *   any other EU country -> VIES (EU VAT validation), free, no key.
 */
const cleanId = (s: string) => String(s || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();

async function lookupPL(nip: string) {
  const date = new Date().toISOString().slice(0, 10);
  const res = await fetch(`https://wl-api.mf.gov.pl/api/search/nip/${nip}?date=${date}`, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    let msg = `Polish registry lookup failed (${res.status})`;
    try { const j = await res.json(); msg = j?.message || j?.code || msg; } catch {}
    return { error: msg };
  }
  const subject = (await res.json())?.result?.subject;
  if (!subject) return { error: 'No company found for that NIP.' };
  return {
    name: subject.name || '',
    address: subject.workingAddress || subject.residenceAddress || '',
    tax_id: subject.nip || nip,
    country: 'PL',
    regon: subject.regon || null,
    vatStatus: subject.statusVat || null,
    source: 'MF Biała lista',
  };
}

async function lookupVIES(country: string, number: string) {
  const res = await fetch(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${country}/vat/${number}`, { headers: { accept: 'application/json' } });
  if (!res.ok) return { error: `VIES lookup failed (${res.status})` };
  const j = await res.json();
  const valid = j?.valid ?? j?.isValid;
  if (valid === false) return { error: `VAT number ${country}${number} is not valid in VIES.` };
  return {
    name: (j?.name || j?.traderName || '').trim(),
    address: (j?.address || j?.traderAddress || '').replace(/\s*\n\s*/g, ', ').trim(),
    tax_id: `${country}${number}`,
    country,
    vatStatus: valid ? 'Valid' : null,
    source: 'EU VIES',
  };
}

export async function POST(req: Request) {
  try {
    const { country, taxId } = await req.json();
    if (!country || !taxId) return NextResponse.json({ error: 'country and taxId are required' }, { status: 400 });

    const c = String(country).toUpperCase();
    let id = cleanId(taxId);
    if (id.startsWith(c)) id = id.slice(c.length); // user may have typed the country prefix

    const result: any = c === 'PL' ? await lookupPL(id) : await lookupVIES(c, id);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ ok: true, company: result });
  } catch (e: any) {
    console.error('company-lookup error:', e);
    return NextResponse.json({ error: e?.message || 'Lookup failed' }, { status: 500 });
  }
}
