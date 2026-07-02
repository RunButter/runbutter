import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { buildFA3 } from '@/lib/ksef/fa3';
import { mockInvoiceDocument } from '@/lib/crm/mock';

export const runtime = 'nodejs';

/**
 * POST /api/ksef/invoice-xml  Body: { privyUserId, invoiceId }
 * Returns the invoice as a downloadable FA(3) XML for KSeF. Falls back to a
 * sample document when not signed in / the record can't be loaded, so the export
 * always produces something to inspect. (Live KSeF submission is a later phase.)
 */
export async function POST(req: Request) {
  try {
    const { privyUserId, invoiceId } = await req.json();

    let doc: any = null;
    if (privyUserId && invoiceId) {
      const admin = createAdminClient();
      const { data } = await admin.rpc('get_invoice_document', { p_privy: privyUserId, p_id: invoiceId });
      doc = data;
    }
    if (!doc) doc = mockInvoiceDocument(invoiceId || 'sample');

    const xml = buildFA3(doc);
    const name = (doc.number || 'faktura').toString().replace(/[^\w\-]/g, '_');
    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}-fa3.xml"`,
      },
    });
  } catch (e: any) {
    console.error('ksef invoice-xml error:', e);
    return NextResponse.json({ error: e?.message || 'KSeF export failed' }, { status: 500 });
  }
}
