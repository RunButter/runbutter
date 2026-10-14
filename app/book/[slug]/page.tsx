import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase';
import BookingWidget, { type PublicBookingPage } from '@/components/booking/BookingWidget';

/**
 * /book/<slug> — a booking page (0135). Public, framable (next.config.js
 * exempts /book/* from X-Frame-Options), `?embed=1` drops the page chrome for
 * an iframe on a customer's site.
 *
 * Read with the service role in a server component, like /support/<id>, so
 * nothing joins the anon-callable list; a page that is off or unknown is a 404.
 * The free times are fetched by the widget from /api/booking/<slug>.
 */

export const dynamic = 'force-dynamic';

async function load(slug: string): Promise<PublicBookingPage | null> {
  if (!/^[a-z0-9][a-z0-9-]{2,48}[a-z0-9]$/.test(slug)) return null;
  try {
    const now = new Date();
    const { data, error } = await createAdminClient().rpc('booking_public', {
      p_slug: slug, p_from: now.toISOString(), p_to: now.toISOString(),
    });
    if (error || !data) return null;
    const { busy: _busy, ...page } = data as any;
    return page as PublicBookingPage;
  } catch { return null; }
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const p = await load(params.slug);
  if (!p) return { title: 'Book a meeting', robots: { index: false, follow: false } };
  const who = [p.host?.name, p.company?.name].filter(Boolean).join(' · ');
  return {
    title: `${p.title}${who ? ` — ${who}` : ''}`,
    description: p.description?.slice(0, 160) || `Book ${p.duration_min} minutes${p.host?.name ? ` with ${p.host.name}` : ''}.`,
  };
}

export default async function BookPage({ params, searchParams }: {
  params: { slug: string }; searchParams: Record<string, string | string[] | undefined>;
}) {
  const page = await load(params.slug);
  if (!page) notFound();
  if (searchParams.embed === '1') return <BookingWidget page={page} embed />;
  return (
    <main className="min-h-[100dvh] bg-canvas flex items-start sm:items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-4xl">
        <BookingWidget page={page} />
        <p className="mt-4 text-center text-2xs text-tertiary">
          Scheduling by <a href="https://runbutter.app" className="hover:text-secondary">RunButter</a>
        </p>
      </div>
    </main>
  );
}
