// Shared workspace tool executor. ONE implementation used by both the MCP
// server (app/api/mcp) and the in-app agent runner (lib/agents/runner) so an
// agent and an external MCP client act through exactly the same, tenancy-safe
// path. A tool call always runs inside ctx.workspace as ctx.privy.
import { runDispatcher } from '@/lib/automations/dispatcher';

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
] as const;

export const READ_TOOLS = ['list_objects', 'list_records', 'search_records', 'get_record'];
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
export async function callTool(ctx: ToolCtx, name: string, args: any): Promise<any> {
  const object = args?.object as string;
  if (name !== 'list_objects' && !OBJECTS[object]) {
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
    default:
      throw new Error(`Unknown tool "${name}"`);
  }
}
