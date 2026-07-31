import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A 1x1 transparent GIF, inline. Serving a real file would mean a filesystem
// read on every open of every newsletter.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/**
 * Open tracking. Addressed by DELIVERY id, so an open is tied to one specific
 * send rather than just to a person.
 *
 * The pixel is returned even when the id is unknown or recording fails. A broken
 * image icon in a customer's newsletter is a worse outcome than a lost stat, and
 * returning 404 would also confirm to a prober which ids are real.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const admin = createAdminClient();
    await admin.rpc('record_newsletter_event', { p_delivery: params.id, p_kind: 'open', p_url: null });
  } catch { /* never let tracking break the image */ }

  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      'content-type': 'image/gif',
      'content-length': String(PIXEL.length),
      // Without no-store, Gmail's image proxy caches the pixel and later opens
      // are never seen at all.
      'cache-control': 'no-store, no-cache, must-revalidate, private',
      pragma: 'no-cache',
    },
  });
}
