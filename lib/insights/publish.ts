'use client';

import { rpc } from '@/lib/rpc';
import type { InsightResult } from './run';
import type { ChartKind } from './spec';

/**
 * Publishing stores the ANSWER, not the question.
 *
 * 0109's whole argument: a link that re-runs a query makes any bug in that path
 * a tenant-wide breach, reachable by anyone holding a URL. So what goes into the
 * row is the finished buckets, the total and the human-readable query string —
 * never the spec, never the object slug, nothing that could be executed again.
 *
 * `query` is the sentence describeSpec() already produces. It travels because a
 * chart without its question is a number somebody has to take on trust, and the
 * reader cannot ask what it meant.
 */
export interface PublishInput {
  title: string;
  result: InsightResult;
  chart: ChartKind;
  currency: boolean;
  query: string;
  /** Days until the link stops working. Omit for no expiry. */
  days?: number | null;
}

export async function publishInsight(
  privy: string, ws: string, input: PublishInput,
): Promise<{ token?: string; error?: string }> {
  const { error, data } = await rpc('publish_insight', {
    p_privy: privy,
    p_workspace: ws,
    p_title: input.title,
    p_data: {
      // Only what the public page renders. Deliberately no rows: the records
      // behind a chart are the part nobody chose to share.
      buckets: input.result.buckets,
      total: input.result.total,
      chart: input.chart,
      currency: input.currency,
      query: input.query,
    },
    p_days: input.days ?? null,
  });
  if (error) return { error: error.message };
  const token = (data as any)?.token;
  return typeof token === 'string' ? { token } : { error: 'No link was returned.' };
}
