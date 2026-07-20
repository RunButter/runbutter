// Report section registry.
//
// The point of this file: adding a report section — including for a feature
// that does not exist yet — means appending ONE entry here. The scope picker in
// the UI, the scheduler, and the PDF renderer all read this list, so nothing
// else has to change. Sections never draw anything themselves; they return data
// in the shared ReportBlock shape and the renderer knows how to draw that.
//
// Server-only: fetchers run with the service role inside the report routes.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ReportContext {
  db: SupabaseClient;
  workspaceId: string;
  /** A Privy DID belonging to the workspace — the RPCs resolve tenancy from it. */
  privy: string;
  from: Date;
  to: Date;
}

/** Everything the PDF renderer can draw. A section returns one of these. */
export interface ReportBlock {
  title: string;
  /** Headline numbers, drawn as a row of stat cards. */
  stats?: { label: string; value: string; hint?: string }[];
  /** Optional table. Keep to ~6 columns; the renderer truncates gracefully. */
  table?: { columns: string[]; rows: (string | number)[][] };
  /** A sentence under the block — context, caveats, "nothing happened". */
  note?: string;
}

export interface ReportSection {
  id: string;
  label: string;
  group: 'Sales' | 'Finance' | 'Marketing' | 'HR' | 'Projects';
  description: string;
  /** Return null to omit the section entirely (e.g. the module is unused). */
  fetch: (ctx: ReportContext) => Promise<ReportBlock | null>;
}

const money = (n: number) => `${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const int = (n: number) => Number(n || 0).toLocaleString('en-US');

// ── Sections ────────────────────────────────────────────────────────────────
// Each one is independent: if its RPC is missing or errors, it returns null and
// the report simply omits it rather than failing the whole run.

export const SECTIONS: ReportSection[] = [
  {
    id: 'finance_summary',
    label: 'Finance summary',
    group: 'Finance',
    description: 'Revenue, costs, profit, outstanding and payable.',
    async fetch({ db, workspaceId, privy }) {
      const { data, error } = await db.rpc('get_finance_summary', { p_privy: privy, p_workspace: workspaceId });
      if (error || !data) return null;
      const net = Number(data.net ?? (data.revenue - data.expenses));
      return {
        title: 'Finance summary',
        stats: [
          { label: 'Revenue', value: money(data.revenue) },
          { label: 'Costs', value: money(data.expenses) },
          { label: 'Net', value: money(net), hint: net >= 0 ? 'profit' : 'loss' },
          { label: 'Outstanding', value: money(data.outstanding), hint: 'owed to you' },
          { label: 'Payable', value: money(data.payable ?? 0), hint: 'you owe' },
        ],
        note: 'Revenue counts paid sales invoices only; costs combine expenses with paid supplier invoices. Quotes are excluded.',
      };
    },
  },
  {
    id: 'finance_trend',
    label: 'Revenue trend',
    group: 'Finance',
    description: 'Month-by-month revenue and costs over the period.',
    async fetch({ db, workspaceId, privy, from, to }) {
      const months = Math.max(1, Math.round((to.getTime() - from.getTime()) / (30 * 864e5)));
      const { data, error } = await db.rpc('get_finance_analytics', { p_privy: privy, p_workspace: workspaceId, p_months: Math.max(months, 3) });
      if (error || !data?.series?.length) return null;
      return {
        title: 'Revenue trend',
        stats: [
          { label: 'Margin', value: `${int(data.margin)}%` },
          { label: 'Net', value: money(data.net) },
        ],
        table: {
          columns: ['Month', 'Revenue', 'Costs', 'Net'],
          rows: data.series.map((p: any) => [p.month, money(p.revenue), money(p.costs), money(p.revenue - p.costs)]),
        },
      };
    },
  },
  {
    id: 'sales_pipeline',
    label: 'Sales pipeline',
    group: 'Sales',
    description: 'Deals by stage and total pipeline value.',
    async fetch({ db, workspaceId, privy }) {
      // rpc() returns { data, error } and never throws — no .catch() on it.
      const { data, error } = await db.rpc('get_pipeline_board', { p_privy: privy, p_workspace: workspaceId });
      if (error || !data) return null;
      const stages: any[] = Array.isArray(data.stages) ? data.stages : [];
      const records: any[] = Array.isArray(data.records) ? data.records : [];
      if (!stages.length) return null;
      return {
        title: 'Sales pipeline',
        stats: [
          { label: 'Open deals', value: int(records.length) },
          { label: 'Value', value: money(records.reduce((s, r) => s + Number(r.amount || 0), 0)) },
        ],
        table: {
          columns: ['Stage', 'Deals', 'Value'],
          rows: stages.map((st) => {
            const inStage = records.filter((r) => r.stage_id === st.id);
            return [st.name, inStage.length, money(inStage.reduce((s, r) => s + Number(r.amount || 0), 0))];
          }),
        },
      };
    },
  },
  {
    id: 'hr_overview',
    label: 'Hiring overview',
    group: 'HR',
    description: 'Candidates, open positions, interviews and assessments.',
    async fetch({ db, privy }) {
      const { data, error } = await db.rpc('hr_overview_data', { p_privy: privy });
      if (error || !data) return null;
      const rows: any[] = Array.isArray(data.status_rows) ? data.status_rows : [];
      const byStatus = rows.reduce((m: Record<string, number>, r: any) => {
        m[r.status] = (m[r.status] || 0) + 1; return m;
      }, {});
      return {
        title: 'Hiring overview',
        stats: [
          { label: 'Candidates', value: int(rows.length) },
          { label: 'Open roles', value: int(data.active_positions) },
          { label: 'Interviews', value: int(data.upcoming_interviews), hint: 'upcoming' },
          { label: 'Assessments', value: int(data.assessments_completed), hint: 'completed' },
        ],
        table: Object.keys(byStatus).length
          ? { columns: ['Stage', 'Candidates'], rows: Object.entries(byStatus).map(([k, v]) => [k.replace(/_/g, ' '), v as number]) }
          : undefined,
      };
    },
  },
  {
    id: 'marketing_traffic',
    label: 'Website traffic',
    group: 'Marketing',
    description: 'Visitors and top pages from the built-in analytics.',
    async fetch({ db, workspaceId, privy }) {
      const { data, error } = await db.rpc('get_sites', { p_privy: privy, p_workspace: workspaceId });
      if (error || !Array.isArray(data) || !data.length) return null;
      const site = data[0];
      const { data: stats } = await db.rpc('get_site_stats', { p_privy: privy, p_workspace: workspaceId, p_site: site.id });
      if (!stats) return null;
      return {
        title: 'Website traffic',
        stats: [
          { label: 'Visitors', value: int(stats.visitors) },
          { label: 'Views', value: int(stats.views) },
        ],
        table: Array.isArray(stats.top_pages) && stats.top_pages.length
          ? { columns: ['Page', 'Views'], rows: stats.top_pages.slice(0, 10).map((p: any) => [p.path, int(p.views)]) }
          : undefined,
      };
    },
  },
  {
    id: 'projects_status',
    label: 'Projects & issues',
    group: 'Projects',
    description: 'Open issues by status across projects.',
    async fetch({ db, workspaceId, privy }) {
      const { data, error } = await db.rpc('list_records', { p_privy: privy, p_workspace: workspaceId, p_object: 'issues' });
      if (error || !Array.isArray(data) || !data.length) return null;
      const byStatus = data.reduce((m: Record<string, number>, r: any) => {
        const k = r.status || 'unknown'; m[k] = (m[k] || 0) + 1; return m;
      }, {});
      return {
        title: 'Projects & issues',
        stats: [{ label: 'Open issues', value: int(data.filter((r: any) => r.status !== 'done').length) }],
        table: { columns: ['Status', 'Issues'], rows: Object.entries(byStatus).map(([k, v]) => [k, v as number]) },
      };
    },
  },
];

export const SECTION_IDS = SECTIONS.map((s) => s.id);
export const getSection = (id: string) => SECTIONS.find((s) => s.id === id);

/** Shape the UI needs to render the scope picker — no fetchers leak client-side. */
export const SECTION_CATALOG = SECTIONS.map(({ id, label, group, description }) => ({ id, label, group, description }));
