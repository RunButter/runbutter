import Link from 'next/link';
import type { RoadmapProject } from '@/lib/crm/data';

// Gantt-lite roadmap: each project is a lane; its bar spans the range of its
// dated issues, with a dot per issue positioned on its due date. Pure layout —
// percentages over a day-accurate time window so it scales to the container.
const DAY = 86400000;
const parse = (s: string) => new Date(s + 'T00:00:00');
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const addMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 1);

// Status/priority stay categorical, but drive them off the semantic tokens so
// the bars keep their meaning on both canvases. The old literals were
// light-mode pastels — #cbd5e1 all but vanished on the light surface and read
// as a bright smear in dark.
const STATUS_COLOR: Record<string, string> = {
  active: 'hsl(var(--success))', paused: 'hsl(var(--warning))',
  completed: 'hsl(var(--border-strong))', cancelled: 'hsl(var(--danger))',
};
const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'hsl(var(--danger))', high: 'hsl(var(--warning))', medium: 'hsl(var(--accent))',
  low: 'hsl(var(--text-tertiary))', none: 'hsl(var(--border-strong))',
};

export default function RoadmapTimeline({ projects }: { projects: RoadmapProject[] }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dated = projects.flatMap((p) => p.issues.filter((i) => i.due_date).map((i) => parse(i.due_date!)));
  const minDate = dated.length ? new Date(Math.min(...dated.map((d) => +d))) : today;
  const maxDate = dated.length ? new Date(Math.max(...dated.map((d) => +d))) : new Date(+today + 90 * DAY);
  const start = startOfMonth(new Date(Math.min(+minDate, +today)));
  const end = endOfMonth(new Date(Math.max(+maxDate, +today)));
  const totalDays = Math.round((+end - +start) / DAY) + 1;

  const dayOffset = (d: Date) => Math.round((+d - +start) / DAY);
  const leftPct = (d: Date) => (dayOffset(d) / totalDays) * 100;
  const centerPct = (d: Date) => ((dayOffset(d) + 0.5) / totalDays) * 100;
  const todayPct = centerPct(today);

  const months: { key: string; label: string; left: number; width: number }[] = [];
  for (let cur = new Date(start); +cur <= +end; cur = addMonth(cur)) {
    const me = endOfMonth(cur);
    const days = Math.round((+me - +cur) / DAY) + 1;
    months.push({
      key: `${cur.getFullYear()}-${cur.getMonth()}`,
      label: cur.toLocaleString('en', { month: 'short' }) + (cur.getMonth() === 0 ? ` '${String(cur.getFullYear()).slice(2)}` : ''),
      left: (dayOffset(cur) / totalDays) * 100,
      width: (days / totalDays) * 100,
    });
  }

  return (
    <div className="min-w-[820px]">
      {/* month header + today marker */}
      <div className="flex h-8 border-b border-subtle bg-surface">
        <div className="w-52 shrink-0 border-r border-subtle" />
        <div className="flex-1 relative">
          {months.map((m) => (
            <div key={m.key} className="absolute top-0 h-full border-l border-subtle flex items-center" style={{ left: `${m.left}%`, width: `${m.width}%` }}>
              <span className="pl-2 text-[11px] font-semibold text-tertiary">{m.label}</span>
            </div>
          ))}
          <div className="absolute top-0 h-full" style={{ left: `${todayPct}%` }}>
            <span className="absolute -translate-x-1/2 top-1.5 text-[9px] font-semibold uppercase tracking-wide text-accent bg-accent/10 rounded px-1">Today</span>
          </div>
        </div>
      </div>

      {/* one lane per project */}
      {projects.map((p) => {
        const dd = p.issues.filter((i) => i.due_date).map((i) => parse(i.due_date!));
        const undated = p.issues.length - dd.length;
        const hasBar = dd.length > 0;
        const lo = hasBar ? new Date(Math.min(...dd.map((d) => +d))) : today;
        const hi = hasBar ? new Date(Math.max(...dd.map((d) => +d))) : today;
        const barLeft = (dayOffset(lo) / totalDays) * 100;
        const barWidth = ((dayOffset(hi) - dayOffset(lo) + 1) / totalDays) * 100;
        const barColor = STATUS_COLOR[p.status] || STATUS_COLOR.active;

        return (
          <div key={p.id} className="flex items-stretch border-b border-subtle hover:bg-surface-sunken/40 transition-colors">
            <Link href={`/projects/${p.id}`} className="group w-52 shrink-0 px-3 py-3 border-r border-subtle flex flex-col justify-center min-w-0">
              <span className="text-[13px] font-semibold text-primary truncate group-hover:text-accent">{p.name}</span>
              <span className="mt-1 flex items-center gap-1.5">
                {p.identifier && <span className="text-[9px] font-semibold uppercase tracking-wide text-tertiary bg-surface-hover rounded px-1 py-0.5">{p.identifier}</span>}
                <span className="text-[11px] text-tertiary">{p.issues.length} {p.issues.length === 1 ? 'issue' : 'issues'}{undated ? ` · ${undated} undated` : ''}</span>
              </span>
            </Link>

            <div className="flex-1 relative py-4">
              {/* month gridlines */}
              {months.map((m) => <span key={m.key} className="absolute top-0 h-full w-px bg-surface-hover" style={{ left: `${m.left}%` }} />)}
              {/* today line */}
              <span className="absolute top-0 h-full w-px bg-accent/60" style={{ left: `${todayPct}%` }} />
              {/* project span bar */}
              {hasBar && (
                <div className="absolute top-1/2 -translate-y-1/2 h-2 rounded-full opacity-70" style={{ left: `${barLeft}%`, width: `${barWidth}%`, minWidth: '10px', background: barColor }} />
              )}
              {/* issue dots */}
              {p.issues.filter((i) => i.due_date).map((i) => (
                <span key={i.id}
                  title={`${i.title} · ${parse(i.due_date!).toLocaleDateString()} · ${i.priority} · ${i.status.replace(/_/g, ' ')}`}
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full ring-2 ring-canvas shadow-sm cursor-default"
                  style={{ left: `${centerPct(parse(i.due_date!))}%`, background: PRIORITY_COLOR[i.priority] || PRIORITY_COLOR.none }} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
