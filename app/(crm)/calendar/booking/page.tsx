'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { CalendarClock, Check, Copy, ExternalLink, Loader2, Plus, Trash2, X } from 'lucide-react';
import AppLoading from '@/components/ui/AppLoading';
import EmptyState from '@/components/ui/EmptyState';
import { useDialog } from '@/components/ui/Dialog';
import { getWorkspace } from '@/lib/crm/data';
import { WEEKDAYS, type Weekday, type Weekly } from '@/lib/booking/slots';
import {
  LOCATIONS, cancelBooking, deleteBookingPage, embedCode, loadBookingPages, loadBookings, saveBookingPage, slugify,
  type BookingPage, type BookingRow,
} from '@/lib/booking/client';

/**
 * Calendar → Booking pages (0135): "book a meeting with me" links, without a
 * Calendly subscription. A page is a title, a length, where it happens and the
 * host's weekly hours; a booking made on it becomes a person in People, a
 * meeting on the company calendar, a Google event with a Meet link when the
 * host connected Google, and optionally a deal in the sales pipeline.
 *
 * Availability is the hours set here minus the host's other bookings. Google
 * Calendar is not read — RunButter only ever writes the events it creates — so
 * the hours are the promise; the screen says so beside them.
 */

const DAY_LABEL: Record<Weekday, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const DURATIONS = [15, 20, 30, 45, 60, 90];
const BLANK: Partial<BookingPage> = {
  title: 'Intro call', description: '', duration_min: 30, step_min: 30, location: 'google_meet', location_detail: '',
  weekly: { mon: [['09:00', '17:00']], tue: [['09:00', '17:00']], wed: [['09:00', '17:00']], thu: [['09:00', '17:00']], fri: [['09:00', '17:00']] },
  buffer_before: 0, buffer_after: 0, min_notice_min: 240, horizon_days: 30, max_per_day: null,
  create_deal: false, ask_phone: false, ask_company: true, notify_email: '', enabled: true,
};

function zones(): string[] {
  try { return ((Intl as any).supportedValuesOf?.('timeZone') as string[]) || ['UTC']; } catch { return ['UTC']; }
}
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

function WeeklyEditor({ value, onChange, disabled }: { value: Weekly; onChange: (w: Weekly) => void; disabled?: boolean }) {
  const set = (d: Weekday, rows: [string, string][]) => {
    const next = { ...value };
    if (rows.length) next[d] = rows; else delete next[d];
    onChange(next);
  };
  const time = 'h-8 px-2 rounded-md bg-surface ring-1 ring-subtle text-sm text-primary outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60';
  return (
    <div className="divide-y divide-subtle">
      {WEEKDAYS.map((d) => {
        const rows = (value[d] || []) as [string, string][];
        const open = rows.length > 0;
        return (
          <div key={d} className="py-2 flex flex-wrap items-start gap-x-4 gap-y-2">
            <label className="w-32 shrink-0 flex items-center gap-2 h-8 text-sm text-primary">
              <input type="checkbox" checked={open} disabled={disabled}
                onChange={(e) => set(d, e.target.checked ? [['09:00', '17:00']] : [])} />
              {DAY_LABEL[d]}
            </label>
            <div className="flex-1 min-w-0 space-y-1.5">
              {!open && <p className="h-8 flex items-center text-sm text-tertiary">Unavailable</p>}
              {rows.map(([a, b], i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="time" value={a} disabled={disabled} aria-label={`${DAY_LABEL[d]} from`} className={time}
                    onChange={(e) => set(d, rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)) as [string, string][])} />
                  <span className="text-tertiary text-sm">–</span>
                  <input type="time" value={b === '24:00' ? '23:59' : b} disabled={disabled} aria-label={`${DAY_LABEL[d]} until`} className={time}
                    onChange={(e) => set(d, rows.map((r, j) => (j === i ? [r[0], e.target.value === '23:59' ? '24:00' : e.target.value] : r)) as [string, string][])} />
                  <button type="button" disabled={disabled} aria-label="Remove hours" onClick={() => set(d, rows.filter((_, j) => j !== i))}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-tertiary hover:text-primary hover:bg-surface-hover"><X className="w-3.5 h-3.5" /></button>
                  {i === rows.length - 1 && rows.length < 6 && (
                    <button type="button" disabled={disabled} aria-label="Add hours" onClick={() => set(d, [...rows, [b < '17:00' ? '17:00' : b, b < '18:00' ? '18:00' : '23:59'] as [string, string]])}
                      className="w-7 h-7 rounded-md flex items-center justify-center text-tertiary hover:text-primary hover:bg-surface-hover"><Plus className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function BookingPagesPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const dialog = useDialog();
  const [ws, setWs] = useState<{ id: string; role: string } | null>(null);
  const [pages, setPages] = useState<BookingPage[] | null>(null);
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [editing, setEditing] = useState<Partial<BookingPage> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const [origin, setOrigin] = useState('');
  const [cancelling, setCancelling] = useState<{ id: string; reason: string } | null>(null);
  const allZones = useMemo(zones, []);

  useEffect(() => { setOrigin(window.location.origin); }, []);
  const reload = useCallback(async (wsId: string, p: string) => {
    const [a, b] = await Promise.all([
      loadBookingPages(p, wsId),
      loadBookings(p, wsId, new Date(Date.now() - 7 * 86_400_000), new Date(Date.now() + 120 * 86_400_000)),
    ]);
    if (a.error) setError(a.error); else setPages(a.pages!);
    if (!b.error) setRows(b.rows!);
  }, []);
  useEffect(() => {
    if (!privy) return;
    getWorkspace(privy).then((w) => {
      if (!w?.id) { setError('No workspace found.'); return; }
      setWs({ id: w.id, role: w.role });
      reload(w.id, privy);
    });
  }, [privy, reload]);

  if (!ready) return <AppLoading />;
  if (!privy) return <div className="page-pad text-sm text-tertiary">Sign in to set up booking pages.</div>;
  if (!pages && !error) return <AppLoading />;

  const viewer = ws?.role === 'viewer';
  const copy = async (text: string, key: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1500); } catch {}
  };
  const startNew = () => {
    const name = (user as any)?.google?.name || (user as any)?.email?.address?.split('@')[0] || '';
    const base = slugify(`${name || 'meet'}-intro`);
    setEditing({ ...BLANK, slug: base.length >= 4 ? base : `${base}-call`, timezone: browserZone() });
    setError('');
  };
  const save = async () => {
    if (!ws || !editing) return;
    setBusy(true); setError('');
    const payload: any = { ...editing };
    for (const k of ['mine', 'host_name', 'upcoming', 'owner_privy', 'created_at', 'updated_at']) delete payload[k];
    const r = await saveBookingPage(privy, ws.id, payload);
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setEditing(null);
    reload(ws.id, privy);
  };
  const remove = async (p: BookingPage) => {
    if (!ws) return;
    const ok = await dialog.confirm({ title: `Delete “${p.title}”?`, body: 'The link stops working. Meetings already booked stay on the calendar.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const r = await deleteBookingPage(privy, p.id);
    if (r.error) { setError(r.error); return; }
    setEditing(null);
    reload(ws.id, privy);
  };
  const doCancel = async () => {
    if (!cancelling || !ws) return;
    setBusy(true);
    const r = await cancelBooking(cancelling.id, cancelling.reason);
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setCancelling(null);
    reload(ws.id, privy);
  };

  const field = 'w-full h-9 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1';
  const e = editing;
  const set = (patch: Partial<BookingPage>) => setEditing((x) => ({ ...(x || {}), ...patch }));
  const loc = LOCATIONS.find((l) => l.value === e?.location);
  const upcoming = rows.filter((r) => new Date(r.ends_at).getTime() > Date.now());
  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="h-14 shrink-0 flex items-center gap-3 page-x">
        <h1 className="text-base font-medium text-primary">Booking pages</h1>
        <div className="ml-auto flex items-center gap-2">
          {!viewer && !e && (
            <button onClick={startNew} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">
              <Plus className="w-4 h-4" />New page
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto page-pad space-y-6">
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}

        {e && (
          <section className="card-surface p-5 space-y-6">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-primary">{e.id ? 'Edit page' : 'New booking page'}</h2>
              <button onClick={() => { setEditing(null); setError(''); }} className="ml-auto text-sm text-secondary hover:text-primary">Close</button>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <label className="block"><span className={labelCls}>Title</span>
                <input className={field} maxLength={120} value={e.title || ''} onChange={(x) => set({ title: x.target.value })} placeholder="Intro call" /></label>
              <label className="block"><span className={labelCls}>Address</span>
                <div className="flex items-center gap-1 min-w-0">
                  <span className="text-xs text-tertiary shrink-0 hidden sm:inline">{origin.replace(/^https?:\/\//, '')}/book/</span>
                  <input className={field} maxLength={50} value={e.slug || ''} onChange={(x) => set({ slug: x.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} placeholder="anna-intro" />
                </div></label>
              <label className="block md:col-span-2"><span className={labelCls}>Description <span className="font-normal text-tertiary">(optional — shown on the page)</span></span>
                <textarea className={`${field} h-auto py-2`} rows={2} maxLength={2000} value={e.description || ''} onChange={(x) => set({ description: x.target.value })}
                  placeholder="A 30-minute call to see whether we are a fit." /></label>
              <label className="block"><span className={labelCls}>Length</span>
                <select className={field} value={e.duration_min} onChange={(x) => { const d = +x.target.value; set({ duration_min: d, step_min: Math.min(60, d) }); }}>
                  {Array.from(new Set([...DURATIONS, e.duration_min || 30])).sort((a, b) => a - b).map((d) => <option key={d} value={d}>{d} minutes</option>)}
                </select></label>
              <label className="block"><span className={labelCls}>Where</span>
                <select className={field} value={e.location} onChange={(x) => set({ location: x.target.value as any })}>
                  {LOCATIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
                {loc && <span className="block mt-1 text-2xs text-tertiary">{loc.hint}</span>}</label>
              {(e.location === 'in_person' || e.location === 'link') && (
                <label className="block md:col-span-2"><span className={labelCls}>{e.location === 'in_person' ? 'Address' : 'Meeting link'}</span>
                  <input className={field} maxLength={500} value={e.location_detail || ''} onChange={(x) => set({ location_detail: x.target.value })}
                    placeholder={e.location === 'in_person' ? 'ul. Długa 1, 31-147 Kraków' : 'https://zoom.us/j/…'} /></label>
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-end gap-4 mb-2">
                <div>
                  <h3 className="text-sm font-medium text-primary">Hours</h3>
                  <p className="text-2xs text-tertiary max-w-md">People can book inside these hours, minus your other bookings. Your Google Calendar is not read — block time off here.</p>
                </div>
                <label className="block ml-auto min-w-[220px]"><span className={labelCls}>Time zone</span>
                  <select className={field} value={e.timezone || 'UTC'} onChange={(x) => set({ timezone: x.target.value })}>
                    {Array.from(new Set([e.timezone || 'UTC', ...allZones])).map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
                  </select></label>
              </div>
              <WeeklyEditor value={(e.weekly || {}) as Weekly} onChange={(w) => set({ weekly: w })} />
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <label className="block"><span className={labelCls}>Start times every</span>
                <select className={field} value={e.step_min} onChange={(x) => set({ step_min: +x.target.value })}>
                  {Array.from(new Set([15, 30, 60, e.duration_min || 30, e.step_min || 30])).sort((a, b) => a - b).map((d) => <option key={d} value={d}>{d} minutes</option>)}
                </select></label>
              <label className="block"><span className={labelCls}>Minimum notice</span>
                <select className={field} value={e.min_notice_min} onChange={(x) => set({ min_notice_min: +x.target.value })}>
                  {[[0, 'None'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [720, '12 hours'], [1440, '1 day'], [2880, '2 days']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></label>
              <label className="block"><span className={labelCls}>Bookable up to</span>
                <select className={field} value={e.horizon_days} onChange={(x) => set({ horizon_days: +x.target.value })}>
                  {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days ahead</option>)}
                </select></label>
              <label className="block"><span className={labelCls}>Break before</span>
                <select className={field} value={e.buffer_before} onChange={(x) => set({ buffer_before: +x.target.value })}>
                  {[0, 5, 10, 15, 30, 60].map((d) => <option key={d} value={d}>{d ? `${d} minutes` : 'None'}</option>)}
                </select></label>
              <label className="block"><span className={labelCls}>Break after</span>
                <select className={field} value={e.buffer_after} onChange={(x) => set({ buffer_after: +x.target.value })}>
                  {[0, 5, 10, 15, 30, 60].map((d) => <option key={d} value={d}>{d ? `${d} minutes` : 'None'}</option>)}
                </select></label>
              <label className="block"><span className={labelCls}>Most per day</span>
                <select className={field} value={e.max_per_day ?? 0} onChange={(x) => set({ max_per_day: +x.target.value || null })}>
                  {[0, 1, 2, 3, 4, 5, 6, 8, 10].map((d) => <option key={d} value={d}>{d ? d : 'No limit'}</option>)}
                </select></label>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-medium text-primary">When someone books</h3>
              {([
                ['ask_company', 'Ask for their company'],
                ['ask_phone', 'Ask for a phone number', e.location === 'phone' ? 'Always asked for phone calls.' : ''],
                ['create_deal', 'Create a deal in the sales pipeline', 'Named after the page and their company, linked to the person.'],
              ] as [keyof BookingPage, string, string?][]).map(([k, l, hint]) => (
                <label key={k} className="flex items-start gap-2.5">
                  <input type="checkbox" className="mt-0.5" checked={!!e[k] || (k === 'ask_phone' && e.location === 'phone')} disabled={k === 'ask_phone' && e.location === 'phone'}
                    onChange={(x) => set({ [k]: x.target.checked } as any)} />
                  <span><span className="block text-sm text-primary">{l}</span>{hint && <span className="block text-2xs text-tertiary">{hint}</span>}</span>
                </label>
              ))}
              <p className="text-2xs text-tertiary">Everyone who books is added to People (or matched by email), and the meeting appears on the calendar.</p>
              <label className="block max-w-md"><span className={labelCls}>Email new bookings to <span className="font-normal text-tertiary">(blank = the host’s sign-in email)</span></span>
                <input className={field} type="email" value={e.notify_email || ''} onChange={(x) => set({ notify_email: x.target.value })} placeholder="sales@yourcompany.com" /></label>
              <label className="flex items-center gap-2.5">
                <input type="checkbox" checked={e.enabled !== false} onChange={(x) => set({ enabled: x.target.checked })} />
                <span className="text-sm text-primary">Page is live</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <button onClick={save} disabled={busy} className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{e.id ? 'Save' : 'Create page'}
              </button>
              <button onClick={() => { setEditing(null); setError(''); }} className="h-9 px-3 rounded-lg text-sm text-secondary hover:bg-surface-hover">Cancel</button>
              {e.id && <button onClick={() => remove(e as BookingPage)} className="ml-auto h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm text-danger hover:bg-danger/10"><Trash2 className="w-4 h-4" />Delete page</button>}
            </div>
          </section>
        )}

        {pages && pages.length === 0 && !e && (
          <EmptyState icon={CalendarClock} title="No booking pages yet"
            description="Share a link, people pick a time in your hours, and it lands on the calendar — with a Meet link, a contact in People and, if you like, a deal."
            action={!viewer ? (
              <button onClick={startNew} className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">
                <Plus className="w-4 h-4" />Create a booking page
              </button>
            ) : undefined} />
        )}

        {pages && pages.length > 0 && (
          <section className="space-y-3">
            {pages.map((p) => {
              const link = `${origin}/book/${p.slug}`;
              return (
                <div key={p.id} className="card-surface p-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-primary truncate">{p.title}</p>
                      <span className={`text-2xs font-semibold rounded-full px-2 py-0.5 ${p.enabled ? 'bg-success/10 text-success' : 'bg-surface-hover text-tertiary'}`}>{p.enabled ? 'Live' : 'Off'}</span>
                    </div>
                    <p className="text-xs text-tertiary truncate">
                      {p.duration_min} min · {LOCATIONS.find((l) => l.value === p.location)?.label} · {p.host_name || 'host'} · {p.upcoming || 0} upcoming
                    </p>
                  </div>
                  <code className="text-xs font-mono bg-surface-sunken rounded-lg px-2.5 py-1.5 truncate max-w-full">/book/{p.slug}</code>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => copy(link, `l${p.id}`)} className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs ring-1 ring-subtle text-secondary hover:bg-surface-hover">
                      {copied === `l${p.id}` ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}Link</button>
                    <button onClick={() => copy(embedCode(origin, p.slug), `e${p.id}`)} title="Embed on your website"
                      className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs ring-1 ring-subtle text-secondary hover:bg-surface-hover">
                      {copied === `e${p.id}` ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}Embed</button>
                    {p.enabled && <a href={link} target="_blank" rel="noreferrer noopener" className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs ring-1 ring-subtle text-secondary hover:bg-surface-hover"><ExternalLink className="w-3.5 h-3.5" />Open</a>}
                    {!viewer && <button onClick={() => { setEditing(p); setError(''); }} className="h-8 px-3 rounded-lg text-xs font-semibold ring-1 ring-subtle text-primary hover:bg-surface-hover">Edit</button>}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {pages && pages.length > 0 && (
          <section className="card-surface overflow-hidden">
            <div className="px-4 h-11 flex items-center border-b border-subtle">
              <h2 className="text-sm font-medium text-primary">Upcoming bookings</h2>
              <Link href="/calendar?view=agenda" className="ml-auto text-xs text-secondary hover:text-primary">Open calendar</Link>
            </div>
            {upcoming.length === 0 ? (
              <p className="px-4 py-6 text-sm text-tertiary">Nothing booked yet. Share a page link to get the first one.</p>
            ) : (
              <ul className="divide-y divide-subtle">
                {upcoming.map((r) => (
                  <li key={r.id} className={`px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 ${r.status === 'cancelled' ? 'opacity-60' : ''}`}>
                    <span className={`w-full sm:w-36 shrink-0 text-sm text-primary ${r.status === 'cancelled' ? 'line-through' : ''}`}>{fmt(r.starts_at)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-primary truncate">
                        <Link href={`/objects/people?q=${encodeURIComponent(r.email)}`} className="hover:underline">{r.name}</Link>
                        {r.company && <span className="text-tertiary"> · {r.company}</span>}
                      </p>
                      <p className="text-xs text-tertiary truncate">{r.page || r.title}{r.host_name ? ` · ${r.host_name}` : ''}{r.status === 'cancelled' ? ` · cancelled${r.cancel_reason ? `: ${r.cancel_reason}` : ''}` : ''}</p>
                    </div>
                    {r.status === 'confirmed' && r.join_url && <a href={r.join_url} target="_blank" rel="noreferrer noopener" className="text-xs text-secondary hover:text-primary">Join</a>}
                    {r.status === 'confirmed' && !viewer && (
                      cancelling?.id === r.id ? (
                        <div className="w-full flex flex-wrap items-center gap-2">
                          <input className={`${field} flex-1 min-w-[200px]`} autoFocus placeholder="Reason — sent to them (optional)" maxLength={500}
                            value={cancelling.reason} onChange={(x) => setCancelling({ id: r.id, reason: x.target.value })} />
                          <button onClick={doCancel} disabled={busy} className="h-9 px-3 rounded-lg text-sm font-semibold bg-danger text-white disabled:opacity-50">Cancel meeting</button>
                          <button onClick={() => setCancelling(null)} className="h-9 px-3 rounded-lg text-sm text-secondary hover:bg-surface-hover">Keep</button>
                        </div>
                      ) : (
                        <button onClick={() => setCancelling({ id: r.id, reason: '' })} className="text-xs text-secondary hover:text-danger">Cancel</button>
                      )
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
