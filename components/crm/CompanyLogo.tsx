'use client';

import { useEffect, useState } from 'react';
import { logoCandidates, initialsOf } from '@/lib/crm/logo';

interface Props {
  name: string;
  domain?: string | null;
  /** Rendered box size in px. Also what we request from the provider. */
  size?: number;
  className?: string;
}

/**
 * A company's favicon when we can get one, its initials when we can't.
 *
 * Walks the provider list on error rather than showing a broken image: plenty
 * of domains have no favicon at all, and a missing logo should look deliberate,
 * not broken. Resets when the domain changes so a re-used row doesn't keep a
 * previous company's fallback state.
 */
export default function CompanyLogo({ name, domain, size = 20, className = '' }: Props) {
  const sources = logoCandidates(domain, Math.max(32, size * 2));   // 2x for retina
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { setAttempt(0); }, [domain]);

  const src = sources[attempt];
  const box = { width: size, height: size };

  if (!src) {
    return (
      <div style={box} className={`rounded-full bg-surface-hover text-secondary font-medium flex items-center justify-center shrink-0 ${className}`}>
        <span style={{ fontSize: Math.max(8, Math.round(size * 0.42)) }}>{initialsOf(name)}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      style={box}
      onError={() => setAttempt((a) => a + 1)}
      className={`rounded-full object-contain bg-surface ring-1 ring-subtle shrink-0 ${className}`}
    />
  );
}
