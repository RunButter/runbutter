import { iconFor } from '@/lib/crm/object-icons';

/**
 * The thing custom objects are FOR, shown rather than described.
 *
 * "Define your own record types" is abstract and every CRM claims it. A drifting
 * row of the things real businesses actually track — vehicles, patients,
 * shipments, kilns — makes the point in the time it takes to read three words,
 * and someone whose business is on the list recognises themselves.
 *
 * Every entry here is a real object from one of the ten trade templates in
 * `lib/workspace/templates.ts`, with that template's own icon, so this cannot
 * advertise something the product does not ship. The icons come from the same
 * registry the app uses, which throws at import on an unknown name.
 *
 * CSS-only: no rAF, no JS, no measurement. The hero taught us what a canvas
 * costs on this page; a decorative strip is not allowed to cost anything.
 */
const ITEMS: { label: string; icon: string }[] = [
  { label: 'Vehicles', icon: 'Truck' },
  { label: 'Patients', icon: 'HeartPulse' },
  { label: 'Shipments', icon: 'Package' },
  { label: 'Properties', icon: 'Home' },
  { label: 'Machines', icon: 'Wrench' },
  { label: 'Service calls', icon: 'ClipboardList' },
  { label: 'Students', icon: 'GraduationCap' },
  { label: 'Menu items', icon: 'Utensils' },
  { label: 'Batches', icon: 'Factory' },
  { label: 'Cases', icon: 'Scale' },
  { label: 'Bookings', icon: 'CalendarClock' },
  { label: 'Inventory', icon: 'Boxes' },
];

function Row({ ariaHidden = false }: { ariaHidden?: boolean }) {
  return (
    <div className="marquee-row flex shrink-0 items-center gap-3 pr-3" aria-hidden={ariaHidden || undefined}>
      {ITEMS.map((it) => {
        const Icon = iconFor(it.icon);
        return (
          <span
            key={it.label}
            className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg border border-subtle bg-surface text-sm text-secondary whitespace-nowrap"
          >
            <Icon className="w-3.5 h-3.5 text-tertiary shrink-0" />
            {it.label}
          </span>
        );
      })}
    </div>
  );
}

export default function ObjectMarquee() {
  return (
    // The mask is what makes it read as "…and more" instead of a list that
    // happens to be cut off at the viewport edge.
    <div
      className="marquee relative flex overflow-hidden
                 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]
                 [-webkit-mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]"
    >
      <Row />
      {/* An exact duplicate is what makes the loop seamless: the track is
          translated by precisely one row's width, so the copy is already in
          the first one's place when it resets. It is decorative repetition, so
          it is hidden from assistive tech. */}
      <Row ariaHidden />
    </div>
  );
}
