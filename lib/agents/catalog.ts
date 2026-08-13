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
  /**
   * Proposed for a human ALWAYS — even for an agent set to `auto`.
   *
   * `write` means "a human approves this unless the workspace said otherwise".
   * This means "a human approves this, and the workspace does not get a say".
   * It exists for exactly one class of action: changing the SHAPE of the
   * workspace rather than its contents. A wrong record is one row to fix; a
   * wrong object is a table in the nav, a page, an agent tool target and a CSV
   * feed row, created from a sentence somebody typed. The AI workspace builder
   * has always returned a plan a person applies for this reason — an agent
   * reaching the same functions must not be the way round it.
   */
  alwaysPropose?: true;
}

export type ToolGroup = 'Records' | 'Docs' | 'Sales' | 'Team' | 'Workspace' | 'Research' | 'Finance' | 'Compliance' | 'Files' | 'Marketing' | 'Hiring' | 'Connections';

export const TOOL_CATALOG: ToolInfo[] = [
  { name: 'list_objects', label: 'List record types', group: 'Records' },
  { name: 'list_records', label: 'List records', group: 'Records' },
  { name: 'search_records', label: 'Search records', group: 'Records' },
  { name: 'get_record', label: 'Read one record', group: 'Records' },
  { name: 'create_record', label: 'Create a record', group: 'Records', write: true },
  { name: 'update_record', label: 'Update a record', group: 'Records', write: true },

  // The rest of the product, so the copilot can do what a person can.
  { name: 'create_deal', label: 'Add a deal', group: 'Sales', write: true },
  { name: 'update_deal', label: 'Change a deal', group: 'Sales', write: true },
  { name: 'move_deal', label: 'Move a deal between stages', group: 'Sales', write: true },
  { name: 'save_post', label: 'Draft a social post', group: 'Marketing', write: true },
  { name: 'add_subscriber', label: 'Add a subscriber', group: 'Marketing', write: true },
  { name: 'list_channels', label: 'List chat channels', group: 'Team' },
  { name: 'post_message', label: 'Post to a channel', group: 'Team', write: true },
  { name: 'list_automations', label: 'List automations', group: 'Workspace' },
  { name: 'create_candidate', label: 'Add a candidate', group: 'Hiring', write: true },

  // Agents and skills (0043/0068). Skills are writable, agents are not — an
  // agent is an actor with permissions, a skill is only instructions.
  { name: 'list_agents', label: 'List agents', group: 'Workspace' },
  { name: 'list_skills', label: 'List skills', group: 'Workspace' },
  { name: 'save_skill', label: 'Write a skill', group: 'Workspace', write: true },

  // Newsletters (0070/0071). `save_newsletter` never sends and never attaches a
  // list — a draft with an audience on it is one click from everyone's inbox.
  { name: 'list_newsletters', label: 'List newsletters', group: 'Marketing' },
  { name: 'save_newsletter', label: 'Draft a newsletter', group: 'Marketing', write: true },

  // Docs (0081/0085/0086). A to-do list, a note and a table are all documents
  // with markdown in one body column, so four tools cover the whole surface.
  { name: 'list_docs', label: 'List documents', group: 'Docs' },
  { name: 'get_doc', label: 'Read a document', group: 'Docs' },
  { name: 'save_doc', label: 'Write a document', group: 'Docs', write: true },
  { name: 'toggle_doc_item', label: 'Tick a to-do item', group: 'Docs', write: true },

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

  // The agent's own memory. Classified WRITE because a note IS a lasting change
  // to a record — a suggest-mode agent proposes it and a person approves, which
  // is the right gate for something that will later be read as fact.
  { name: 'get_record_notes', label: 'Read research notes', group: 'Research' },
  { name: 'add_record_note', label: 'Record a finding', group: 'Research', write: true },

  // The only tools that reach OUTSIDE the workspace. The agent picks a saved
  // connection by id; it never supplies a URL, so what it can reach is bounded
  // by what a workspace owner already set up in Settings → Integrations.
  // Shape, not contents. See alwaysPropose.
  { name: 'propose_object', label: 'Propose a new object', group: 'Workspace', write: true, alwaysPropose: true },

  { name: 'list_connections', label: 'List connections', group: 'Connections' },
  { name: 'call_connection', label: 'Send to a connection', group: 'Connections', write: true },
];

export const TOOL_GROUPS: ToolGroup[] = ['Records', 'Workspace', 'Research', 'Finance', 'Compliance', 'Files', 'Marketing', 'Hiring', 'Connections'];

/**
 * Read tools. screen_sanctions is here despite appending to its own audit trail:
 * it mutates no business data, and gating it behind write-approval would stop an
 * agent from running a compliance check at all.
 */
export const READ_TOOLS = TOOL_CATALOG.filter((t) => !t.write).map((t) => t.name);
export const WRITE_TOOLS = TOOL_CATALOG.filter((t) => t.write).map((t) => t.name);

export const isWriteTool = (name: string) => WRITE_TOOLS.includes(name);

/** Tools an `auto` agent still may not execute on its own. */
export const ALWAYS_PROPOSE_TOOLS = TOOL_CATALOG.filter((t) => t.alwaysPropose).map((t) => t.name);
export const isAlwaysProposed = (name: string) => ALWAYS_PROPOSE_TOOLS.includes(name);
export const toolLabel = (name: string) => TOOL_CATALOG.find((t) => t.name === name)?.label ?? name;

/** The safe default for a brand-new agent: it can look, not touch. */
export const DEFAULT_TOOLS = ['list_objects', 'list_records', 'search_records', 'get_record'];

export const AGENT_OBJECTS = [
  'companies', 'people', 'invoices', 'offers', 'expenses', 'transactions',
  'products', 'campaigns', 'projects', 'issues', 'assets',
];
