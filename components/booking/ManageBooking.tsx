'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarX2, Check, Loader2 } from 'lucide-react';
import SlotPicker, { brandColor, browserZone, fmtLongDay, fmtTime, onColor } from '@/components/booking/SlotPicker';
import { PageHeader, postJson, type PublicBookingPage } from '@/components/booking/BookingWidget';

/**
 * /book/manage?b=<booking>&t=<token> — the visitor reschedules or cancels.
 * The link comes from their confirmation email; the token is the only key.
 */

interface Booking {
  id: string; title: string; name: string; email: string; starts_at: string; ends_at: string;
  status: string; join_url?: string | null; where?: string; host_name?: string | null; slug?: string | null;
}

export default function ManageBooking({ bookingId, token }: { bookingId: string; token: string }) {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [page, setPage] = useState<PublicBookingPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'view' | 'reschedule' | 'cancel'>('view');
  const [slot, setSlot] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'' | 'cancelled' | 'rescheduled'>('');
  const [tz, setTz] = useState('UTC');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { setTz(browserZone()); }, []);
  useEffect(() => {
    if (!bookingId || !token) { setLoading(false); setError('This link is incomplete. Open it again from your email.'); return; }
    postJson('/api/booking/manage', { action: 'get', booking: bookingId, token })
      .then((d) => { setBooking(d.booking); setPage(d.page); }, (e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [bookingId, token]);

  const loadSlots = useCallback(async (from: Date, to: Date) => {
    const d = await postJson('/api/booking/manage', { action: 'slots', booking: bookingId, token, from: from.toISOString(), to: to.toISOString() });
    return Array.isArray(d.slots) ? d.slots : [];
  }, [bookingId, token]);

  const color = brandColor(page?.company?.accent);
  const fg = onColor(color);

  async function act(action: 'cancel' | 'reschedule') {
    setBusy(true); setError('');
    try {
      const d = await postJson('/api/booking/manage', { action, booking: bookingId, token, reason, start: slot });
      setBooking((b) => ({ ...(b as Booking), ...d.booking }));
      setDone(action === 'cancel' ? 'cancelled' : 'rescheduled');
      setMode('view'); setSlot(null);
    } catch (e: any) {
      setError(e.message);
      if (e.status === 409 && action === 'reschedule') { setSlot(null); setReloadKey((k) => k + 1); }
    } finally { setBusy(false); }
  }

  if (loading) return <p className="p-8 text-sm text-tertiary flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading your booking…</p>;
  if (!booking) return <div className="p-8 text-sm text-secondary">{error || 'This booking could not be found.'}</div>;

  const cancelled = booking.status === 'cancelled';
  const past = new Date(booking.starts_at).getTime() < Date.now();
  const btn = 'h-9 px-4 rounded-full text-sm inline-flex items-center gap-1.5';

  return (
    <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card overflow-hidden">
      <div className="grid md:grid-cols-[260px_minmax(0,1fr)]">
        <div className="p-6 md:border-r border-subtle">{page ? <PageHeader page={page} /> : <h1 className="text-lg text-primary font-medium">{booking.title}</h1>}</div>
        <div className="p-6 min-w-0 space-y-4">
          {done && (
            <p className="text-sm text-primary flex items-center gap-2">
              <span className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: color, color: fg }}><Check className="w-3.5 h-3.5" /></span>
              {done === 'cancelled' ? 'Cancelled. We let the host know.' : 'Moved. A new confirmation is on its way.'}
            </p>
          )}
          <div className={cancelled ? 'opacity-60' : ''}>
            <p className="text-xs text-tertiary">{cancelled ? 'Cancelled' : past ? 'Already happened' : 'Your booking'}</p>
            <p className={`text-base text-primary ${cancelled ? 'line-through' : ''}`}>{fmtLongDay(booking.starts_at, tz)}, {fmtTime(booking.starts_at, tz)}–{fmtTime(booking.ends_at, tz)}</p>
            <p className="text-xs text-tertiary">{tz.replace(/_/g, ' ')}</p>
            {booking.where && !cancelled && <p className="mt-1 text-sm text-secondary break-words">{booking.where}</p>}
          </div>

          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

          {!cancelled && !past && mode === 'view' && (
            <div className="flex flex-wrap gap-2">
              {booking.join_url && <a href={booking.join_url} target="_blank" rel="noopener noreferrer" className={`${btn} font-semibold`} style={{ background: color, color: fg }}>Join link</a>}
              {page && <button type="button" onClick={() => { setMode('reschedule'); setError(''); }} className={`${btn} ring-1 ring-strong text-primary hover:bg-surface-hover`}>Reschedule</button>}
              <button type="button" onClick={() => { setMode('cancel'); setError(''); }} className={`${btn} ring-1 ring-strong text-primary hover:bg-surface-hover`}><CalendarX2 className="w-4 h-4" />Cancel</button>
            </div>
          )}

          {cancelled && booking.slug && page && (
            <a href={`/book/${booking.slug}`} className={`${btn} font-semibold`} style={{ background: color, color: fg }}>Book another time</a>
          )}

          {mode === 'cancel' && (
            <div className="space-y-3 max-w-md">
              <label className="block"><span className="text-xs text-secondary">Reason <span className="text-tertiary">(optional, shared with the host)</span></span>
                <textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-surface ring-1 ring-subtle text-sm text-primary outline-none focus:ring-2" /></label>
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => act('cancel')} className={`${btn} font-semibold bg-red-600 text-white disabled:opacity-60`}>
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}Cancel meeting</button>
                <button type="button" onClick={() => setMode('view')} className={`${btn} text-secondary hover:text-primary`}>Keep it</button>
              </div>
            </div>
          )}

          {mode === 'reschedule' && (
            slot ? (
              <div className="space-y-3">
                <p className="text-sm text-primary">Move to {fmtLongDay(slot, tz)}, {fmtTime(slot, tz)}?</p>
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={() => act('reschedule')} className={`${btn} font-semibold disabled:opacity-60`} style={{ background: color, color: fg }}>
                    {busy && <Loader2 className="w-4 h-4 animate-spin" />}Confirm new time</button>
                  <button type="button" onClick={() => setSlot(null)} className={`${btn} text-secondary hover:text-primary`}>Pick another</button>
                </div>
              </div>
            ) : (
              <>
                <SlotPicker key={reloadKey} loadSlots={loadSlots} tz={tz} onTz={setTz} hostTz={page?.timezone} onPick={setSlot} accent={color} />
                <button type="button" onClick={() => setMode('view')} className="text-sm text-secondary hover:text-primary">Keep the current time</button>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
