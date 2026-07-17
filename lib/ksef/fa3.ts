import type { InvoiceDocument } from '@/lib/crm/data';

// FA(3) e-invoice XML for Poland's KSeF.
// ⚠️ DRAFT structural mapping of the CORE mandatory fields only. Before any
// production use, validate the output against the official FA(3) XSD (namespace
// below) and have a tax advisor confirm the field mapping (esp. the Adnotacje
// flags and the P_13/P_14 VAT-rate slots). Live submission (auth challenge →
// encrypted token → session → UPO) is a separate phase that needs a KSeF token.
const NS = 'http://crd.gov.pl/wzor/2025/06/25/13775/'; // FA(3)

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dec = (n: any) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const nipDigits = (s: any) => String(s ?? '').replace(/[^0-9]/g, '');
const dateOnly = (s: any) => (s ? String(s).slice(0, 10) : new Date().toISOString().slice(0, 10));

interface Party { name?: string; tax_id?: string | null; address?: string | null; country?: string | null }

function party(tag: string, p: Party | null | undefined) {
  const nip = nipDigits(p?.tax_id);
  const id = nip.length === 10
    ? `<NIP>${nip}</NIP>`
    : (p?.tax_id ? `<NrVatUE>${esc(p!.tax_id)}</NrVatUE>` : `<BrakID>1</BrakID>`);
  return `  <${tag}>
    <DaneIdentyfikacyjne>
      ${id}
      <Nazwa>${esc(p?.name || 'Brak nazwy')}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>${esc((p?.country || 'PL')).slice(0, 2).toUpperCase()}</KodKraju>
      <AdresL1>${esc(p?.address || '-')}</AdresL1>
    </Adres>
  </${tag}>`;
}

export function buildFA3(doc: InvoiceDocument): string {
  const created = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const currency = (doc.currency || 'PLN').toUpperCase();
  const items = doc.items || [];

  // net + VAT grouped by rate
  const byRate = new Map<number, { net: number; vat: number }>();
  for (const it of items) {
    const gross = (it.quantity || 0) * (it.unit_price || 0);
    const net = gross * (1 - (it.discount_pct || 0) / 100);
    const rate = Number(it.tax_rate || 0);
    const cur = byRate.get(rate) || { net: 0, vat: 0 };
    cur.net += net; cur.vat += net * rate / 100;
    byRate.set(rate, cur);
  }
  const at = (r: number) => byRate.get(r) || { net: 0, vat: 0 };
  const gross = doc.totals ? doc.totals.total : [...byRate.values()].reduce((s, v) => s + v.net + v.vat, 0);

  const rows = items.map((it, i) => {
    const g = (it.quantity || 0) * (it.unit_price || 0);
    const net = g * (1 - (it.discount_pct || 0) / 100);
    return `    <FaWiersz>
      <NrWierszaFa>${i + 1}</NrWierszaFa>
      <P_7>${esc(it.description || it.product || 'Pozycja')}</P_7>
      <P_8A>szt.</P_8A>
      <P_8B>${dec(it.quantity)}</P_8B>
      <P_9A>${dec(it.unit_price)}</P_9A>
      <P_11>${dec(net)}</P_11>
      <P_12>${Number(it.tax_rate || 0)}</P_12>
    </FaWiersz>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="${NS}">
  <Naglowek>
    <KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza>
    <WariantFormularza>3</WariantFormularza>
    <DataWytworzeniaFa>${created}</DataWytworzeniaFa>
    <SystemInfo>RunButter</SystemInfo>
  </Naglowek>
${party('Podmiot1', doc.seller as Party)}
${party('Podmiot2', doc.buyer as Party)}
  <Fa>
    <KodWaluty>${esc(currency)}</KodWaluty>
    <P_1>${dateOnly(doc.issued_at)}</P_1>
    <P_2>${esc(doc.number || '')}</P_2>
    <P_13_1>${dec(at(23).net)}</P_13_1>
    <P_14_1>${dec(at(23).vat)}</P_14_1>
    <P_13_2>${dec(at(8).net)}</P_13_2>
    <P_14_2>${dec(at(8).vat)}</P_14_2>
    <P_13_3>${dec(at(5).net)}</P_13_3>
    <P_14_3>${dec(at(5).vat)}</P_14_3>
    <P_13_7>${dec(at(0).net)}</P_13_7>
    <P_15>${dec(gross)}</P_15>
    <Adnotacje>
      <P_16>2</P_16>
      <P_17>2</P_17>
      <P_18>2</P_18>
      <P_18A>2</P_18A>
      <Zwolnienie><P_19N>1</P_19N></Zwolnienie>
      <NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu>
      <P_23>2</P_23>
      <PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy>
    </Adnotacje>
    <RodzajFaktury>VAT</RodzajFaktury>
${rows}
  </Fa>
</Faktura>`;
}
