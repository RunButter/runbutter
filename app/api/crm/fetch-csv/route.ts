import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Fetches a public CSV URL server-side (avoids browser CORS), e.g. a Google
// Sheets "Publish to web -> CSV" link. Basic SSRF guard: https only + block
// internal/private hosts.
function isBlocked(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1' || h.endsWith('.local')) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'url required' }, { status: 400 });
    }
    let u: URL;
    try { u = new URL(url); } catch { return NextResponse.json({ error: 'invalid url' }, { status: 400 }); }
    if (u.protocol !== 'https:' || isBlocked(u.hostname)) {
      return NextResponse.json({ error: 'Only public https URLs are allowed' }, { status: 400 });
    }

    const res = await fetch(u.toString(), { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!res.ok) return NextResponse.json({ error: `Fetch failed (${res.status})` }, { status: 502 });

    const text = await res.text();
    if (text.length > 5_000_000) return NextResponse.json({ error: 'File too large (>5MB)' }, { status: 413 });
    return NextResponse.json({ text });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'fetch-csv failed' }, { status: 500 });
  }
}
