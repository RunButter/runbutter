// Builds a report: run the chosen sections, render the PDF. Shared by the
// on-demand preview and the scheduled dispatcher so both produce the identical
// document.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSection, type ReportBlock, type ReportContext } from './registry';
import { renderReportPdf } from './pdf';

export interface BuildArgs {
  db: SupabaseClient;
  workspaceId: string;
  workspaceName: string;
  privy: string;
  sectionIds: string[];
  from: Date;
  to: Date;
  title?: string;
}

export interface BuiltReport { pdf: Buffer; sections: string[]; skipped: string[] }

export async function buildReport(a: BuildArgs): Promise<BuiltReport> {
  const ctx: ReportContext = { db: a.db, workspaceId: a.workspaceId, privy: a.privy, from: a.from, to: a.to };

  const blocks: ReportBlock[] = [];
  const included: string[] = [];
  const skipped: string[] = [];

  // Sequential on purpose: these hit the same Postgres and a report is not
  // latency-sensitive. One failing section must never sink the whole report —
  // it is simply left out and named in `skipped`.
  for (const id of a.sectionIds) {
    const section = getSection(id);
    if (!section) { skipped.push(id); continue; }
    try {
      const block = await section.fetch(ctx);
      if (block) { blocks.push(block); included.push(id); }
      else skipped.push(id);
    } catch (e) {
      console.error(`report section "${id}" failed:`, e);
      skipped.push(id);
    }
  }

  const pdf = await renderReportPdf(
    {
      workspaceName: a.workspaceName,
      title: a.title || 'Business report',
      from: a.from,
      to: a.to,
      generatedAt: new Date(),
    },
    blocks,
  );

  return { pdf, sections: included, skipped };
}

/** Period covered by a report running now, for the given cadence. */
export function periodFor(frequency: 'weekly' | 'monthly', now = new Date()): { from: Date; to: Date } {
  const to = new Date(now);
  const from = new Date(now);
  if (frequency === 'weekly') from.setDate(from.getDate() - 7);
  else from.setMonth(from.getMonth() - 1);
  return { from, to };
}
