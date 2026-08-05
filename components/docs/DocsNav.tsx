'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import type { DocSection } from '@/lib/docs-nav';

/**
 * The docs sidebar — a sticky column on a desktop, a disclosure on a phone.
 *
 * A client component only because of that disclosure. Everything else about the
 * docs is static.
 */
export default function DocsNav({ sections, current }: { sections: DocSection[]; current: string }) {
  const [open, setOpen] = useState(false);
  const here = sections.flatMap((s) => s.items).find((i) => i.slug === current);

  return (
    <nav className="lg:py-10">
      {/* Phone: one button that says where you are, opening the whole list. */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="lg:hidden w-full h-11 mt-4 px-3 flex items-center justify-between rounded-lg border border-subtle bg-surface text-sm text-primary"
      >
        <span>{here?.title || 'Documentation'}</span>
        <ChevronDown className={`w-4 h-4 text-tertiary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <div className={`${open ? 'block' : 'hidden'} lg:block lg:sticky lg:top-20 mt-4 lg:mt-0 pb-6`}>
        {sections.map((s) => (
          <div key={s.group} className="mb-6">
            <div className="text-2xs font-medium uppercase tracking-wider text-tertiary mb-2">{s.group}</div>
            <ul className="space-y-0.5">
              {s.items.map((i) => {
                const active = i.slug === current;
                return (
                  <li key={i.slug}>
                    <Link
                      href={i.slug === 'index' ? '/developers' : `/developers/${i.slug}`}
                      onClick={() => setOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={`block px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                        active ? 'bg-surface text-primary font-medium' : 'text-secondary hover:text-primary hover:bg-surface-hover'
                      }`}
                    >
                      {i.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
