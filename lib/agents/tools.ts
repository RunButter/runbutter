// Shared workspace tool executor. ONE implementation used by both the MCP
// server (app/api/mcp) and the in-app agent runner (lib/agents/runner) so an
// agent and an external MCP client act through exactly the same, tenancy-safe
// path. A tool call always runs inside ctx.workspace as ctx.privy.
//
// TENANCY NOTE, because it looks inconsistent at a glance: some RPCs below are
// passed p_workspace and some are not. That is correct. list_records and
// create_record take an explicit workspace; get_record / update_record derive
// the caller's permitted workspaces from p_privy inside SQL
// (`where ... workspace_id = any(my)`). Both are scoped — just at different
// layers — so don't "fix" the ones without p_workspace by inventing an argument.
import { runDispatcher } from '@/lib/automations/dispatcher';
import { validateIban } from '@/lib/finance/iban';
import { parseReceiptText, suggestCategory } from '@/lib/finance/receipt-parse';

export interface ToolCtx { admin: any; workspace: string; privy: string }

export const OBJECTS: Record<string, string> = {
  companies: 'CRM organizations (name, domain, industry, employee_count, tax_id, address, country)',
  people: 'Contacts / candidates (first_name, last_name, email, phone, title, source)',
  invoices: 'Invoices & bills (number, organization_id, direction income|cost, amount, status draft|sent|paid|overdue, issued_at, due_at, notes)',
  offers: 'Sales offers / quotes (same fields as invoices)',
  expenses: 'Expenses (vendor, category, amount, status pending|approved|paid, spent_at, notes)',
  transactions: 'Bank ledger (txn_date, description, amount signed +in/-out, category, method, status posted|pending|excluded)',
  products: 'Products / services (name, sku, unit_price, unit, category, description)',
  campaigns: 'Marketing campaigns (name, channel, status, budget, spend, leads, starts_on, ends_on)',
  projects: 'Projects (name, identifier, status, description)',
  issues: 'Project issues/tasks (title, status backlog|todo|in_progress|done|cancelled, priority, due_date, description)',
  assets: 'Company equipment (name, category laptop|monitor|phone|license|other, serial_number, status available|assigned|repair|retired, assigned_to_person_id)',
};

// JSON-schema tool defs (shared by MCP tools/list and the agent tool-calling loop).
export const TOOLS = [
  { name: 'list_objects', description: 'List the record types available in this RunButter workspace and their fields.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_records', description: 'List records of an object type (most recent first).', inputSchema: { type: 'object', properties: { object: { type: 'string', enum: Object.keys(OBJECTS) } }, required: ['object'] } },
  { name: 'search_records', description: 'Search records of an object type by a text query (matched across all fields).', inputSchema: { type: 'object', properties: { object: { type: 'string', enum: Object.keys(OBJECTS) }, query: { type: 'string' } }, required: ['object', 'query'] } },
  { name: 'get_record', description: 'Fetch one record by id.', inputSchema: { type: 'object', properties: { object: { type: 'string', enum: Object.keys(OBJECTS) }, id: { type: 'string' } }, required: ['object', 'id'] } },
  { name: 'create_record', description: 'Create a record. `data` uses the object\'s fields (see list_objects).', inputSchema: { type: 'object', properties: { object: { type: 'string', enum: Object.keys(OBJECTS) }, data: { type: 'object' } }, required: ['object', 'data'] } },
  { name: 'update_record', description: 'Update fields on an existing record.', inputSchema: { type: 'object', properties: { object: { type: 'string', enum: Object.keys(OBJECTS) }, id: { type: 'string' }, data: { type: 'object' } }, required: ['object', 'id', 'data'] } },

  // ── Beyond CRUD ───────────────────────────────────────────────────────────
  // The six tools above make this a database wrapper. These make it a company:
  // each one is an existing, already-secured RPC or a pure local function, so
  // an agent can answer "how much are we owed", "is this vendor sanctioned",
  // "who applied for the CFO role" without a bespoke integration.
  { name: 'get_finance_summary', description: 'Money in/out right now: revenue, outstanding (owed to you), payable (you owe), expenses, invoice counts.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_finance_trends', description: 'Monthly revenue/expense series and category breakdown for charting or analysis.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_ledger', description: 'Bank transaction ledger with running balance and reconciliation state.', inputSchema: { type: 'object', properties: {} } },

  { name: 'screen_sanctions', description: 'Screen a company or person name against the imported OFAC sanctions lists. Returns status clear|review|no_data plus any matches. "no_data" means no list is loaded — it does NOT mean clear.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, record_id: { type: 'string', description: 'Optional record this screening relates to.' } }, required: ['name'] } },
  { name: 'get_sanctions_status', description: 'How many sanctions entries are loaded and when each source last synced.', inputSchema: { type: 'object', properties: {} } },

  { name: 'validate_iban', description: 'Check an IBAN structurally (ISO 13616 length + mod-97 checksum). Confirms the number is well-formed, NOT that the account exists.', inputSchema: { type: 'object', properties: { iban: { type: 'string' } }, required: ['iban'] } },
  { name: 'parse_invoice_text', description: 'Extract total, currency, date, NIP, VAT id, IBAN, invoice number and VAT rates from invoice or receipt TEXT, and suggest a category from this workspace\'s own history.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },

  { name: 'list_sites', description: 'Websites tracked by this workspace\'s analytics.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_site_stats', description: 'Web analytics for one site: pageviews, visitors, live count, top pages, referrers, countries, browsers and campaigns.', inputSchema: { type: 'object', properties: { site_id: { type: 'string' }, days: { type: 'number', description: 'Window in days, default 30.' } }, required: ['site_id'] } },

  { name: 'list_positions', description: 'Open hiring positions in this workspace.', inputSchema: { type: 'object', properties: {} } },
  { name: 'search_candidates', description: 'Full-text search the candidate database (resumes included). Postgres FTS, no AI cost.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'get_candidate', description: 'Full detail for one candidate including assessment scores.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'get_hiring_pipeline', description: 'A pipeline board with its stages and the records in each. kind defaults to the hiring pipeline.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['recruitment', 'sales'] } } } },

  // Files are the reason an agent can answer questions about documents at all:
  // search_files reaches INSIDE uploaded contracts and invoices, and the results
  // carry linked_object/linked_id, so a hit can be joined back to the company or
  // invoice it belongs to using the CRUD tools above.
  { name: 'search_files', description: 'Full-text search the CONTENTS of uploaded files (contracts, invoices, CVs). Returns matching files with highlighted snippets. Postgres FTS, no AI cost. Only files that were text-extracted are searchable.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Supports quoted phrases and OR.' } }, required: ['query'] } },
  { name: 'list_files', description: 'Files in the workspace, optionally only those attached to one record. Reports each file\'s extraction status but not its text — use get_file_text for that.', inputSchema: { type: 'object', properties: { object: { type: 'string', description: 'Filter by linked record type, e.g. companies.' }, id: { type: 'string', description: 'Filter by linked record id.' } } } },
  { name: 'get_file_text', description: 'The full extracted text of one file. Can be long — prefer search_files when looking for a passage.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
] as const;

export const READ_TOOLS = [
  'list_objects', 'list_records', 'search_records', 'get_record',
  'get_finance_summary', 'get_finance_trends', 'get_ledger',
  // screen_sanctions appends a row to its own audit trail, which is the entire
  // point of the feature — but it mutates no business data, so gating it behind
  // write approval would just stop agents from running compliance checks.
  'screen_sanctions', 'get_sanctions_status',
  'validate_iban', 'parse_invoice_text',
  'list_sites', 'get_site_stats',
  'list_positions', 'search_candidates', 'get_candidate', 'get_hiring_pipeline',
  'search_files', 'list_files', 'get_file_text',
];
export const WRITE_TOOLS = ['create_record', 'update_record'];
export const isWriteTool = (name: string) => WRITE_TOOLS.includes(name);

const rpcObject = (o: string) => (o === 'offers' ? 'invoices' : o);

async function listRows(ctx: ToolCtx, object: string): Promise<any[]> {
  const { data, error } = await ctx.admin.rpc('list_records', { p_privy: ctx.privy, p_workspace: ctx.workspace, p_object: rpcObject(object) });
  if (error) throw new Error(error.message);
  let rows = (data as any[]) || [];
  if (object === 'offers') rows = rows.filter((r) => r.kind === 'offer');
  else if (object === 'invoices') rows = rows.filter((r) => r.kind !== 'offer');
  return rows;
}

// Execute a tool. Reads run always; writes run here too — the CALLER decides
// whether a write is allowed (autonomy / approval). Keep that gate upstream.
/** Call an RPC and surface its error as a thrown Error the agent loop can report. */
async function rpc(ctx: ToolCtx, fn: string, args: Record<string, any>): Promise<any> {
  const { data, error } = await ctx.admin.rpc(fn, args);
  if (error) {
    // A missing function means the migration hasn't been run — say so plainly
    // rather than letting the agent report an opaque Postgres error.
    if (/does not exist|schema cache/i.test(error.message)) {
      throw new Error(`${fn} is not available on this deployment — its migration has not been run.`);
    }
    throw new Error(error.message);
  }
  return data;
}

export async function callTool(ctx: ToolCtx, name: string, args: any): Promise<any> {
  // Only the CRUD tools take an `object`; the rest are validated individually.
  const CRUD = ['list_records', 'search_records', 'get_record', 'create_record', 'update_record'];
  const object = args?.object as string;
  if (CRUD.includes(name) && !OBJECTS[object]) {
    throw new Error(`Unknown object "${object}". Use one of: ${Object.keys(OBJECTS).join(', ')}`);
  }
  switch (name) {
    case 'list_objects':
      return Object.entries(OBJECTS).map(([k, v]) => ({ object: k, fields: v }));
    case 'list_records':
      return (await listRows(ctx, object)).slice(0, 100);
    case 'search_records': {
      const q = String(args?.query || '').toLowerCase();
      return (await listRows(ctx, object)).filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q))).slice(0, 50);
    }
    case 'get_record': {
      const { data, error } = await ctx.admin.rpc('get_record', { p_privy: ctx.privy, p_object: rpcObject(object), p_id: args.id });
      if (error) throw new Error(error.message);
      return data ?? { error: 'Not found' };
    }
    case 'create_record': {
      const payload = object === 'offers' ? { ...(args.data || {}), kind: 'offer' } : (args.data || {});
      const { data, error } = await ctx.admin.rpc('create_record', { p_privy: ctx.privy, p_workspace: ctx.workspace, p_object: rpcObject(object), p_data: payload });
      if (error) throw new Error(error.message);
      runDispatcher(ctx.admin, 10).catch(() => {});
      return { ok: true, id: data };
    }
    case 'update_record': {
      const { error } = await ctx.admin.rpc('update_record', { p_privy: ctx.privy, p_object: rpcObject(object), p_id: args.id, p_data: args.data || {} });
      if (error) throw new Error(error.message);
      runDispatcher(ctx.admin, 10).catch(() => {});
      return { ok: true, id: args.id };
    }

    // ── Finance ─────────────────────────────────────────────────────────────
    case 'get_finance_summary':
      return rpc(ctx, 'get_finance_summary', { p_privy: ctx.privy, p_workspace: ctx.workspace });
    case 'get_finance_trends':
      return rpc(ctx, 'get_finance_analytics', { p_privy: ctx.privy, p_workspace: ctx.workspace });
    case 'get_ledger':
      return rpc(ctx, 'get_transactions_ledger', { p_privy: ctx.privy, p_workspace: ctx.workspace });

    // ── Compliance ──────────────────────────────────────────────────────────
    case 'screen_sanctions': {
      const query = String(args?.name || '').trim();
      if (query.length < 3) throw new Error('Give at least three characters to screen.');
      const result = await rpc(ctx, 'screen_sanctions', {
        p_privy: ctx.privy, p_workspace: ctx.workspace, p_query: query,
        p_object: null, p_record: args?.record_id || null,
      });
      // Spell out the trap in the payload the model sees. An agent that treats
      // no_data as "clear" would report a company as screened when no list is
      // even loaded, which is worse than refusing to answer.
      if ((result as any)?.status === 'no_data') {
        return { ...result, warning: 'No sanctions list is loaded, so this name was NOT checked. Do not report it as clear.' };
      }
      return result;
    }
    case 'get_sanctions_status':
      return rpc(ctx, 'get_sanctions_status', { p_privy: ctx.privy, p_workspace: ctx.workspace });

    // ── Local, no database ──────────────────────────────────────────────────
    case 'validate_iban': {
      const check = validateIban(String(args?.iban || ''));
      return {
        valid: check.valid, reason: check.reason, message: check.message,
        country: check.country, country_name: check.countryName,
        formatted: check.formatted, compact: check.compact,
        note: 'Structural check only — confirms the number is well-formed, not that the account exists or belongs to anyone in particular.',
      };
    }
    case 'parse_invoice_text': {
      const text = String(args?.text || '');
      if (!text.trim()) throw new Error('Provide the invoice text to parse.');
      const parsed = parseReceiptText(text);
      // Suggest from the workspace's own expense history, so the category comes
      // from their books rather than the model's imagination.
      let history: { vendor: string; category: string }[] = [];
      try {
        const rows = await rpc(ctx, 'list_records', { p_privy: ctx.privy, p_workspace: ctx.workspace, p_object: 'expenses' });
        history = ((rows as any[]) || [])
          .filter((r) => r.vendor && r.category)
          .map((r) => ({ vendor: String(r.vendor), category: String(r.category) }));
      } catch { /* suggestion degrades to keyword matching */ }
      const suggestion = suggestCategory(parsed.vendorGuess, history);
      return { ...parsed, suggested_category: suggestion.category, suggestion_source: suggestion.source };
    }

    // ── Marketing / analytics ───────────────────────────────────────────────
    case 'list_sites':
      return rpc(ctx, 'get_sites', { p_privy: ctx.privy, p_workspace: ctx.workspace });
    case 'get_site_stats': {
      if (!args?.site_id) throw new Error('site_id is required — call list_sites first.');
      const days = Math.min(365, Math.max(1, Number(args?.days) || 30));
      return rpc(ctx, 'get_site_stats', { p_privy: ctx.privy, p_site: args.site_id, p_days: days });
    }

    // ── HR ──────────────────────────────────────────────────────────────────
    case 'list_positions':
      return rpc(ctx, 'hr_list_positions_min', { p_privy: ctx.privy });
    case 'search_candidates': {
      const q = String(args?.query || '').trim();
      if (!q) throw new Error('Provide a search query.');
      return rpc(ctx, 'search_candidates_for_recruiter', { p_privy_user_id: ctx.privy, p_query: q });
    }
    case 'get_candidate': {
      if (!args?.id) throw new Error('id is required.');
      return rpc(ctx, 'get_candidate_details', { p_privy_user_id: ctx.privy, p_candidate_id: args.id });
    }
    case 'get_hiring_pipeline': {
      // Two hops, same as the UI: get_pipeline_board takes a PIPELINE id, not a
      // user, so resolve the workspace's pipeline of that kind first.
      const kind = args?.kind === 'sales' ? 'sales' : 'recruitment';
      const pipelineId = await rpc(ctx, 'get_pipeline_by_kind', {
        p_privy: ctx.privy, p_workspace: ctx.workspace, p_kind: kind,
      });
      if (!pipelineId) return { stages: [], records: [], note: `No ${kind} pipeline exists in this workspace yet.` };
      return rpc(ctx, 'get_pipeline_board', { p_privy: ctx.privy, p_pipeline: pipelineId });
    }

    // ── Files ───────────────────────────────────────────────────────────────
    case 'search_files': {
      const q = String(args?.query || '').trim();
      if (!q) throw new Error('Provide a search query.');
      const hits = await rpc(ctx, 'search_files', { p_privy: ctx.privy, p_workspace: ctx.workspace, p_query: q });
      const list = Array.isArray(hits) ? hits : [];
      if (list.length === 0) {
        // "No results" and "nothing is indexed" are different answers, and an
        // agent that conflates them will confidently report that a clause is
        // absent from a contract it never read.
        const all = await rpc(ctx, 'get_files', { p_privy: ctx.privy, p_workspace: ctx.workspace, p_limit: 500 });
        const rows = Array.isArray(all) ? all : [];
        const indexed = rows.filter((r: any) => r.has_content).length;
        if (rows.length > 0 && indexed === 0) {
          return { results: [], warning: `No file in this workspace has extracted text yet (${rows.length} stored), so nothing can be searched by content. This is NOT evidence that the term is absent.` };
        }
        return { results: [], searched_files: indexed };
      }
      return list;
    }
    case 'list_files':
      return rpc(ctx, 'get_files', {
        p_privy: ctx.privy, p_workspace: ctx.workspace,
        p_object: args?.object || null, p_linked: args?.id || null,
      });
    case 'get_file_text': {
      if (!args?.id) throw new Error('id is required — call list_files or search_files first.');
      const row = await rpc(ctx, 'get_file', { p_privy: ctx.privy, p_file: args.id });
      if (!row) return { error: 'Not found' };
      if (!row.content) {
        return {
          id: row.id, name: row.name, extract_status: row.extract_status,
          content: null,
          note: row.extract_error || 'This file has no extracted text, so its contents cannot be read.',
        };
      }
      return row;
    }

    default:
      throw new Error(`Unknown tool "${name}"`);
  }
}
