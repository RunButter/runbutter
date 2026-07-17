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
  const res = await fetch(`https://wl-api.mf.gov.pl/api/search/nip/${nip}?date=${date}`, {
    headers: { accept: 'application/json', 'user-agent': 'RunButter/1.0 (+https://runbutter.app)' },
  });
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

// VIES uses "---" to mean "not provided" and many member states (e.g. DE, ES)
// never return the trader name/address — only validation. Normalise that.
const viesClean = (v: any) => { const s = String(v ?? '').trim(); return !s || s === '---' ? '' : s; };

async function lookupVIES(country: string, number: string) {
  const res = await fetch(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${country}/vat/${number}`, {
    headers: { accept: 'application/json', 'user-agent': 'RunButter/1.0 (+https://runbutter.app)' },
  });
  if (!res.ok) return { error: `VIES lookup failed (HTTP ${res.status}). Try again shortly.` };
  const j = await res.json();
  const valid = j?.isValid ?? j?.valid;
  const ue = j?.userError;
  if (valid === false) return { error: `VAT number ${country}${number} is not valid in VIES.` };
  if (ue && ue !== 'VALID') return { error: `VIES service issue (${ue}) — please try again in a moment.` };

  const name = viesClean(j?.name ?? j?.traderName);
  const address = viesClean(j?.address ?? j?.traderAddress).replace(/\s*\n\s*/g, ', ');
  return {
    name, address, tax_id: `${country}${number}`, country, vatStatus: 'Valid', source: 'EU VIES',
    // most EU states don't expose the name via VIES — say so instead of failing
    note: name ? undefined : `${country} VAT is valid, but this country doesn't return the company name/address via VIES — please fill them in manually.`,
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
