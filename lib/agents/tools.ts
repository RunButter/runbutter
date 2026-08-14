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
// run.ts imports nothing but its own types, so it is safe in a server module.
import { runSpec } from '@/lib/insights/run';
import { validateIban } from '@/lib/finance/iban';
import { parseReceiptText, suggestCategory } from '@/lib/finance/receipt-parse';
import { isSafeOutboundUrl } from '@/lib/security/http';
// blueprint.ts has ZERO imports on purpose (it is read by a route handler that
// must not pull in the browser Supabase client), which is exactly what makes it
// safe to import HERE too — the agent tool and the AI builder then validate a
// proposed object against one vocabulary instead of two that drift.
import { normalizeBlueprint, FIELD_TYPES, OBJECT_ICON_NAMES, type BlueprintObject } from '@/lib/workspace/blueprint';

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

/**
 * Doc kinds, inlined rather than imported from `lib/crm/docs.ts`.
 *
 * That file is `use client` and pulls in the browser Supabase client, and this
 * one is imported by a route handler — the same import direction that breaks
 * the build at page-data collection and reports itself as "join is on the
 * client". `docs_kind_check` in SQL is the real constraint; this only decides
 * whether to pass a kind or pass null.
 */
const DOC_KINDS = ['doc', 'note', 'todo', 'sheet'];

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

/**
 * The `object` argument, described rather than enumerated.
 *
 * IT USED TO BE `enum: Object.keys(OBJECTS)` — a hardcoded list of the eleven
 * built-ins. `list_objects` has returned custom objects since 0087, so the
 * model was told the workspace has Vehicles and then handed a schema saying
 * `object` must be one of eleven names that did not include it. A model that
 * respects its own tool schema therefore could not touch a single custom
 * object, which is the exact opposite of the promise that a custom object is
 * first-class everywhere the five CRUD functions reach.
 *
 * A static enum cannot be right here: the valid set is per workspace and is not
 * known at build time. The constraint is enforced where it IS knowable — SQL
 * raises UNKNOWN_OBJECT for anything it does not recognise — so an enum here
 * bought nothing and cost every custom object.
 */
const OBJECT_ARG = "The record type. Call list_objects first — the set is per workspace and includes this workspace's own custom objects, so it cannot be listed here.";

// JSON-schema tool defs (shared by MCP tools/list and the agent tool-calling loop).
export const TOOLS = [
  { name: 'list_objects', description: 'List the record types available in this RunButter workspace and their fields.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_records', description: 'List records of an object type (most recent first).', inputSchema: { type: 'object', properties: { object: { type: 'string', description: OBJECT_ARG } }, required: ['object'] } },
  { name: 'search_records', description: 'Search records of an object type by a text query (matched across all fields).', inputSchema: { type: 'object', properties: { object: { type: 'string', description: OBJECT_ARG }, query: { type: 'string' } }, required: ['object', 'query'] } },
  { name: 'chart_records', description: 'Answer a question as a CHART rather than prose. Counts or sums records of an object, grouped by one of its columns. Prefer this whenever the answer is a comparison, a total by category, or a trend — a chart is read at a glance and can be published as a link, which a paragraph of numbers cannot. Returns the finished buckets.', inputSchema: { type: 'object', properties: { object: { type: 'string', description: OBJECT_ARG }, group_by: { type: 'string', description: 'Column to group by, e.g. status or category. Omit for a single total.' }, aggregate: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'], description: 'Default count.' }, aggregate_field: { type: 'string', description: 'Numeric column to sum/average. Required unless aggregate is count.' }, chart: { type: 'string', enum: ['bar', 'line', 'pie', 'number'], description: 'Default bar, or number when not grouping.' }, title: { type: 'string' } }, required: ['object'] } },
  { name: 'get_record', description: 'Fetch one record by id.', inputSchema: { type: 'object', properties: { object: { type: 'string', description: OBJECT_ARG }, id: { type: 'string' } }, required: ['object', 'id'] } },
  { name: 'create_record', description: 'Create a record. `data` uses the object\'s fields (see list_objects).', inputSchema: { type: 'object', properties: { object: { type: 'string', description: OBJECT_ARG }, data: { type: 'object' } }, required: ['object', 'data'] } },
  { name: 'update_record', description: 'Update fields on an existing record.', inputSchema: { type: 'object', properties: { object: { type: 'string', description: OBJECT_ARG }, id: { type: 'string' }, data: { type: 'object' } }, required: ['object', 'id', 'data'] } },





  // ── Everything else a person can do ───────────────────────────────────────
  // The agentic gap, closed. Each of these screens had working RPCs and no way
  // for an agent to reach them, so the copilot could describe the Deals board
  // and not put a deal on it. A tool per real action rather than one generic
  // escape hatch: the argument names are the documentation, and a model made to
  // guess a payload shape guesses wrong in ways SQL cannot catch.
  { name: 'create_deal', description: 'Add a deal to the sales pipeline. Omit `stage` and it goes to the first column.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, amount: { type: 'number' }, stage: { type: 'string', description: 'Stage id from get_pipeline_board.' }, companyId: { type: 'string' }, personId: { type: 'string' } }, required: ['title'] } },
  { name: 'update_deal', description: "Change a deal's title, amount, company or person. To move it between stages use move_deal.", inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, amount: { type: 'number' }, companyId: { type: 'string' }, personId: { type: 'string' } }, required: ['id'] } },
  { name: 'move_deal', description: 'Move a deal to another stage of its pipeline (e.g. mark it won).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, stage: { type: 'string' }, position: { type: 'number' } }, required: ['id', 'stage'] } },
  { name: 'save_post', description: 'Create or update a social post DRAFT for the content calendar. Never publishes — a person sends it from Marketing -> Posts.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, body: { type: 'string' }, status: { type: 'string', enum: ['idea', 'draft', 'scheduled'] }, scheduledFor: { type: 'string' } }, required: ['body'] } },
  { name: 'add_subscriber', description: 'Add or update a newsletter subscriber. Never re-enables someone who unsubscribed.', inputSchema: { type: 'object', properties: { email: { type: 'string' }, name: { type: 'string' }, listId: { type: 'string' } }, required: ['email'] } },
  { name: 'list_channels', description: 'List the team chat channels you may post to.', inputSchema: { type: 'object', properties: {} } },
  { name: 'post_message', description: 'Post a message to a team chat channel, as the person who asked you to.', inputSchema: { type: 'object', properties: { channelId: { type: 'string' }, body: { type: 'string' } }, required: ['channelId', 'body'] } },
  { name: 'list_automations', description: "List this workspace's automations — trigger, actions and whether each is enabled.", inputSchema: { type: 'object', properties: {} } },
  { name: 'create_candidate', description: 'Add a candidate to the hiring pipeline.', inputSchema: { type: 'object', properties: { fullName: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, linkedin: { type: 'string' }, positionId: { type: 'string' } }, required: ['fullName', 'email'] } },

  // ── Agents and skills (0043 / 0068) ───────────────────────────────────────
  // Reading both, and writing SKILLS but not AGENTS. A skill is instructions —
  // `suggested_tools` on it is a hint the builder uses to pre-tick boxes and is
  // never a grant, so the worst a bad one does is give an agent poor advice. An
  // AGENT is an actor: it carries a tool list, an autonomy setting and possibly
  // a schedule, so a copilot that could create one could create something that
  // runs unattended with permissions nobody chose. That is the same line
  // `propose_object` draws — changing what the workspace IS stays with a person.
  { name: 'list_agents', description: 'List this workspace\'s AI agents — name, role, autonomy, schedule and which tools each may use.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_skills', description: 'List the reusable instruction packs (skills) in this workspace.', inputSchema: { type: 'object', properties: {} } },
  { name: 'save_skill', description: 'Create or update a skill: a named, reusable instruction pack that agents can be given. Write `instructions` as markdown describing how this company does the thing. Omit `id` to create.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, instructions: { type: 'string' } }, required: ['name', 'instructions'] } },

  // ── Newsletters (0070/0071, designs 0098) ─────────────────────────────────
  // The surface that made the gap obvious: asked for "a nice newsletter in
  // HTML" the copilot wrote a DOCUMENT full of HTML, because a document was the
  // nearest thing it could write. It is not asked to author email HTML — email
  // HTML is tables and inline styles and Outlook, and a model writing it by
  // hand produces something that breaks in half the clients. It fills a
  // TEMPLATE instead, and the renderer does the part that has to be right.
  { name: 'list_newsletters', description: 'List this workspace\'s newsletters (subject, status, template) and the subscriber lists available to send to.', inputSchema: { type: 'object', properties: {} } },
  { name: 'save_newsletter', description: "Create or update a newsletter DRAFT. Never sends — a person sends it from Marketing → Newsletters. Choose `template`: 'plain' is a letter (heading, body, one button) and has the best deliverability; 'announcement' adds a hero image; 'digest' is a run of linked items. Write `body` as plain text with a blank line between paragraphs — not HTML, the template renders it and applies the workspace's branding.", inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Omit to create a new draft.' }, subject: { type: 'string' }, preheader: { type: 'string', description: 'The grey line shown after the subject in the inbox.' }, template: { type: 'string', enum: ['plain', 'announcement', 'digest'] }, heading: { type: 'string' }, body: { type: 'string' }, ctaLabel: { type: 'string' }, ctaUrl: { type: 'string' }, items: { type: 'array', description: 'digest only', items: { type: 'object', properties: { title: { type: 'string' }, blurb: { type: 'string' }, url: { type: 'string' } } } } }, required: ['subject', 'template'] } },

  // ── Docs, notes and to-do lists (0081/0085/0086) ───────────────────────────
  // MISSING UNTIL NOW, and the gap was invisible from the inside: docs are a
  // dedicated subsystem with their own RPCs rather than a CRUD object, so
  // `list_objects` correctly reported no "documents" type and the copilot
  // correctly told the user there wasn't one — while the Docs screen sat there
  // full of documents. Asked to "make a to-do list", the only writable thing it
  // could see was `issues`, so that is what it made. The model was right and
  // its hands were tied.
  { name: 'list_docs', description: 'List documents, notes, to-do lists and tables in this workspace (title, kind and tags; not the body).', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_doc', description: 'Read one document in full, including its markdown body.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'save_doc', description: "Create or update a document. `kind` is doc | note | todo | sheet — every kind stores markdown in the same body, so a to-do list is lines of '- [ ] item' and a table is a markdown table. Omit `id` to create. Omitting `kind` on an update leaves the kind alone.", inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, kind: { type: 'string', enum: ['doc', 'note', 'todo', 'sheet'] }, tags: { type: 'array', items: { type: 'string' } } }, required: ['title'] } },
  { name: 'toggle_doc_item', description: 'Tick or untick one checklist item in a to-do document, by its zero-based index among the checkboxes.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, index: { type: 'number' }, done: { type: 'boolean' } }, required: ['id', 'index', 'done'] } },

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

  { name: 'propose_object', description: 'Propose a NEW record type (object) for this workspace when the user tracks something none of the existing objects covers. Never creates anything: it returns a plan a person approves. Do not use it for something a built-in already handles — link to one with a relation field instead.', inputSchema: { type: 'object', properties: {
    singular: { type: 'string', description: 'One record, e.g. "Vehicle"' },
    plural: { type: 'string', description: 'Many, e.g. "Vehicles"' },
    group: { type: 'string', description: 'Nav section, e.g. "Fleet"' },
    icon: { type: 'string', enum: [...OBJECT_ICON_NAMES] },
    description: { type: 'string' },
    fields: { type: 'array', items: { type: 'object', properties: {
      label: { type: 'string' },
      key: { type: 'string' },
      type: { type: 'string', enum: [...FIELD_TYPES] },
      options: { type: 'array', items: { type: 'string' }, description: 'For type "select" only.' },
      relation_to: { type: 'string', description: 'For type "relation": the slug it points at, e.g. "companies".' },
      required: { type: 'boolean' },
      primary: { type: 'boolean', description: 'Exactly one field is the name the record is called by.' },
    }, required: ['label', 'type'] } },
  }, required: ['singular', 'fields'] } },
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
    case 'create_deal': {
      // The pipeline is resolved here rather than asked of the model: there is
      // one sales pipeline per workspace, so making the model name it is a
      // round trip whose only answers are "right" and "an id SQL refuses".
      const { data: pipe } = await ctx.admin.rpc('get_pipeline_by_kind', {
        p_privy: ctx.privy, p_workspace: ctx.workspace, p_kind: 'sales',
      });
      const pipelineId = (pipe as any)?.id;
      if (!pipelineId) return { error: 'This workspace has no sales pipeline yet. Open Sales > Deals once to create it.' };
      const { data, error } = await ctx.admin.rpc('create_pipeline_record', {
        p_privy: ctx.privy, p_workspace: ctx.workspace, p_pipeline: pipelineId,
        p_stage: args?.stage || null,
        p_title: String(args?.title || '').slice(0, 300),
        p_amount: typeof args?.amount === 'number' ? args.amount : null,
        p_company: args?.companyId || null, p_person: args?.personId || null,
      });
      if (error) throw new Error(error.message);
      return { id: data, created: true };
    }

    case 'update_deal': {
      const { error } = await ctx.admin.rpc('update_pipeline_record', {
        p_privy: ctx.privy, p_record: String(args?.id || ''),
        // NULL means "leave it alone" — the same reading update_record gives an
        // absent key (0088). Sending '' would blank the title of a deal the
        // model only meant to reprice.
        p_title: args?.title ?? null,
        p_amount: typeof args?.amount === 'number' ? args.amount : null,
        p_company: args?.companyId ?? null, p_person: args?.personId ?? null,
      });
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    case 'move_deal': {
      const { error } = await ctx.admin.rpc('move_pipeline_record', {
        p_privy: ctx.privy, p_record: String(args?.id || ''),
        p_stage: String(args?.stage || ''),
        p_position: typeof args?.position === 'number' ? args.position : 0,
      });
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    case 'save_post': {
      const status = ['idea', 'draft', 'scheduled'].includes(args?.status) ? args.status : 'draft';
      const { data, error } = await ctx.admin.rpc('save_post', {
        p_privy: ctx.privy, p_workspace: ctx.workspace, p_id: args?.id || null,
        p_data: { body: String(args?.body || '').slice(0, 5000), status, scheduled_for: args?.scheduledFor || null },
      });
      if (error) throw new Error(error.message);
      return { id: data, saved: true, status, note: 'Saved to the content calendar. Nothing has been published.' };
    }

    case 'add_subscriber': {
      const { data, error } = await ctx.admin.rpc('upsert_newsletter_subscriber', {
        p_privy: ctx.privy, p_workspace: ctx.workspace,
        p_email: String(args?.email || '').slice(0, 320),
        p_name: String(args?.name || '').slice(0, 200),
        p_list: args?.listId || null,
        // Recorded as the copilot rather than left blank. 0071 will not
        // re-enable an unsubscribed address whatever this says, and an address
        // that appeared with no explanation is the one nobody can account for
        // when somebody asks why they were emailed.
        p_source: 'copilot', p_ip: null, p_status: null,
      });
      if (error) throw new Error(error.message);
      return { id: data, saved: true };
    }

    case 'list_channels': {
      const { data, error } = await ctx.admin.rpc('get_channels', { p_privy: ctx.privy, p_workspace: ctx.workspace });
      if (error) throw new Error(error.message);
      return (Array.isArray(data) ? data : []).map((c: any) => ({ id: c.id, name: c.name, is_private: c.is_private }));
    }

    case 'post_message': {
      // `post_message`, not `post_agent_message`. The copilot is acting FOR the
      // person who asked, in their name — a note that arrives from a bot when a
      // colleague asked for it to be sent is a different message. Either way
      // `can_read_channel` decides membership in SQL, so a private channel is
      // not reachable by asking nicely.
      const { data, error } = await ctx.admin.rpc('post_message', {
        p_privy: ctx.privy, p_channel: String(args?.channelId || ''),
        p_body: String(args?.body || '').slice(0, 8000),
        p_author_name: null, p_attachments: [],
      });
      if (error) throw new Error(error.message);
      return { id: data, posted: true };
    }

    case 'list_automations': {
      const { data, error } = await ctx.admin.rpc('get_automations', { p_privy: ctx.privy, p_workspace: ctx.workspace });
      if (error) throw new Error(error.message);
      return (Array.isArray(data) ? data : []).map((a: any) => ({
        id: a.id, name: a.name, enabled: a.enabled, trigger: a.trigger_type, actions: (a.actions || []).length,
      }));
    }

    case 'create_candidate': {
      const { data, error } = await ctx.admin.rpc('hr_create_candidate', {
        p_privy: ctx.privy,
        p_full_name: String(args?.fullName || '').slice(0, 200),
        p_email: String(args?.email || '').slice(0, 320),
        p_phone: String(args?.phone || '').slice(0, 60),
        p_linkedin: String(args?.linkedin || '').slice(0, 300),
        p_position_id: args?.positionId || null,
      });
      if (error) throw new Error(error.message);
      return { id: data, created: true };
    }

    case 'list_agents': {
      const { data, error } = await ctx.admin.rpc('get_agents', { p_privy: ctx.privy, p_workspace: ctx.workspace });
      if (error) throw new Error(error.message);
      return (Array.isArray(data) ? data : []).map((a: any) => ({
        id: a.id, name: a.name, role: a.role, autonomy: a.autonomy, enabled: a.enabled,
        schedule: a.schedule, tools: a.allowed_tools,
      }));
    }

    case 'list_skills': {
      const { data, error } = await ctx.admin.rpc('get_skills', { p_privy: ctx.privy, p_workspace: ctx.workspace });
      if (error) throw new Error(error.message);
      // Instructions are the long part and are usually a page each; the id and
      // the description are what a model needs to decide which one to open.
      return (Array.isArray(data) ? data : []).map((s: any) => ({
        id: s.id, name: s.name, description: s.description, source: s.source,
      }));
    }

    case 'save_skill': {
      const { data, error } = await ctx.admin.rpc('save_skill', {
        p_privy: ctx.privy, p_workspace: ctx.workspace,
        p_id: args?.id || null,
        p_name: String(args?.name || '').slice(0, 120),
        p_description: String(args?.description || '').slice(0, 500),
        p_instructions: String(args?.instructions || '').slice(0, 40000),
        p_suggested_tools: [],
        // Attributed to the copilot rather than left blank. `source` is how
        // anyone later tells a skill somebody wrote from one a model produced,
        // and the same reasoning as record_notes.source: a claim you cannot
        // trace is a claim you cannot check.
        p_source: 'copilot', p_source_url: null,
      });
      if (error) throw new Error(error.message);
      return { id: data, saved: true };
    }

    case 'list_newsletters': {
      const [nl, lists] = await Promise.all([
        ctx.admin.rpc('get_newsletters', { p_privy: ctx.privy, p_workspace: ctx.workspace }),
        ctx.admin.rpc('get_newsletter_lists', { p_privy: ctx.privy, p_workspace: ctx.workspace }),
      ]);
      if (nl.error) throw new Error(nl.error.message);
      return {
        newsletters: (Array.isArray(nl.data) ? nl.data : []).map((n: any) => ({
          id: n.id, subject: n.subject, status: n.status, template: n.template, sent_at: n.sent_at,
        })),
        lists: (Array.isArray(lists.data) ? lists.data : []).map((l: any) => ({ id: l.id, name: l.name, subscribers: l.subscriber_count })),
      };
    }

    case 'save_newsletter': {
      const template = ['plain', 'announcement', 'digest'].includes(args?.template) ? args.template : 'plain';
      // Only the fields that template actually renders. A digest's `items` on a
      // plain letter is dead weight in the row and reappears as a surprise if
      // somebody switches the template later in the editor.
      const content: any = {};
      if (args?.heading) content.heading = String(args.heading).slice(0, 300);
      if (args?.body) content.body = String(args.body).slice(0, 20000);
      if (args?.ctaLabel) content.ctaLabel = String(args.ctaLabel).slice(0, 80);
      if (args?.ctaUrl) content.ctaUrl = String(args.ctaUrl).slice(0, 500);
      if (template === 'digest' && Array.isArray(args?.items)) {
        content.items = args.items.slice(0, 25).map((i: any) => ({
          title: String(i?.title || '').slice(0, 200),
          blurb: i?.blurb ? String(i.blurb).slice(0, 500) : undefined,
          url: i?.url ? String(i.url).slice(0, 500) : undefined,
        }));
      }
      const { data, error } = await ctx.admin.rpc('save_newsletter', {
        p_privy: ctx.privy, p_workspace: ctx.workspace,
        p_id: args?.id || null,
        p_subject: String(args?.subject || '').slice(0, 300),
        p_preheader: String(args?.preheader || '').slice(0, 300),
        p_template: template,
        p_content: content,
        p_from_name: null, p_reply_to: null,
        // NO LISTS, EVER, from a tool. Attaching an audience is the step that
        // turns a draft into something one click from every subscriber's inbox,
        // and it is a person's decision made on the send screen.
        p_list_ids: [],
      });
      if (error) throw new Error(error.message);
      return {
        id: data, saved: true, template, status: 'draft',
        note: 'Saved as a DRAFT. Nobody has been emailed. Open Marketing → Newsletters to choose a list and send.',
      };
    }

    case 'list_docs': {
      const { data, error } = await ctx.admin.rpc('get_docs', { p_privy: ctx.privy, p_workspace: ctx.workspace });
      if (error) throw new Error(error.message);
      // The BODY is stripped. A workspace's docs are the longest text it owns,
      // and returning all of them would spend the whole context window on a
      // question that only needed the titles — `get_doc` fetches one in full.
      return (Array.isArray(data) ? data : []).map((d: any) => ({
        id: d.id, title: d.title, kind: d.kind, tags: d.tags, updated_at: d.updated_at,
      }));
    }

    case 'get_doc': {
      const { data, error } = await ctx.admin.rpc('get_doc', { p_privy: ctx.privy, p_id: String(args?.id || '') });
      if (error) throw new Error(error.message);
      return data ?? { error: 'No document with that id in this workspace.' };
    }

    case 'save_doc': {
      const kind = typeof args?.kind === 'string' && DOC_KINDS.includes(args.kind) ? args.kind : null;
      const { data, error } = await ctx.admin.rpc('save_doc', {
        p_privy: ctx.privy, p_workspace: ctx.workspace,
        p_id: args?.id || null,
        p_title: String(args?.title || '').slice(0, 200),
        p_body: String(args?.body ?? ''),
        // NULL means "not saying", which on an update leaves the kind alone.
        // 0081 gave this a 'doc' default and it silently converted tables back
        // into documents; 0085 fixed the SQL and this must not reintroduce it.
        p_kind: kind,
        p_tags: Array.isArray(args?.tags) ? args.tags.slice(0, 20).map(String) : [],
      });
      if (error) throw new Error(error.message);
      return { id: data, saved: true, kind: kind ?? undefined };
    }

    case 'toggle_doc_item': {
      const { error } = await ctx.admin.rpc('toggle_doc_item', {
        p_privy: ctx.privy, p_id: String(args?.id || ''),
        p_index: Number(args?.index) || 0, p_done: !!args?.done,
      });
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    case 'list_objects': {
      const builtIn = Object.entries(OBJECTS).map(([k, v]) => ({ object: k, fields: v }));
      // A workspace's own objects (0087) belong in this list, or an agent would
      // be told the workspace has no Vehicles while list_records('vehicles')
      // happily returns them — worse than not supporting them at all. Read
      // through the same RPC the browser uses, so tenancy is unchanged.
      const { data } = await ctx.admin.rpc('get_custom_objects', {
        p_privy: ctx.privy, p_workspace: ctx.workspace,
      });
      const custom = (Array.isArray(data) ? data : []).filter((o: any) => o.enabled).map((o: any) => ({
        object: o.slug,
        // Same "name (type)" prose as the built-ins, so the model sees one
        // consistent description format and does not have to infer a schema.
        fields: `${o.plural}${o.description ? ` — ${o.description}` : ''} (${
          (o.fields || []).map((f: any) =>
            `${f.key} ${f.type}${f.options?.length ? ` [${f.options.join('|')}]` : ''}${f.required ? ' required' : ''}`
          ).join(', ') || 'no fields yet'})`,
      }));
      return [...builtIn, ...custom];
    }
    case 'list_records':
      return (await listRows(ctx, object)).slice(0, 100);
    case 'search_records': {
      const q = String(args?.query || '').toLowerCase();
      return (await listRows(ctx, object)).filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q))).slice(0, 50);
    }
    /**
     * A chart, computed here rather than described.
     *
     * The rows never reach the model — listRows is the same tenancy-safe read
     * every other tool uses, the arithmetic happens in runSpec, and what comes
     * back is a handful of buckets. So this is cheaper in tokens than dumping
     * a hundred rows into the context AND it cannot be got wrong by a model
     * doing mental arithmetic over them, which is what it was doing before.
     *
     * Validated against the columns actually present in the data rather than a
     * declared schema, so a workspace's own objects work with no registration —
     * and a hallucinated column name is refused rather than silently grouping
     * everything into "No value".
     */
    case 'chart_records': {
      const rows = await listRows(ctx, object);
      const present = new Set<string>();
      for (const r of rows.slice(0, 50)) for (const k of Object.keys(r || {})) present.add(k);

      const groupBy = args?.group_by ? String(args.group_by) : null;
      if (groupBy && !present.has(groupBy)) {
        throw new Error(`No column "${groupBy}" on ${object}. Available: ${[...present].join(', ')}`);
      }
      const fn = ['count', 'sum', 'avg', 'min', 'max'].includes(String(args?.aggregate)) ? String(args.aggregate) : 'count';
      const field = args?.aggregate_field ? String(args.aggregate_field) : null;
      if (fn !== 'count' && (!field || !present.has(field))) {
        throw new Error(`"${fn}" needs a numeric column on ${object}. Available: ${[...present].join(', ')}`);
      }

      const spec = {
        object, filters: [], groupBy,
        metric: { fn, field: fn === 'count' ? null : field },
        chart: ['bar', 'line', 'pie', 'number'].includes(String(args?.chart)) ? String(args.chart) : (groupBy ? 'bar' : 'number'),
        sort: 'value_desc', limit: 12,
        title: String(args?.title || '').slice(0, 120) || object,
      } as any;

      const out = runSpec(spec, rows);
      return {
        title: spec.title,
        chart: spec.chart,
        grouped_by: groupBy,
        measure: fn === 'count' ? 'count' : `${fn} of ${field}`,
        total: out.total,
        buckets: out.buckets,
        matched: out.rows.length,
        truncated: out.truncated,
      };
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


    /**
     * ── Shape, not contents ──────────────────────────────────────────────────
     *
     * The one tool that changes what the workspace IS rather than what is in
     * it. It validates a proposed object against the same normalizer the AI
     * workspace builder uses and returns the cleaned plan — it creates nothing,
     * ever, on any autonomy setting, because the runner classifies it
     * `alwaysPropose`. Applying happens in `executeProposed` after a person has
     * read it.
     *
     * ONE TOOL, NOT create_object + add_field. A half-created object with no
     * fields is worse than none, and approval should be one decision about
     * "Vehicles with six fields", not seven separate ones a person clicks
     * through without reading. It also means the thing shown to the human is
     * exactly the thing that gets applied.
     */
    case 'propose_object': {
      const { blueprint, warnings } = normalizeBlueprint({
        summary: String(args?.description || ''),
        objects: [args || {}],
      });
      const obj = blueprint.objects[0];
      if (!obj) {
        throw new Error(
          `That object could not be used: ${warnings.join('; ') || 'no singular name given'}. ` +
          `Field types are: ${FIELD_TYPES.join(', ')}.`,
        );
      }
      // Reported back to the model so it can fix a dropped field on the next
      // step rather than proposing a plan it thinks is complete and is not.
      return { proposal: obj, warnings, note: 'Not created. This is a proposal for a human to approve.' };
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
