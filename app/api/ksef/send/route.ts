import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { buildFA3 } from '@/lib/ksef/fa3';
import { sendInvoiceToKSeF } from '@/lib/ksef/service';

export const runtime = 'nodejs';

/**
 * POST /api/ksef/send  Body: { privyUserId, invoiceId }
 * Builds the FA(3) XML for the invoice and submits it to KSeF under the
 * invoice's workspace (tenant), then records the returned reference number.
 * get_invoice_document enforces that the caller may access this invoice.
 */
export async function POST(req: Request) {
  try {
    const { privyUserId, invoiceId } = await req.json();
    if (!privyUserId || !invoiceId) {
      return NextResponse.json({ error: 'privyUserId and invoiceId are required' }, { status: 400 });
    }

    const admin = createAdminClient();

    // Authorised load (returns null if the caller can't see this invoice).
    const { data: doc, error } = await admin.rpc('get_invoice_document', { p_privy: privyUserId, p_id: invoiceId });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!doc) return NextResponse.json({ error: 'Invoice not found or access denied' }, { status: 404 });

    // Tenant = the invoice's own workspace.
    const { data: inv } = await admin.from('invoices').select('workspace_id').eq('id', invoiceId).maybeSingle();
    if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    const xml = buildFA3(doc as any);

    try {
      const { referenceNumber } = await sendInvoiceToKSeF(inv.workspace_id, xml);
      await admin.from('invoices').update({ ksef_ref: referenceNumber, ksef_status: 'sent' }).eq('id', invoiceId);
      return NextResponse.json({ ok: true, referenceNumber });
    } catch (sendErr: any) {
      await admin.from('invoices').update({ ksef_status: 'rejected' }).eq('id', invoiceId);
      return NextResponse.json({ error: sendErr.message }, { status: 502 });
    }
  } catch (e: any) {
    console.error('ksef send error:', e);
    return NextResponse.json({ error: e?.message || 'KSeF send failed' }, { status: 500 });
  }
}
