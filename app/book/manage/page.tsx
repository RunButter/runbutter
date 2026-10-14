import type { Metadata } from 'next';
import ManageBooking from '@/components/booking/ManageBooking';

/** /book/manage?b=<booking>&t=<token> — reschedule or cancel, from the confirmation email. */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your booking',
  // A personal link: never anybody's search result.
  robots: { index: false, follow: false },
};

export default function ManagePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const b = typeof searchParams.b === 'string' ? searchParams.b : '';
  const t = typeof searchParams.t === 'string' ? searchParams.t : '';
  return (
    <main className="min-h-[100dvh] bg-canvas flex items-start sm:items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-4xl"><ManageBooking bookingId={b} token={t} /></div>
    </main>
  );
}
