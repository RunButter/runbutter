'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy, getAccessToken } from '@privy-io/react-auth';
import { FileBarChart, Loader2, Plus, Trash2, X, Download, Mail, Info } from 'lucide-react';
import { getWorkspace, getReportSchedules, saveReportSchedule, deleteReportSchedule, type WorkspaceContext, type ReportSchedule } from '@/lib/crm/data';
import { SECTION_CATALOG } from '@/lib/reports/registry';
import { useDialog } from '@/components/ui/Dialog';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const GROUPS = Array.from(new Set(SECTION_CATALOG.map((s) => s.group)));

const blank = (): ReportSchedule => ({
  id: null, name: 'Weekly business report', frequency: 'weekly',
  day_of_week: 1, day_of_month: 1, hour: 8,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  recipients: [], sections: ['finance_summary', 'sales_pipeline'], enabled: true, last_sent_at: null,
});

export default function ReportsPage() {
  const { confirm: confirmDialog, notify } = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [ws, setWs] = useState<WorkspaceContext | null>(null);
  const [rows, setRows] = useState<ReportSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ReportSchedule | null>(null);
  const [downloading, setDownloading] = useState(false);

  const canManage = ws?.role === 'owner' || ws?.role === 'admin';

  const load = useCallback(async () => {
    if (!privy) { setLoading(false); return; }
    const w = await getWorkspace(privy);
    setWs(w);
    if (w) setRows(await getReportSchedules(privy, w.id));
    setLoading(false);
  }, [privy]);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  const save = async (s: ReportSchedule) => {
    if (!privy || !ws) return;
    if (!s.recipients.length) { notify('Add at least one recipient email.'); return; }
    if (!s.sections.length) { notify('Pick at least one section to include.'); return; }
    const res = await saveReportSchedule(privy, ws.id, s);
    if (res.error) { notify(res.error.replace(/_/g, ' ').toLowerCase()); return; }
    setEditing(null);
    setRows(await getReportSchedules(privy, ws.id));
  };

  const remove = async (s: ReportSchedule) => {
    if (!privy || !ws || !s.id) return;
    if (!await confirmDialog({ title: `Delete "${s.name}"?`, body: 'This schedule stops sending immediately.', danger: true, confirmLabel: 'Delete' })) return;
    await deleteReportSchedule(privy, ws.id, s.id);
    setRows(await getReportSchedules(privy, ws.id));
  };

  // Generate the same PDF the schedule would send, right now.
  const downloadNow = async (s: ReportSchedule) => {
    setDownloading(true);
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch('/api/reports/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
        body: JSON.stringify({ frequency: s.frequency, sections: s.sections, name: s.name }),
      });
      if (!res.ok) { notify((await res.json().catch(() => null))?.error || 'Could not generate the report.'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `runbutter-report.pdf`; a.click();
      URL.revokeObjectURL(url);
    } finally { setDownloading(false); }
  };

  const summary = (s: ReportSchedule) =>
    s.frequency === 'weekly'
      ? `Every ${DAYS[s.day_of_week]} at ${String(s.hour).padStart(2, '0')}:00 ${s.timezone}`
      : `Day ${s.day_of_month} of each month at ${String(s.hour).padStart(2, '0')}:00 ${s.timezone}`;

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 px-6 border-b border-subtle">
        <h1 className="text-md font-semibold text-primary">Reports</h1>
        <span className="text-2xs font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{rows.length}</span>
        {canManage && (
          <button onClick={() => setEditing(blank())}
            className="ml-auto h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm">
            <Plus className="w-3.5 h-3.5" /> New report
          </button>
        )}
      </header>

      <div className="flex-1 overflow-auto p-6 2xl:p-8">
        <div className="max-w-5xl space-y-4">
          <p className="text-sm text-secondary -mt-1">
            Scheduled PDF reports, emailed automatically. Pick what goes in — new modules appear here on their own as they&rsquo;re added.
          </p>

          {loading ? (
            <div className="h-32 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-subtle p-12 text-center">
              <FileBarChart className="w-8 h-8 text-tertiary mx-auto mb-3" />
              <h3 className="text-sm font-medium text-secondary">No scheduled reports</h3>
              <p className="text-xs text-tertiary mt-1">Create one to get a PDF in your inbox every week or month.</p>
            </div>
          ) : (
            <div className="rounded-xl ring-1 ring-subtle bg-surface divide-y divide-subtle">
              {rows.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${s.enabled ? 'bg-success' : 'bg-tertiary'}`} title={s.enabled ? 'Active' : 'Paused'} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-primary truncate">{s.name}</div>
                    <div className="text-xs text-tertiary truncate">
                      {summary(s)} · {s.sections.length} section{s.sections.length === 1 ? '' : 's'} · {s.recipients.length} recipient{s.recipients.length === 1 ? '' : 's'}
                      {s.last_sent_at && ` · last sent ${new Date(s.last_sent_at).toLocaleDateString('en-GB')}`}
                    </div>
                  </div>
                  <button onClick={() => downloadNow(s)} disabled={downloading} title="Generate and download now"
                    className="h-7 px-2 text-xs font-semibold rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-sunken inline-flex items-center gap-1.5 disabled:opacity-40">
                    {downloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} PDF
                  </button>
                  {canManage && <>
                    <button onClick={() => setEditing(s)} className="h-7 px-2.5 text-xs font-semibold rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-sunken">Edit</button>
                    <button onClick={() => remove(s)} aria-label="Delete schedule" className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10"><Trash2 className="w-4 h-4" /></button>
                  </>}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-subtle bg-surface-sunken px-3 py-2 text-xs text-secondary">
            <Info className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
            <span>
              Delivery needs a cron job calling <code className="bg-surface-hover rounded px-1">/api/reports/dispatch</code> (the same one that drives automations).
              The <b>PDF</b> button works right now regardless.
            </span>
          </div>
        </div>
      </div>

      {editing && <ScheduleModal initial={editing} onClose={() => setEditing(null)} onSave={save} />}
    </>
  );
}

function ScheduleModal({ initial, onClose, onSave }: { initial: ReportSchedule; onClose: () => void; onSave: (s: ReportSchedule) => void }) {
  const [s, setS] = useState<ReportSchedule>(initial);
  const [recipientText, setRecipientText] = useState(initial.recipients.join(', '));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<ReportSchedule>) => setS((p) => ({ ...p, ...patch }));

  const toggleSection = (id: string) =>
    set({ sections: s.sections.includes(id) ? s.sections.filter((x) => x !== id) : [...s.sections, id] });

  const submit = async () => {
    setBusy(true);
    const recipients = recipientText.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    await onSave({ ...s, recipients });
    setBusy(false);
  };

  const input = 'w-full h-9 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[88vh] flex flex-col bg-surface rounded-xl ring-1 ring-subtle shadow-popover" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-subtle">
          <h3 className="text-sm font-semibold text-primary">{s.id ? 'Edit report' : 'New scheduled report'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-auto p-4 2xl:p-6 space-y-4">
          <label className="block">
            <span className="block text-xs font-semibold text-secondary mb-1">Report name</span>
            <input value={s.name} onChange={(e) => set({ name: e.target.value })} className={input} />
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold text-secondary mb-1">Frequency</span>
              <select value={s.frequency} onChange={(e) => set({ frequency: e.target.value as any })} className={input}>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            {s.frequency === 'weekly' ? (
              <label className="block">
                <span className="block text-xs font-semibold text-secondary mb-1">Day</span>
                <select value={s.day_of_week} onChange={(e) => set({ day_of_week: Number(e.target.value) })} className={input}>
                  {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </label>
            ) : (
              <label className="block">
                <span className="block text-xs font-semibold text-secondary mb-1">Day of month</span>
                <select value={s.day_of_month} onChange={(e) => set({ day_of_month: Number(e.target.value) })} className={input}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
            )}
            <label className="block">
              <span className="block text-xs font-semibold text-secondary mb-1">Hour</span>
              <select value={s.hour} onChange={(e) => set({ hour: Number(e.target.value) })} className={input}>
                {Array.from({ length: 24 }, (_, i) => i).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </label>
          </div>
          <p className="text-2xs text-tertiary -mt-2">Times are in {s.timezone} and follow daylight saving.</p>

          <label className="block">
            <span className="block text-xs font-semibold text-secondary mb-1">Send to</span>
            <input value={recipientText} onChange={(e) => setRecipientText(e.target.value)}
              placeholder="you@company.com, board@company.com" className={input} />
            <span className="block mt-1 text-2xs text-tertiary">Comma-separated.</span>
          </label>

          <div>
            <span className="block text-xs font-semibold text-secondary mb-2">What to include</span>
            <div className="space-y-3">
              {GROUPS.map((g) => (
                <div key={g}>
                  <div className="text-3xs font-semibold uppercase tracking-widest text-tertiary mb-1">{g}</div>
                  <div className="space-y-1">
                    {SECTION_CATALOG.filter((sec) => sec.group === g).map((sec) => (
                      <label key={sec.id} className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-surface-hover cursor-pointer">
                        <input type="checkbox" checked={s.sections.includes(sec.id)} onChange={() => toggleSection(sec.id)}
                          className="mt-0.5 rounded border-subtle accent-accent" />
                        <span className="min-w-0">
                          <span className="block text-sm text-primary">{sec.label}</span>
                          <span className="block text-2xs text-tertiary leading-snug">{sec.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-secondary">
            <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="rounded border-subtle accent-accent" />
            Active — send on schedule
          </label>
        </div>

        <div className="h-14 shrink-0 flex items-center justify-end gap-2 px-4 border-t border-subtle">
          <button onClick={onClose} className="h-8 px-3 rounded-md text-sm font-medium text-secondary hover:bg-surface-hover">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />} Save report
          </button>
        </div>
      </div>
    </div>
  );
}
