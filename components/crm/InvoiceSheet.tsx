import type { InvoiceDocument } from '@/lib/crm/data';
import { documentMath, sellerIdLines, taxLabel, docNum as num, docQty as qty, docMoney as money, docDate as day } from '@/lib/crm/document-math';

/**
 * An invoice or an offer as a sheet of A4 paper — on screen and on the printer.
 *
 * ── WHY THIS IS NOT THEMED ────────────────────────────────────────────────
 * Everything else in the product uses semantic tokens so dark mode works.
 * This is the one place that must NOT: a document is paper. It is white with
 * near-black ink whatever theme the person printing it uses, and the only
 * colour in it is the seller's brand accent. So it carries its own small
 * palette (scoped under `.inv`), in pt and mm — the units a printer counts in.
 *
 * ── PRINTING ──────────────────────────────────────────────────────────────
 * `@page { size: A4 }` with real margins, so the browser's "Save as PDF" and a
 * physical printer agree. On screen the sheet's padding stands in for those
 * margins (210 × 297 mm, the same text block); in print the padding goes and
 * @page takes over, which is what keeps page 2 of a long invoice from starting
 * at the very top edge. The items table repeats its header on every page and
 * never splits a row; the totals and payment blocks never split at all.
 *
 * ── WHAT A EUROPEAN INVOICE NEEDS ─────────────────────────────────────────
 * Net, VAT rate, VAT amount and gross per line, and a VAT summary per rate
 * (both are required on an EU VAT invoice, and every Polish accountant looks
 * for the summary first). Those columns show whenever a line carries VAT or the
 * seller is VAT-registered; a seller with no VAT id and no VAT on any line gets
 * the plain five-column layout an American invoice has.
 */

export default function InvoiceSheet({ doc }: { doc: InvoiceDocument }) {
  const isOffer = doc.kind === 'offer';
  const accent = /^#[0-9a-f]{6}$/i.test(doc.seller?.accent_color || '') ? doc.seller!.accent_color! : '#111827';
  const cur = doc.currency || 'USD';
  const seller = doc.seller || { name: 'Your company' };
  const buyer = doc.buyer;

  const { lines, showVat, net, vat, subtotal, discount, total, rates } = documentMath(doc);
  const sellerIds = sellerIdLines(seller);

  const initial = (seller.name || '?').trim().charAt(0).toUpperCase();

  return (
    <article className="inv" style={{ ['--acc' as any]: accent }} aria-label={`${isOffer ? 'Offer' : 'Invoice'} ${doc.number || ''}`}>
      <style>{CSS}</style>

      <header className="inv-head">
        <div className="inv-brand">
          {seller.logo_url
            ? <img src={seller.logo_url} alt="" className="inv-logo" />
            : <div className="inv-mono" aria-hidden="true">{initial}</div>}
          <div className="inv-seller-name">{seller.name}</div>
        </div>
        <div className="inv-title">
          <div className="inv-kind">{isOffer ? 'Offer' : 'Invoice'}</div>
          <div className="inv-no">No. {doc.number || '—'}</div>
          {doc.status === 'draft' && <div className="inv-flag">Draft</div>}
          {doc.status === 'paid' && !isOffer && <div className="inv-flag inv-flag-paid">Paid</div>}
        </div>
      </header>

      <section className="inv-meta">
        <div><span>Issue date</span><b>{day(doc.issued_at)}</b></div>
        <div><span>{isOffer ? 'Valid until' : 'Due date'}</span><b>{day(doc.due_at)}</b></div>
        {!isOffer && seller.iban && <div><span>Payment</span><b>Bank transfer</b></div>}
        <div><span>Currency</span><b>{cur}</b></div>
        <div><span>{isOffer ? 'Total' : 'Amount due'}</span><b className="inv-acc">{money(total, cur)}</b></div>
      </section>

      <section className="inv-parties">
        <div>
          <span className="inv-label">{isOffer ? 'From' : 'Seller'}</span>
          <div className="inv-party-name">{seller.name}</div>
          {seller.address && <div className="inv-pre">{seller.address}</div>}
          {sellerIds.map((s) => <div key={s} className="inv-muted">{s}</div>)}
        </div>
        <div>
          <span className="inv-label">{isOffer ? 'Prepared for' : 'Buyer'}</span>
          <div className="inv-party-name">{buyer?.name || '—'}</div>
          {buyer?.address && <div className="inv-pre">{buyer.address}</div>}
          {!buyer?.address && buyer?.domain && <div className="inv-pre">{buyer.domain}</div>}
          {buyer?.tax_id && <div className="inv-muted">{taxLabel(buyer.tax_id, buyer.country)}: {buyer.tax_id}</div>}
        </div>
      </section>

      <table className="inv-items">
        <thead>
          <tr>
            <th className="c-no">#</th>
            <th className="c-desc">Description</th>
            <th className="c-num">Qty</th>
            <th className="c-num">Unit price</th>
            {showVat && <th className="c-num">Net</th>}
            {showVat && <th className="c-num c-rate">VAT</th>}
            {showVat && <th className="c-num">VAT amt</th>}
            <th className="c-num">{showVat ? 'Gross' : 'Amount'}<span className="inv-cur"> {cur}</span></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="c-no">{i + 1}</td>
              <td className="c-desc">
                <div className="inv-desc">
                  {l.image && <img src={l.image} alt="" className="inv-thumb" />}
                  <div>
                    <div>{l.description}</div>
                    {l.note && <div className="inv-muted">{l.note}</div>}
                  </div>
                </div>
              </td>
              <td className="c-num">{qty(l.quantity)}</td>
              <td className="c-num">{num(l.unit)}</td>
              {showVat && <td className="c-num">{num(l.net)}</td>}
              {showVat && <td className="c-num c-rate">{l.rate}%</td>}
              {showVat && <td className="c-num">{num(l.vat)}</td>}
              <td className="c-num c-strong">{num(showVat ? l.gross : l.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="inv-sum">
        <div className="inv-sum-left">
          {showVat && (
            <table className="inv-rates">
              <thead><tr><th>VAT rate</th><th>Net</th><th>VAT</th><th>Gross <span className="inv-cur">{cur}</span></th></tr></thead>
              <tbody>
                {rates.map((v) => (
                  <tr key={v.rate}><td>{v.rate}%</td><td>{num(v.net)}</td><td>{num(v.vat)}</td><td>{num(v.net + v.vat)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="inv-totals">
          {discount > 0 && <div><span>Subtotal</span><span>{money(subtotal, cur)}</span></div>}
          {discount > 0 && <div><span>Discount</span><span>−{money(discount, cur)}</span></div>}
          <div><span>{showVat ? 'Total net' : 'Subtotal'}</span><span>{money(net, cur)}</span></div>
          {showVat && <div><span>VAT</span><span>{money(vat, cur)}</span></div>}
          <div className="inv-due"><span>{isOffer ? 'Total' : 'Total due'}</span><span>{money(total, cur)}</span></div>
        </div>
      </section>

      {!isOffer && seller.iban && (
        <section className="inv-box">
          <span className="inv-label">Payment details</span>
          <div className="inv-grid2">
            {seller.bank_name && <div><span>Bank</span><b>{seller.bank_name}</b></div>}
            <div><span>Account (IBAN)</span><b className="inv-mono-num">{seller.iban}</b></div>
            <div><span>Reference</span><b>{doc.number || '—'}</b></div>
            <div><span>Pay by</span><b>{day(doc.due_at)}</b></div>
          </div>
        </section>
      )}

      {doc.notes && (
        <section className="inv-notes">
          <span className="inv-label">Notes</span>
          <p>{doc.notes}</p>
        </section>
      )}

      {isOffer && (
        <section className="inv-accept">
          <span className="inv-label">Acceptance</span>
          <p className="inv-muted">To accept this offer, sign below or reply to the email it came with.</p>
          <div className="inv-sign">
            <div><i />Name</div>
            <div><i />Date</div>
            <div><i />Signature</div>
          </div>
        </section>
      )}

      <footer className="inv-foot">
        {seller.footer ? <span className="inv-pre">{seller.footer}</span> : <span>{seller.name}{seller.address ? ` · ${seller.address.split('\n')[0]}` : ''}</span>}
      </footer>
    </article>
  );
}

const CSS = `
.inv {
  --ink: #111827; --muted: #6b7280; --line: #e5e7eb; --soft: #f6f7f9;
  box-sizing: border-box; width: 210mm; min-height: 297mm; margin: 0 auto; padding: 14mm 15mm 16mm;
  background: #fff; color: var(--ink); font-size: 9.5pt; line-height: 1.45;
  display: flex; flex-direction: column; gap: 5.5mm;
  box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 12px 32px rgba(0,0,0,.10);
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
  font-variant-numeric: tabular-nums;
}
.inv *, .inv *::before, .inv *::after { box-sizing: border-box; }
.inv b { font-weight: 600; }
.inv-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10mm; padding-bottom: 5mm; border-bottom: 2px solid var(--acc); }
.inv-brand { display: flex; align-items: center; gap: 4mm; min-width: 0; }
.inv-logo { max-height: 15mm; max-width: 48mm; object-fit: contain; }
.inv-mono { width: 12mm; height: 12mm; border-radius: 3mm; background: var(--acc); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 16pt; font-weight: 600; flex-shrink: 0; }
.inv-seller-name { font-size: 12pt; font-weight: 600; }
.inv-title { text-align: right; flex-shrink: 0; }
.inv-kind { font-size: 22pt; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; }
.inv-no { margin-top: 1mm; font-size: 10.5pt; color: var(--muted); }
.inv-flag { display: inline-block; margin-top: 2mm; padding: 0.5mm 2.5mm; border: 1px solid var(--muted); border-radius: 1mm; font-size: 8pt; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
.inv-flag-paid { border-color: #15803d; color: #15803d; }
.inv-meta { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; border: 1px solid var(--line); border-radius: 2mm; }
.inv-meta > div { padding: 2.6mm 3.5mm; display: flex; flex-direction: column; gap: .8mm; }
.inv-meta > div + div { border-left: 1px solid var(--line); }
.inv-meta span, .inv-grid2 span, .inv-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
.inv-meta b { font-size: 10pt; }
.inv-acc { color: var(--acc); }
.inv-cur { font-weight: 400; letter-spacing: .04em; }
.inv-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; }
.inv-parties > div { display: flex; flex-direction: column; gap: .6mm; }
.inv-label { display: block; margin-bottom: 1.2mm; }
.inv-party-name { font-size: 11pt; font-weight: 600; }
.inv-pre { white-space: pre-line; }
.inv-muted { color: var(--muted); }
.inv-items { width: 100%; border-collapse: collapse; }
.inv-items thead { display: table-header-group; }
.inv-items th { font-size: 7.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); text-align: left; padding: 2mm 2mm; background: var(--soft); border-bottom: 1px solid var(--line); }
.inv-items td { padding: 2.2mm 2mm; border-bottom: 1px solid var(--line); vertical-align: top; }
.inv-items tr { break-inside: avoid; page-break-inside: avoid; }
.inv-items .c-no { width: 7mm; color: var(--muted); }
.inv-items .c-num { text-align: right; white-space: nowrap; }
.inv-items .c-rate { width: 12mm; }
.inv-items .c-strong { font-weight: 600; }
.inv-desc { display: flex; gap: 3mm; align-items: flex-start; }
.inv-thumb { width: 14mm; height: 14mm; object-fit: cover; border-radius: 1.5mm; border: 1px solid var(--line); flex-shrink: 0; }
.inv-sum { display: grid; grid-template-columns: 1fr 72mm; gap: 10mm; align-items: start; break-inside: avoid; page-break-inside: avoid; }
.inv-rates { border-collapse: collapse; font-size: 8.5pt; }
.inv-rates th { font-size: 7pt; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); text-align: right; padding: 1.2mm 3mm; border-bottom: 1px solid var(--line); }
.inv-rates td { text-align: right; padding: 1.2mm 3mm; border-bottom: 1px solid var(--line); }
.inv-rates th:first-child, .inv-rates td:first-child { text-align: left; padding-left: 0; }
.inv-totals > div { display: flex; justify-content: space-between; gap: 4mm; padding: 1mm 0; }
.inv-totals > div > span:last-child { white-space: nowrap; }
.inv-due { margin-top: 1.5mm; padding: 3mm 4mm !important; background: var(--soft); border-left: 3px solid var(--acc); font-size: 12pt; font-weight: 600; }
.inv-due > span:last-child { color: var(--acc); }
.inv-box { border: 1px solid var(--line); border-radius: 2mm; padding: 3.5mm 4mm; break-inside: avoid; page-break-inside: avoid; }
.inv-grid2 { display: grid; grid-template-columns: repeat(4, auto); gap: 2mm 8mm; justify-content: start; }
.inv-grid2 > div { display: flex; flex-direction: column; gap: .6mm; }
.inv-mono-num { font-variant-numeric: tabular-nums; letter-spacing: .02em; }
.inv-notes p { margin: 0; white-space: pre-line; }
.inv-accept { break-inside: avoid; page-break-inside: avoid; }
.inv-accept p { margin: 0 0 7mm; }
.inv-sign { display: grid; grid-template-columns: 1fr 1fr 1.4fr; gap: 8mm; font-size: 8pt; color: var(--muted); }
.inv-sign i { display: block; height: 0; border-top: 1px solid var(--ink); margin-bottom: 1.5mm; }
.inv-foot { margin-top: auto; padding-top: 3mm; border-top: 1px solid var(--line); font-size: 8pt; color: var(--muted); text-align: center; }

@media screen and (max-width: 860px) {
  .inv { width: 100%; min-height: 0; padding: 7vw 5vw; font-size: 9pt; }
  .inv-meta { grid-auto-flow: row; grid-template-columns: 1fr 1fr; }
  .inv-meta > div:nth-child(odd) { border-left: 0; }
  .inv-meta > div:nth-child(n+3) { border-top: 1px solid var(--line); }
  .inv-parties, .inv-sum { grid-template-columns: 1fr; gap: 6mm; }
  .inv-grid2 { grid-template-columns: 1fr 1fr; }
  .inv-items { display: block; overflow-x: auto; }
  .inv-items .c-desc { min-width: 46vw; }
}

@page { size: A4; margin: 14mm 15mm 16mm; @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 7.5pt; color: #9ca3af; } }
@media print {
  html, body { background: #fff !important; }
  .inv { width: auto; min-height: 0; padding: 0; margin: 0; box-shadow: none; }
  .inv-foot { margin-top: 6mm; }
}
`;
