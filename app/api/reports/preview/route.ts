import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { buildReport, periodFor } from '@/lib/reports/build';
import { SECTION_IDS } from '@/lib/reports/registry';

export const runtime = 'nodejs';
export const maxDuration = 60;   // PDF generation runs several queries

// Generate a report right now and return the PDF. Lets someone see exactly what
// a schedule will send before waiting a week for it, and doubles as the
// "download this period" button.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`report:${clientIp(req)}`, 10);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') {
    return NextResponse.json({ error: 'Your session is invalid or expired. Sign in again.' }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  const frequency: 'weekly' | 'monthly' = body?.frequency === 'monthly' ? 'monthly' : 'weekly';
  const requested: string[] = Array.isArray(body?.sections) ? body.sections : [];
  const sections = requested.filter((s) => SECTION_IDS.includes(s));
  if (!sections.length) return NextResponse.json({ error: 'Pick at least one section.' }, { status: 400 });

  const db = createAdminClient();

  // Workspace comes from the caller's own session — never the request body.
  const { data: ws, error: wsErr } = await db.rpc('get_my_workspace', { p_privy: v.userId });
  if (wsErr || !ws?.id) return NextResponse.json({ error: 'No workspace found for your account.' }, { status: 400 });

  const { from, to } = periodFor(frequency);
  const { pdf, skipped } = await buildReport({
    db, workspaceId: ws.id, workspaceName: ws.name || 'Workspace', privy: v.userId,
    sectionIds: sections, from, to, title: typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : undefined,
  });

  const filename = `runbutter-report-${to.toISOString().slice(0, 10)}.pdf`;
  return new NextResponse(pdf as any, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${filename}"`,
      'x-skipped-sections': skipped.join(',') || 'none',
      'cache-control': 'no-store',
    },
  });
}
