import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { buildDocumentPdf } from '@/lib/pdf/document-pdf';
import { mockInvoiceDocument } from '@/lib/crm/mock';

export const runtime = 'nodejs';

/**
 * GET /api/documents/[id]/pdf?t=<share_token>
 * Streams the invoice/offer as a downloadable A4 PDF. The share token is the
 * authorisation (same model as the public document view) — safe to put in an
 * email. Non-uuid sample ids render the demo document; real ids without a
 * valid token get 404 (never sample data).
 */
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    const token = new URL(req.url).searchParams.get('t');

    let doc: any = null;
    if (isUuid(id)) {
      if (!token) return NextResponse.json({ error: 'Missing share token' }, { status: 401 });
      const admin = createAdminClient();
      const { data, error } = await admin.rpc('get_invoice_document_public', { p_id: id, p_token: token });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data) return NextResponse.json({ error: 'Document not found or link invalid' }, { status: 404 });
      doc = data;
    } else {
      doc = mockInvoiceDocument(id); // sample/demo ids only
    }

    const pdf = await buildDocumentPdf(doc);
    const name = String(doc.number || (doc.kind === 'offer' ? 'offer' : 'invoice')).replace(/[^\w\-]/g, '_');
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${name}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    console.error('document pdf error:', e);
    return NextResponse.json({ error: e?.message || 'PDF generation failed' }, { status: 500 });
  }
}
