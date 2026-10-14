'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CalendarPlus, Check, Clock, Download, Loader2, MapPin, Phone, Video } from 'lucide-react';
import SlotPicker, { brandColor, browserZone, fmtLongDay, fmtTime, onColor } from '@/components/booking/SlotPicker';
import { bookingIcs, googleCalendarLink } from '@/lib/booking/ics';

/**
 * The visitor's side of a booking page (0135): pick a day, pick a time, say who
 * you are, done. Rendered at /book/<slug>, full page or framed (`embed`).
 *
 * Nothing here decides availability — the server sends the free times and
 * re-checks the chosen one before writing. The confirmation offers the calendar
 * file built by the same function the email attaches.
 */

export interface PublicBookingPage {
  id: string; slug: string; title: string; description?: string | null;
  duration_min: number; location: string; location_detail?: string | null; timezone: string;
  ask_phone: boolean; ask_company: boolean;
  host?: { name?: string; avatar?: string | null } | null;
  company?: { name?: string; logo?: string | null; accent?: string | null } | null;
}

interface Booked {
  id: string; title: string; starts_at: string; ends_at: string; email: string;
  join_url?: string | null; where?: string; location?: string; location_detail?: string | null; host_name?: string | null;
}

export async function postJson(url: string, body: any): Promise<any> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(d.error || 'Something went wrong. Try again.'), { data: d, status: res.status });
  return d;
}

export function LocationLine({ location, detail }: { location: string; detail?: string | null }) {
  const Icon = location === 'phone' ? Phone : location === 'in_person' ? MapPin : Video;
  const text = location === 'google_meet' ? 'Google Meet' : location === 'phone' ? 'Phone call' : location === 'in_person' ? (detail || 'In person')
    : location === 'link' ? 'Video call' : '';
  if (!text) return null;
  return <p className="flex items-start gap-2 text-sm text-secondary"><Icon className="w-4 h-4 mt-0.5 shrink-0" /><span className="min-w-0 break-words">{text}</span></p>;
}

export function PageHeader({ page }: { page: PublicBookingPage }) {
  return (
    <div className="space-y-3">
      {page.company?.logo
        ? <img src={page.company.logo} alt={page.company?.name || ''} className="h-8 max-w-[160px] object-contain" />
        : page.company?.name ? <p className="text-sm text-secondary">{page.company.name}</p> : null}
      <div className="flex items-center gap-3">
        {page.host?.avatar
          ? <img src={page.host.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
          : <span className="w-10 h-10 rounded-full bg-surface-sunken flex items-center justify-center text-sm text-secondary">{(page.host?.name || '?')[0]?.toUpperCase()}</span>}
        <div className="min-w-0">
          <p className="text-sm text-secondary truncate">{page.host?.name}</p>
          <h1 className="text-lg text-primary font-medium leading-tight">{page.title}</h1>
        </div>
      </div>
      <p className="flex items-center gap-2 text-sm text-secondary"><Clock className="w-4 h-4" />{page.duration_min} min</p>
      <LocationLine location={page.location} detail={page.location_detail} />
      {page.description && <p className="text-sm text-secondary whitespace-pre-line">{page.description}</p>}
    </div>
  );
}

export function downloadIcs(b: { id: string; starts_at: string; ends_at: string; title: string; join_url?: string | null; location_detail?: string | null; where?: string }) {
  const ics = bookingIcs({ id: b.id, start: b.starts_at, end: b.ends_at, title: b.title, description: b.where, location: b.join_url || b.location_detail || undefined, url: b.join_url || undefined });
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'meeting.ics'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function BookingWidget({ page, embed = false }: { page: PublicBookingPage; embed?: boolean }) {
  const color = brandColor(page.company?.accent);
  const fg = onColor(color);
  const [tz, setTz] = useState('UTC');
  const [slot, setSlot] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', notes: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [suggest, setSuggest] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booked | null>(null);

  useEffect(() => { setTz(browserZone()); }, []);

  const loadSlots = useCallback(async (from: Date, to: Date) => {
    const res = await fetch(`/api/booking/${page.slug}?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { cache: 'no-store' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Times could not be loaded.');
    return Array.isArray(d.slots) ? d.slots : [];
  }, [page.slug]);

  const [reloadKey, setReloadKey] = useState(0);

  async function submit(e: React.FormEvent, confirmEmail = false) {
    e.preventDefault();
    if (!slot) return;
    setBusy(true); setError(''); setSuggest(null);
    try {
      const d = await postJson(`/api/booking/${page.slug}`, { ...form, start: slot, tz, confirmEmail });
      setBooked(d.booking);
    } catch (err: any) {
      setError(err.message);
      if (err.data?.confirmable && err.data?.suggestion) setSuggest(err.data.suggestion);
      // The time went while they typed: back to the picker with fresh times.
      if (err.status === 409) { setSlot(null); setReloadKey((k) => k + 1); }
    } finally { setBusy(false); }
  }

  const input = 'w-full h-10 px-3 rounded-lg bg-surface ring-1 ring-subtle text-sm text-primary outline-none focus:ring-2 placeholder:text-tertiary';

  const body = booked ? (
    <div className="max-w-md mx-auto text-center py-6 space-y-4">
      <span className="mx-auto w-12 h-12 rounded-full flex items-center justify-center" style={{ background: color, color: fg }}><Check className="w-6 h-6" /></span>
      <h2 className="text-lg text-primary font-medium">You are booked</h2>
      <div className="text-sm text-secondary space-y-1">
        <p className="text-primary">{page.title}{booked.host_name ? ` with ${booked.host_name}` : ''}</p>
        <p>{fmtLongDay(booked.starts_at, tz)}, {fmtTime(booked.starts_at, tz)}–{fmtTime(booked.ends_at, tz)}</p>
        <p className="text-tertiary text-xs">{tz.replace(/_/g, ' ')}</p>
        {booked.where && <p className="break-words">{booked.where}</p>}
      </div>
      <p className="text-sm text-secondary">A confirmation is on its way to <span className="text-primary">{booked.email}</span>, with a link to reschedule or cancel.</p>
      <div className="flex flex-wrap justify-center gap-2">
        {booked.join_url && <a href={booked.join_url} target="_blank" rel="noopener noreferrer" className="h-9 px-4 rounded-full text-sm font-semibold inline-flex items-center" style={{ background: color, color: fg }}>Join link</a>}
        <a href={googleCalendarLink({ id: booked.id, start: booked.starts_at, end: booked.ends_at, title: `${page.title}${booked.host_name ? ` with ${booked.host_name}` : ''}`, description: booked.where, location: booked.join_url || booked.location_detail || undefined })}
          target="_blank" rel="noopener noreferrer" className="h-9 px-4 rounded-full text-sm ring-1 ring-strong text-primary inline-flex items-center gap-1.5 hover:bg-surface-hover"><CalendarPlus className="w-4 h-4" />Google Calendar</a>
        <button type="button" onClick={() => downloadIcs({ ...booked, title: `${page.title}${booked.host_name ? ` with ${booked.host_name}` : ''}` })}
          className="h-9 px-4 rounded-full text-sm ring-1 ring-strong text-primary inline-flex items-center gap-1.5 hover:bg-surface-hover"><Download className="w-4 h-4" />Outlook / Apple</button>
      </div>
    </div>
  ) : slot ? (
    <form onSubmit={(e) => submit(e)} className="space-y-3 max-w-md">
      <button type="button" onClick={() => { setSlot(null); setError(''); }} className="text-sm text-secondary inline-flex items-center gap-1 hover:text-primary"><ArrowLeft className="w-4 h-4" />Back</button>
      <p className="text-sm text-primary">{fmtLongDay(slot, tz)}, {fmtTime(slot, tz)}</p>
      <label className="block"><span className="text-xs text-secondary">Your name</span>
        <input className={input} required maxLength={120} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <label className="block"><span className="text-xs text-secondary">Email</span>
        <input className={input} required type="email" maxLength={200} autoComplete="email" value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value }); setSuggest(null); }} /></label>
      {page.ask_phone && <label className="block"><span className="text-xs text-secondary">Phone</span>
        <input className={input} required type="tel" maxLength={40} autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>}
      {page.ask_company && <label className="block"><span className="text-xs text-secondary">Company <span className="text-tertiary">(optional)</span></span>
        <input className={input} maxLength={160} autoComplete="organization" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label>}
      <label className="block"><span className="text-xs text-secondary">Anything to prepare? <span className="text-tertiary">(optional)</span></span>
        <textarea className={`${input} h-auto py-2`} rows={3} maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
      {/* Honeypot: hidden from people, irresistible to bots. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website}
        onChange={(e) => setForm({ ...form, website: e.target.value })} className="absolute -left-[9999px] w-px h-px opacity-0" />
      {error && (
        <div className="text-sm text-red-600 space-y-2" role="alert">
          <p>{error}</p>
          {suggest && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="h-8 px-3 rounded-full text-xs ring-1 ring-strong text-primary" onClick={() => { setForm({ ...form, email: suggest }); setSuggest(null); setError(''); }}>Use {suggest}</button>
              <button type="button" className="h-8 px-3 rounded-full text-xs ring-1 ring-strong text-primary" onClick={(e) => submit(e as any, true)}>Keep what I typed</button>
            </div>
          )}
        </div>
      )}
      <button type="submit" disabled={busy} className="h-10 px-5 rounded-full text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60" style={{ background: color, color: fg }}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}Confirm booking
      </button>
    </form>
  ) : (
    <>
      {error && <p className="mb-3 text-sm text-red-600" role="alert">{error}</p>}
      <SlotPicker key={reloadKey} loadSlots={loadSlots} tz={tz} onTz={setTz} hostTz={page.timezone} onPick={setSlot} accent={color} />
    </>
  );

  return (
    <div className={embed ? 'p-4' : 'rounded-2xl bg-surface ring-1 ring-subtle shadow-card overflow-hidden'}>
      <div className={booked ? 'p-6' : 'grid md:grid-cols-[260px_minmax(0,1fr)]'}>
        {!booked && <div className="p-6 md:border-r border-subtle"><PageHeader page={page} /></div>}
        <div className={booked ? '' : 'p-6 min-w-0'}>{body}</div>
      </div>
    </div>
  );
}
