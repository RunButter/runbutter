// THE tool catalogue — the single source of truth for which tools exist, which
// of them write, and how they are grouped and labelled in the agent builder.
//
// This file has NO imports on purpose. lib/agents/tools.ts (the executor) pulls
// in the Supabase admin client and the dispatcher, so a client component can
// never import it; the builder therefore used to keep its own hand-written copy
// of the tool list in lib/crm/agents.ts. That copy had FOUR read tools while the
// executor had nineteen, and the builder's picker rendered only the copy — so
// get_finance_summary, search_files, search_candidates, screen_sanctions and
// twelve others could not be granted to an agent at all. A "finance agent" could
// not read finance. Both sides now import from here, so the lists cannot drift.

export interface ToolInfo {
  name: string;
  /** Human label for the builder. The raw name is still shown as the tooltip. */
  label: string;
  group: ToolGroup;
  write?: true;
}

export type ToolGroup = 'Records' | 'Finance' | 'Compliance' | 'Files' | 'Marketing' | 'Hiring';

export const TOOL_CATALOG: ToolInfo[] = [
  { name: 'list_objects', label: 'List record types', group: 'Records' },
  { name: 'list_records', label: 'List records', group: 'Records' },
  { name: 'search_records', label: 'Search records', group: 'Records' },
  { name: 'get_record', label: 'Read one record', group: 'Records' },
  { name: 'create_record', label: 'Create a record', group: 'Records', write: true },
  { name: 'update_record', label: 'Update a record', group: 'Records', write: true },

  { name: 'get_finance_summary', label: 'Money in / out', group: 'Finance' },
  { name: 'get_finance_trends', label: 'Monthly trends', group: 'Finance' },
  { name: 'get_ledger', label: 'Bank ledger', group: 'Finance' },
  { name: 'validate_iban', label: 'Validate an IBAN', group: 'Finance' },
  { name: 'parse_invoice_text', label: 'Parse invoice text', group: 'Finance' },

  { name: 'screen_sanctions', label: 'Screen against sanctions', group: 'Compliance' },
  { name: 'get_sanctions_status', label: 'Sanctions list status', group: 'Compliance' },

  { name: 'search_files', label: 'Search file contents', group: 'Files' },
  { name: 'list_files', label: 'List files', group: 'Files' },
  { name: 'get_file_text', label: 'Read a file', group: 'Files' },

  { name: 'list_sites', label: 'List websites', group: 'Marketing' },
  { name: 'get_site_stats', label: 'Website analytics', group: 'Marketing' },

  { name: 'list_positions', label: 'Open positions', group: 'Hiring' },
  { name: 'search_candidates', label: 'Search candidates', group: 'Hiring' },
  { name: 'get_candidate', label: 'Read a candidate', group: 'Hiring' },
  { name: 'get_hiring_pipeline', label: 'Pipeline board', group: 'Hiring' },
];

export const TOOL_GROUPS: ToolGroup[] = ['Records', 'Finance', 'Compliance', 'Files', 'Marketing', 'Hiring'];

/**
 * Read tools. screen_sanctions is here despite appending to its own audit trail:
 * it mutates no business data, and gating it behind write-approval would stop an
 * agent from running a compliance check at all.
 */
export const READ_TOOLS = TOOL_CATALOG.filter((t) => !t.write).map((t) => t.name);
export const WRITE_TOOLS = TOOL_CATALOG.filter((t) => t.write).map((t) => t.name);

export const isWriteTool = (name: string) => WRITE_TOOLS.includes(name);
export const toolLabel = (name: string) => TOOL_CATALOG.find((t) => t.name === name)?.label ?? name;

/** The safe default for a brand-new agent: it can look, not touch. */
export const DEFAULT_TOOLS = ['list_objects', 'list_records', 'search_records', 'get_record'];

export const AGENT_OBJECTS = [
  'companies', 'people', 'invoices', 'offers', 'expenses', 'transactions',
  'products', 'campaigns', 'projects', 'issues', 'assets',
];
