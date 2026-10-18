// The numbers on an invoice or an offer — ZERO runtime imports.
//
// Shared by the A4 sheet on screen (components/crm/InvoiceSheet.tsx) and the
// PDF that is emailed (lib/pdf/document-pdf.ts). Two renderers of one document
// must never disagree about a VAT amount, so neither does arithmetic of its own.
import type { InvoiceDocument } from './data';

export interface DocLine {
  description: string;
  /** "10% discount applied" — said, never folded silently into the price. */
  note: string;
  image: string | null;
  quantity: number; unit: number;
  net: number; rate: number; vat: number; gross: number;
}

export interface DocMath {
  lines: DocLine[];
  /** Net / VAT / gross columns and the per-rate summary. */
  showVat: boolean;
  subtotal: number; discount: number; net: number; vat: number; total: number;
  /** VAT rate → net and VAT at that rate, highest rate first. */
  rates: { rate: number; net: number; vat: number }[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function documentMath(doc: Pick<InvoiceDocument, 'kind' | 'items' | 'amount' | 'category' | 'totals' | 'seller'>): DocMath {
  const isOffer = doc.kind === 'offer';
  // A document with no lines still reads as a document: one line for the
  // amount on its header, never an instruction to the person who sent it.
  const lines: DocLine[] = doc.items.length
    ? doc.items.map((it) => {
      const net = r2(it.line_total || 0);          // qty × price × (1 − discount): the SQL's rule
      const rate = Number(it.tax_rate) || 0;
      const vat = r2((net * rate) / 100);
      return {
        description: it.description || it.product || 'Item',
        note: it.discount_pct ? `${it.discount_pct}% discount applied` : '',
        image: isOffer && it.image ? it.image : null,
        quantity: Number(it.quantity) || 0, unit: Number(it.unit_price) || 0,
        net, rate, vat, gross: r2(net + vat),
      };
    })
    : [{ description: doc.category || (isOffer ? 'Proposed work' : 'Services'), note: '', image: null,
      quantity: 1, unit: doc.amount, net: doc.amount, rate: 0, vat: 0, gross: doc.amount }];

  // An EU VAT invoice must show net, rate, VAT and gross per line and a summary
  // per rate. A seller with no VAT id and no VAT on any line gets the plain
  // layout an American invoice has.
  const showVat = lines.some((l) => l.rate > 0) || !!doc.seller?.vat_id;
  const net = r2(lines.reduce((s, l) => s + l.net, 0));
  const vat = doc.totals ? doc.totals.tax : r2(lines.reduce((s, l) => s + l.vat, 0));
  const byRate = new Map<number, { net: number; vat: number }>();
  for (const l of lines) {
    const v = byRate.get(l.rate) || { net: 0, vat: 0 };
    v.net = r2(v.net + l.net); v.vat = r2(v.vat + l.vat);
    byRate.set(l.rate, v);
  }
  return {
    lines, showVat, net, vat,
    subtotal: doc.totals ? doc.totals.subtotal : net,
    discount: doc.totals ? doc.totals.discount : 0,
    total: doc.totals ? doc.totals.total : r2(net + vat),
    rates: [...byRate.entries()].sort((a, b) => b[0] - a[0]).map(([rate, v]) => ({ rate, ...v })),
  };
}

/** "NIP" for a bare Polish 10-digit number, else "VAT ID". */
export function taxLabel(taxId: string, country?: string | null): string {
  const digits = taxId.replace(/[^0-9]/g, '');
  return (country || 'PL') === 'PL' && digits.length === 10 && !/^[A-Z]{2}/i.test(taxId.trim()) ? 'NIP' : 'VAT ID';
}

export function sellerIdLines(s: InvoiceDocument['seller']): string[] {
  return [
    s?.tax_id && `${taxLabel(s.tax_id, s.country)}: ${s.tax_id}`,
    s?.vat_id && s.vat_id !== s.tax_id && `VAT ID: ${s.vat_id}`,
    s?.reg_no && `Reg. no: ${s.reg_no}`,
    s?.bdo && `BDO: ${s.bdo}`,
  ].filter(Boolean) as string[];
}

const NUM = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** A table cell: the bare number. The currency is said once, in the headers and totals. */
export const docNum = (n: number) => NUM.format(Number.isFinite(n) ? n : 0);
export const docQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('en-US', { maximumFractionDigits: 3 }));

const MONEY = new Map<string, Intl.NumberFormat>();
export function docMoney(n: number, currency: string): string {
  let f = MONEY.get(currency);
  if (!f) {
    try { f = new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    catch { f = NUM; }
    MONEY.set(currency, f);
  }
  return f.format(Number.isFinite(n) ? n : 0);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/**
 * "15 Oct 2026". An invoice date is a DATE: read from the string, never through
 * a Date in the reader's zone (midnight UTC is the day before west of
 * Greenwich), and the same on the server that builds the PDF as in the browser.
 */
export function docDate(v: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '');
  if (!m) return '—';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
