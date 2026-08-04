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
import { runDispatcher, signWebhook } from '@/lib/automations/dispatcher';
import { validateIban } from '@/lib/finance/iban';
import { parseReceiptText, suggestCategory } from '@/lib/finance/receipt-parse';
import { isSafeOutboundUrl } from '@/lib/security/http';

/**
 * `agentId`, `agentName` and `runId` are OPTIONAL because /api/mcp has none of
 * them — an external MCP client is a person's tooling, not an agent. A note
 * written through that path is simply attributed to no agent, which is the
 * honest answer; making them required would either block MCP from writing notes
 * or invite a fake agent id.
 */
export interface ToolCtx {
  admin: any; workspace: string; privy: string;
  agentId?: string | null; agentName?: string; runId?: string | null;
}

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

  // The agent's own memory. This is what separates research from a chat window:
  // a finding written onto the record survives the run, and the next agent —
  // or person — reads it. `source` is REQUIRED and there is no confidence
  // field, on purpose: a checkable provenance beats a number that only looks
  // like measurement.
  { name: 'get_record_notes', description: 'Research notes already recorded on one record, newest first. Read this BEFORE researching so you do not repeat work someone (or you) already did.', inputSchema: { type: 'object', properties: { object: { type: 'string', description: 'Record type, e.g. companies.' }, id: { type: 'string', description: 'Record id.' } }, required: ['object', 'id'] } },
  { name: 'add_record_note', description: 'Record ONE observed fact on a record, so it is there next time. State only what you actually observed — never a guess, an inference presented as fact, or a confidence score. `source` is required and must be checkable: a URL, a file name, or the tool you used (e.g. "search_files"). If you cannot say where it came from, do not record it.', inputSchema: { type: 'object', properties: { object: { type: 'string', description: 'Record type, e.g. companies.' }, id: { type: 'string', description: 'Record id.' }, body: { type: 'string', description: 'One fact, in a sentence. Not a summary of the whole run.' }, source: { type: 'string', description: 'Where it came from — a URL, a file name, or the tool used. Required.' }, source_url: { type: 'string', description: 'The URL, when there is one.' }, kind: { type: 'string', enum: ['observation', 'action'], description: 'observation = something you found out; action = something you did.' }, observed_at: { type: 'string', description: 'ISO date the fact was true, if it differs from today.' } }, required: ['object', 'id', 'body', 'source'] } },

  { name: 'list_connections', description: 'Outgoing connections this workspace has set up (Slack, Discord, Zapier, Make, n8n or a generic webhook). Returns their ids and labels so you can send to one — the destination URLs are not exposed.', inputSchema: { type: 'object', properties: {} } },
  { name: 'call_connection', description: 'Send a message and optional structured data to one of this workspace\'s saved connections. Use it to post to Slack/Discord or to hand data to Zapier/Make/n8n. Call list_connections first to get an id. You cannot specify a URL — only a saved connection.', inputSchema: { type: 'object', properties: { connection_id: { type: 'string', description: 'id from list_connections.' }, message: { type: 'string', description: 'Human-readable text. This is what shows up in a Slack or Discord channel.' }, data: { type: 'object', description: 'Optional structured payload for automation tools.' } }, required: ['connection_id', 'message'] } },
] as const;

// Re-exported from the catalogue rather than restated here. The builder cannot
// import this module (it pulls in the admin client), so it used to keep its own
// copy of these lists — and that copy silently fell sixteen tools behind. One
// list, imported by both sides, is the only way that stays fixed.
export { READ_TOOLS, WRITE_TOOLS, isWriteTool } from '@/lib/agents/catalog';
import { READ_TOOLS as _READ, WRITE_TOOLS as _WRITE } from '@/lib/agents/catalog';

// Fails loudly at import time if a tool is added to TOOLS without a catalogue
// entry — otherwise it would exist in the executor and be ungrantable in the UI,
// which is exactly the drift this file just came out of.
{
  const known = new Set([..._READ, ..._WRITE]);
  const orphans = TOOLS.map((t) => t.name).filter((n) => !known.has(n));
  if (orphans.length) throw new Error(`Tools missing from lib/agents/catalog.ts: ${orphans.join(', ')}`);
}

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

    // ── Research notes (0084) ───────────────────────────────────────────────
    case 'get_record_notes': {
      const { data, error } = await ctx.admin.rpc('get_record_notes', {
        p_privy: ctx.privy, p_object: String(args?.object || ''), p_record: String(args?.id || ''), p_limit: 50,
      });
      if (error) throw new Error(error.message);
      const rows = (data as any[]) || [];
      // An empty result is stated rather than returned as a bare [], so a model
      // cannot read "no notes" as "nothing is known about this record".
      if (!rows.length) return { notes: [], note: 'No research notes on this record yet.' };
      return { notes: rows };
    }

    case 'add_record_note': {
      const source = String(args?.source || '').trim();
      const body = String(args?.body || '').trim();
      // Checked here as well as in SQL so the model gets a sentence it can act
      // on instead of a Postgres exception it will try to work around.
      if (!source) throw new Error('source is required — say where this came from (a URL, a file name, or the tool you used).');
      if (!body) throw new Error('body is required — state the one fact you observed.');
      const { data, error } = await ctx.admin.rpc('add_record_note', {
        p_privy: ctx.privy, p_workspace: ctx.workspace,
        p_object: String(args?.object || ''), p_record: String(args?.id || ''),
        p_body: body, p_source: source,
        p_kind: args?.kind === 'action' ? 'action' : 'observation',
        p_source_url: args?.source_url ? String(args.source_url) : null,
        p_observed_at: args?.observed_at ? String(args.observed_at) : null,
        p_agent: ctx.agentId ?? null, p_agent_name: ctx.agentName ?? '', p_run: ctx.runId ?? null,
      });
      if (error) throw new Error(error.message);
      return { id: data, recorded: true };
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

    // ── Outbound ──────────────────────────────────────────────────────────────
    case 'list_connections': {
      const rows = await rpc(ctx, 'get_connections', { p_privy: ctx.privy, p_workspace: ctx.workspace });
      const list = Array.isArray(rows) ? rows : [];
      // url and secret are deliberately dropped. The model has no use for the
      // destination — it sends by id — and putting a webhook URL (or its signing
      // secret) into a transcript that gets stored on the run is a leak for no
      // gain. The SAME reasoning is why call_connection takes no url argument.
      return list
        .filter((c: any) => c.is_active)
        .map((c: any) => ({ id: c.id, label: c.label, kind: c.kind }));
    }

    case 'call_connection': {
      const id = String(args?.connection_id || '');
      const message = String(args?.message || '').slice(0, 4000);
      if (!id) throw new Error('connection_id is required — call list_connections first.');
      if (!message.trim()) throw new Error('message is required.');

      // Resolved server-side, scoped to this workspace. An id belonging to
      // another tenant returns nothing rather than another tenant's URL.
      const conn = await rpc(ctx, 'get_connection', { p_workspace: ctx.workspace, p_id: id });
      if (!conn) return { error: 'No such connection in this workspace. Call list_connections.' };
      if (conn.is_active === false) return { error: `Connection "${conn.label}" is disabled.` };

      // Same SSRF guard the automation dispatcher uses. A saved connection is
      // owner-supplied, but "owner-supplied" is not "safe" — a URL pointing at
      // 169.254.169.254 or localhost would turn any agent into a probe of our
      // own network.
      if (!isSafeOutboundUrl(conn.url)) {
        await ctx.admin.rpc('log_webhook_delivery', {
          p_workspace: ctx.workspace, p_connection: id, p_automation: null, p_url: conn.url,
          p_status: 'failed', p_code: null, p_attempts: 1, p_detail: 'Agent: blocked, private/unsafe URL (SSRF guard)',
        });
        return { error: 'That connection points at a private or unsafe address and was blocked.' };
      }

      const body = JSON.stringify({
        source: 'runbutter-agent',
        // Slack and Discord both render `text`; Zapier/Make/n8n just see fields.
        text: message,
        message,
        data: args?.data ?? null,
        sent_at: new Date().toISOString(),
      });
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (conn.secret) headers['X-RunButter-Signature'] = signWebhook(conn.secret, body);

      let code = 0, ok = false, detail = '';
      try {
        const r = await fetch(conn.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
        code = r.status; ok = r.ok;
        detail = `Agent POST ${r.status} · ${conn.label || conn.kind}`;
      } catch (e: any) {
        detail = `Agent POST failed · ${e?.message || 'network'}`;
      }

      // Logged to the same delivery trail as automation webhooks, so an agent
      // send is auditable next to every other thing that left the workspace.
      await ctx.admin.rpc('log_webhook_delivery', {
        p_workspace: ctx.workspace, p_connection: id, p_automation: null, p_url: conn.url,
        p_status: ok ? 'ok' : 'failed', p_code: code || null, p_attempts: 1, p_detail: detail,
      });

      return ok
        ? { sent: true, connection: conn.label || conn.kind, response_code: code }
        : { sent: false, connection: conn.label || conn.kind, response_code: code || null, error: detail };
    }

    default:
      throw new Error(`Unknown tool "${name}"`);
  }
}
