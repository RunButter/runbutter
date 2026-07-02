import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase';

export const runtime = 'nodejs';

/**
 * POST /api/finance/send-document
 * Body: { privyUserId, invoiceId, to, message? }
 *
 * Emails a branded invoice/offer summary (with a link to the hosted document)
 * to a recipient via Resend, and marks the document as "sent". Authorization is
 * enforced by get_invoice_document, which only returns rows in the caller's
 * workspaces.
 */
const money = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n || 0);
const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function POST(req: Request) {
  try {
    const { privyUserId, invoiceId, to, message } = await req.json();
    if (!privyUserId || !invoiceId || !to) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: doc, error } = await admin.rpc('get_invoice_document', { p_privy: privyUserId, p_id: invoiceId });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!doc) return NextResponse.json({ error: 'Document not found or access denied' }, { status: 404 });

    const d = doc as any;
    const isOffer = d.kind === 'offer';
    const title = isOffer ? 'Offer' : 'Invoice';
    const items: any[] = Array.isArray(d.items) ? d.items : [];
    const T = d.totals || null;
    const total = T ? +T.total : (items.length ? items.reduce((s, it) => s + (+it.line_total || 0), 0) : (+d.amount || 0));
    const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    // Share token (0025) lets the recipient open the REAL document without an
    // account. Without it the page is login-gated and a client would see nothing.
    const link = `${origin}/documents/${invoiceId}${d.share_token ? `?t=${d.share_token}` : ''}`;
    const sellerName = d.seller?.name || 'Your company';
    const accent = d.seller?.accent_color || '#6366F1';
    const logo = d.seller?.logo_url;
    const footer = d.seller?.footer;

    const rows = items.map((it) => {
      // Product images: offers only (invoices stay formal). Only http(s) images
      // render reliably in mail clients (data: URIs are blocked).
      const img = isOffer && it.image && /^https?:\/\//i.test(it.image)
        ? `<img src="${esc(it.image)}" alt="" width="56" height="56" style="width:56px;height:56px;border-radius:8px;object-fit:cover;vertical-align:middle;margin-right:10px;" />`
        : '';
      return `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #EEE;color:#333;">${img}${esc(it.description || it.product || 'Item')}${+it.discount_pct ? ` <span style="color:#059669;font-size:12px;">−${it.discount_pct}%</span>` : ''}</td>
        <td style="padding:8px 0;border-bottom:1px solid #EEE;text-align:right;color:#666;">${it.quantity}</td>
        <td style="padding:8px 0;border-bottom:1px solid #EEE;text-align:right;color:#666;">${money(+it.unit_price || 0, d.currency)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #EEE;text-align:right;color:#999;">${it.tax_rate ? it.tax_rate + '%' : '—'}</td>
        <td style="padding:8px 0;border-bottom:1px solid #EEE;text-align:right;font-weight:600;color:#111;">${money(+it.line_total || 0, d.currency)}</td>
      </tr>`;
    }).join('');

    const totalsHtml = T ? `
      <table style="margin-left:auto;font-size:14px;margin-top:12px;">
        <tr><td style="padding:2px 0;color:#6B7280;">Subtotal</td><td style="padding:2px 0 2px 24px;text-align:right;">${money(+T.subtotal, d.currency)}</td></tr>
        ${+T.discount > 0 ? `<tr><td style="padding:2px 0;color:#059669;">Discount</td><td style="padding:2px 0 2px 24px;text-align:right;color:#059669;">−${money(+T.discount, d.currency)}</td></tr>` : ''}
        ${+T.tax > 0 ? `<tr><td style="padding:2px 0;color:#6B7280;">VAT</td><td style="padding:2px 0 2px 24px;text-align:right;">${money(+T.tax, d.currency)}</td></tr>` : ''}
        <tr><td style="padding:8px 0 0;font-weight:800;font-size:16px;">${isOffer ? 'Estimated total' : 'Total'}</td><td style="padding:8px 0 0 24px;text-align:right;font-weight:800;font-size:16px;color:${accent};">${money(total, d.currency)}</td></tr>
      </table>`
      : `<div style="text-align:right;font-size:18px;font-weight:800;margin-top:16px;">${isOffer ? 'Estimated total' : 'Total'}: ${money(total, d.currency)}</div>`;

    const html = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;color:#111;">
        <div style="height:6px;background:${accent};border-radius:6px;margin-bottom:24px;"></div>
        ${logo ? `<img src="${esc(logo)}" alt="" style="height:44px;border-radius:8px;margin-bottom:8px;" />` : ''}
        <p style="font-size:13px;color:#6B7280;margin:0;">${esc(sellerName)}</p>
        <h1 style="font-size:22px;margin:4px 0 2px;">${title} ${esc(d.number || '')}</h1>
        ${d.due_at ? `<p style="font-size:13px;color:#6B7280;margin:0 0 16px;">${isOffer ? 'Valid until' : 'Due'} ${esc(d.due_at)}</p>` : ''}
        ${message ? `<div style="background:#F9FAFB;border:1px solid #EEE;border-radius:8px;padding:12px 16px;margin:16px 0;white-space:pre-wrap;line-height:1.6;">${esc(message)}</div>` : ''}
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:8px;">
          <thead><tr>
            <th style="text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9CA3AF;padding-bottom:6px;">Description</th>
            <th style="text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9CA3AF;padding-bottom:6px;">Qty</th>
            <th style="text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9CA3AF;padding-bottom:6px;">Unit</th>
            <th style="text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9CA3AF;padding-bottom:6px;">VAT</th>
            <th style="text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9CA3AF;padding-bottom:6px;">Amount</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${totalsHtml}
        <div style="text-align:center;margin:28px 0;">
          <a href="${link}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:10px;">View &amp; download ${title.toLowerCase()}</a>
        </div>
        ${d.notes ? `<p style="font-size:13px;color:#6B7280;line-height:1.6;">${esc(d.notes)}</p>` : ''}
        ${footer ? `<p style="font-size:12px;color:#6B7280;line-height:1.6;border-top:1px solid #E5E7EB;padding-top:12px;">${esc(footer)}</p>` : ''}
        <hr style="border:0;border-top:1px solid #E5E7EB;margin:24px 0;" />
        <p style="font-size:12px;color:#9CA3AF;text-align:center;">Sent via hirebtr.com</p>
      </div>`;

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'no_api_key' });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error: sendErr } = await resend.emails.send({
      from: 'hirebtr.com <hello@hirebtr.com>',
      to: [to],
      subject: `${title} ${d.number || ''} from ${sellerName}`.trim(),
      html,
    });
    if (sendErr) {
      console.error('send-document Resend error:', sendErr);
      return NextResponse.json({ error: sendErr.message }, { status: 500 });
    }

    // Mark as sent (best-effort).
    await admin.rpc('update_record', { p_privy: privyUserId, p_object: 'invoices', p_id: invoiceId, p_data: { status: 'sent' } });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('send-document route error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
