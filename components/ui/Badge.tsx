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

export default function Badge({ tone = 'neutral', children, className = '' }: {
  tone?: Tone; children: React.ReactNode; className?: string;
}) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium capitalize ${TONE[tone]} ${className}`}>
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
