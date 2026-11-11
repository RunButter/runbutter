import { CheckCircle2, CircleDashed, Clock, XCircle, PauseCircle, type LucideIcon } from 'lucide-react';

// Status/tag chip. Semantic tones only — pages must not invent per-value
// color classes (that is how the platform drifted out of sync before).
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-hover text-secondary',
  accent: 'bg-accent/10 text-accent',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
};

export default function Badge({ tone = 'neutral', icon: Icon, children, className = '' }: {
  tone?: Tone; icon?: LucideIcon; children: React.ReactNode; className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-2xs font-medium capitalize ${TONE[tone]} ${className}`}>
      {Icon && <Icon className="w-3 h-3 shrink-0" />}
      {children}
    </span>
  );
}

// Shared mapping from a record's status/category value to a semantic tone, so
// every surface (tables, boards, detail panes) badges the same value the same way.
const TONE_BY_VALUE: Record<string, Tone> = {
  paid: 'success', approved: 'success', accepted: 'success', active: 'success',
  available: 'success', done: 'success', hired: 'success', income: 'success', won: 'success',
  sent: 'accent', todo: 'accent', assigned: 'accent', in_progress: 'accent',
  interview: 'accent', medium: 'accent', license: 'accent', software: 'accent',
  pending: 'warning', repair: 'warning', paused: 'warning', high: 'warning',
  screening: 'warning', travel: 'warning', overdue: 'danger', declined: 'danger',
  cancelled: 'danger', urgent: 'danger', rejected: 'danger', cost: 'danger',
};

export const toneFor = (value: string): Tone =>
  TONE_BY_VALUE[String(value || '').toLowerCase()] ?? 'neutral';

// Glyph for lifecycle STATUS values only. Deliberately narrower than toneFor:
// priorities (high/urgent), categories and types are badged but get no icon, so
// a row of chips doesn't turn into visual noise. Unknown values → no icon.
const ICON_BY_VALUE: Record<string, LucideIcon> = {
  done: CheckCircle2, paid: CheckCircle2, approved: CheckCircle2, accepted: CheckCircle2,
  hired: CheckCircle2, won: CheckCircle2, active: CheckCircle2, available: CheckCircle2,
  in_progress: CircleDashed, screening: CircleDashed, interview: CircleDashed,
  pending: Clock, todo: Clock, sent: Clock, draft: Clock,
  overdue: XCircle, declined: XCircle, cancelled: XCircle, rejected: XCircle,
  paused: PauseCircle,
};

export const iconFor = (value: string): LucideIcon | undefined =>
  ICON_BY_VALUE[String(value || '').toLowerCase()];
