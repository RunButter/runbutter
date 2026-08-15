'use client';

import PasswordGenerator from '@/components/crm/PasswordGenerator';

/**
 * The public page is a server component so its metadata and FAQ structured data
 * are static; the generator is necessarily client-side. This is the one-line
 * boundary between them — the SAME component the vault uses, not a second copy,
 * so the public tool and the product cannot end up with different samplers.
 */
export default function PasswordGeneratorCard() {
  return (
    <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-5 sm:p-6">
      <PasswordGenerator embedded />
    </div>
  );
}
