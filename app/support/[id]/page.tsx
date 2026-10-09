import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase';
import SupportChat, { type PublicWidget } from '@/components/support/SupportChat';

/**
 * /support/<widget id> — the chat as its own page.
 *
 * Three jobs, one route: the iframe the embed script opens (`?embed=1`), a
 * plain "contact us" link that works without touching anybody's website, and
 * the place a reply email lands (`?c=…&t=…`, picked up and scrubbed from the
 * address bar by SupportChat).
 *
 * Read with the service role in a server component, like the public style
 * library: nothing is added to the anon-callable list. A widget that is off
 * or unknown is a 404, never an empty chat that swallows messages.
 *
 * Framing: this path is the ONE place the app may be put in someone else's
 * iframe — next.config.js exempts /support/* from X-Frame-Options. Nothing here
 * acts on the visitor's behalf without their typing, so being framed lends a
 * clickjacker nothing.
 */

export const dynamic = 'force-dynamic';

async function load(id: string): Promise<PublicWidget | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    const { data, error } = await createAdminClient().rpc('support_widget_public', { p_widget: id });
    return error || !data ? null : (data as PublicWidget);
  } catch { return null; }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const w = await load(params.id);
  return {
    title: w ? `${w.company || w.title} — chat` : 'Chat',
    // A conversation page is nobody's search result.
    robots: { index: false, follow: false },
  };
}

export default async function SupportPage({ params, searchParams }: {
  params: { id: string }; searchParams: Record<string, string | string[] | undefined>;
}) {
  const widget = await load(params.id);
  if (!widget) notFound();
  const embed = searchParams.embed === '1';
  if (embed) return <SupportChat widget={widget} embed />;
  return (
    <main className="min-h-[100dvh] bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-md"><SupportChat widget={widget} /></div>
    </main>
  );
}
