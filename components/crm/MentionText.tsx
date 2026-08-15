'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { rpc } from '@/lib/rpc';
import { splitMentions, extractRefs, refHref } from '@/lib/crm/mentions';

/**
 * Render a body, turning `rb-ref:` tokens into live links.
 *
 * Labels are resolved per render rather than stored, so renaming a company
 * updates every message that ever mentioned it — the point of storing an id.
 *
 * ── PIECES, NOT HTML ────────────────────────────────────────────────────────
 * splitMentions returns text and refs in order and this builds React nodes from
 * them, so a company called `<script>` lands in a text node. Nothing here has to
 * remember to escape anything.
 *
 * A ref that does not resolve — deleted, or another tenant's id in a forwarded
 * body — renders as muted plain text rather than a broken link or a blank. The
 * sentence still reads.
 */

// One cache for the page: a channel of forty messages usually mentions the same
// six clients, and forty round trips for six answers is absurd.
const cache = new Map<string, string | null>();

export default function MentionText({ text, privy, className }: {
  text: string; privy: string | null; className?: string;
}) {
  const [, force] = useState(0);

  useEffect(() => {
    const refs = extractRefs(text).filter((r) => !cache.has(`${r.object}:${r.id}`));
    if (!refs.length || !privy) return;
    let cancelled = false;
    rpc('resolve_record_labels', { p_privy: privy, p_refs: refs }).then(({ data }) => {
      if (cancelled || !Array.isArray(data)) return;
      for (const row of data as any[]) cache.set(`${row.object}:${row.id}`, row.label ?? null);
      force((n) => n + 1);
    });
    return () => { cancelled = true; };
  }, [text, privy]);

  const pieces = splitMentions(text);
  if (pieces.length === 1 && pieces[0].kind === 'text') {
    return <span className={className}>{pieces[0].text}</span>;
  }

  return (
    <span className={className}>
      {pieces.map((p, i) => {
        if (p.kind === 'text') return <span key={i}>{p.text}</span>;
        const label = cache.get(`${p.object}:${p.id}`);
        if (label === undefined) {
          // Still resolving. A neutral placeholder rather than the raw token —
          // nobody should ever see `rb-ref:` in a sentence.
          return <span key={i} className="text-tertiary">@…</span>;
        }
        if (label === null) {
          return <span key={i} className="text-tertiary" title="This record is no longer available">@unknown</span>;
        }
        return (
          <Link key={i} href={refHref(p.object, p.id)}
            className="text-accent hover:underline font-medium">@{label}</Link>
        );
      })}
    </span>
  );
}
