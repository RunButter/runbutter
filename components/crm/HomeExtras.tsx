'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles, ListChecks, ArrowRight } from 'lucide-react';
import { getAIUsage, fmtTokens, cacheRate, FEATURE_LABEL, type AIUsage } from '@/lib/crm/ai-usage';
import { loadDocs, type DocMeta } from '@/lib/crm/docs';

/**
 * The two things the dashboard had no way to show.
 *
 * Everything else on this screen predates the copilot: money, hiring, deals,
 * transactions. Two questions became askable and nothing asked them — "what has
 * the AI been doing and what did it cost", and "what did I write down that is
 * still not done".
 *
 * Its own file because a page can only export a default, so anything declared
 * inside `home/page.tsx` cannot be rendered anywhere else — the same reason
 * `ObjectCards.tsx` and `AIUsagePanel.tsx` exist. It is also the seam where
 * per-user card choice would attach later: one component, one place to decide
 * what a person sees.
 *
 * EACH CARD HIDES ITSELF WHEN IT HAS NOTHING. A dashboard tile reading "0" for a
 * feature somebody has never used is a tile teaching them the product is empty.
 * The row disappears entirely rather than reserving space for absence.
 */
export default function HomeExtras({ privy, ws }: { privy: string | null; ws: string | null }) {
  const [usage, setUsage] = useState<AIUsage | null>(null);
  const [todos, setTodos] = useState<DocMeta[]>([]);

  useEffect(() => {
    if (!privy) return;
    let off = false;
    // Both are optional: a workspace without 0101 has no usage function and one
    // without 0081 has no kinds. Neither is worth an error on a dashboard.
    if (ws) getAIUsage(privy, ws, 30).then((u) => { if (!off) setUsage(u); }).catch(() => {});
    loadDocs(privy)
      .then((d) => { if (!off) setTodos((d.rows || []).filter((r) => r.kind === 'todo').slice(0, 4)); })
      .catch(() => {});
    return () => { off = true; };
  }, [privy, ws]);

  const hasUsage = !!usage && usage.totals.calls > 0;
  if (!hasUsage && todos.length === 0) return null;

  const top = usage?.by_feature?.[0];
  const rate = usage ? cacheRate(usage.totals.input, usage.totals.cached) : null;

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {hasUsage && usage && (
        <section className="card-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-base font-medium text-primary">What the AI did</h3>
              <p className="text-xs text-tertiary">Last 30 days · on your own key</p>
            </div>
            <Link href="/settings/ai" className="text-xs text-secondary hover:text-primary inline-flex items-center gap-1">
              Details <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Figure label="Requests" value={String(usage.totals.calls)} />
            {/* Tokens, never money — a per-model price table is wrong the week
                after it is written, and a self-hosted model costs nothing. */}
            <Figure label="Sent in" value={fmtTokens(usage.totals.input)} sub={rate !== null ? `${rate}% cached` : undefined} />
            <Figure label="Came back" value={fmtTokens(usage.totals.output)} />
          </div>

          {top && (
            <p className="text-xs text-secondary mt-3 pt-3 border-t border-subtle">
              Mostly <b className="text-primary font-medium">{FEATURE_LABEL[top.feature] || top.feature}</b>
              {' — '}{top.calls} request{top.calls === 1 ? '' : 's'}.
              {usage.totals.unreported > 0 && (
                <span className="text-tertiary">
                  {' '}{usage.totals.unreported} reported no token count, so the totals are partial.
                </span>
              )}
            </p>
          )}
        </section>
      )}

      {todos.length > 0 && (
        <section className="card-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-base font-medium text-primary">Your to-do lists</h3>
              <p className="text-xs text-tertiary">Checklists in Docs</p>
            </div>
            <Link href="/docs" className="text-xs text-secondary hover:text-primary inline-flex items-center gap-1">
              Open Docs <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <ul className="space-y-1">
            {todos.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/docs/${t.id}`}
                  className="flex items-start gap-2 rounded-lg px-2 py-1.5 -mx-2 hover:bg-surface-hover"
                >
                  <ListChecks className="w-3.5 h-3.5 text-tertiary shrink-0 mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-sm text-primary truncate">{t.title || 'Untitled'}</span>
                    {/* The snippet, not a progress count. `loadDocs` returns
                        titles and snippets, never bodies — counting unticked
                        boxes would be one round trip per list, on a dashboard,
                        for a number nobody asked for. */}
                    {t.snippet && <span className="block text-xs text-tertiary truncate">{t.snippet}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-2xs text-tertiary mb-0.5">{label}</div>
      <div className="text-md font-medium text-primary tabular-nums">{value}</div>
      {sub && <div className="text-3xs text-tertiary mt-0.5">{sub}</div>}
    </div>
  );
}
