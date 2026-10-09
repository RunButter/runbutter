// The product map the copilot is given (0102).
//
// WHY THIS EXISTS. Asked to "make a nice newsletter in HTML", the copilot wrote
// a DOCUMENT containing HTML for the person to paste somewhere. That is not a
// model failure — it knew the object types and it knew the doc tools, and
// nothing anywhere told it that Newsletters are a place in this product, that
// they live at /marketing/newsletters, or which tool writes one. Given a
// request it could not satisfy exactly, it did the nearest thing it could see.
//
// A model that does not know the shape of the product will always do the
// nearest thing it can see. So it is given the shape.
//
// GENERATED FROM `NAV`, not hand-typed. The labels and paths already exist in
// `lib/crm/registry.ts` and are what the sidebar renders; a second hand-written
// copy is how the map ends up describing a screen that was renamed a year ago.
// What CANNOT be derived — "this is what lives here, and this is the tool that
// writes it" — is the small table below, and that is the only hand-maintained
// part.
//
// It says NO honestly. A surface with no tool is listed with what it is for and
// the fact that the copilot cannot write it, because the failure being fixed is
// precisely the copilot substituting a surface it CAN write for one it cannot.

import { NAV } from '@/lib/crm/registry';

interface SurfaceNote {
  /** What is kept here, in the words someone would use asking for it. */
  what: string;
  /** The tool that writes here, or null when nothing does. */
  tool: string | null;
}

/**
 * Keyed by nav slug. Anything absent still appears in the map with its label
 * and path — a screen nobody has annotated is better described by its own name
 * than left out, because leaving it out is what makes the copilot think it does
 * not exist.
 */
const NOTES: Record<string, SurfaceNote> = {
  docs: { what: 'documents, notes, to-do lists and simple tables', tool: 'save_doc' },
  insights: { what: 'a chart built from a question over any record type', tool: 'chart_records' },
  inbox: { what: 'conversations from the chat widget on the company website', tool: 'list_conversations / get_conversation / reply_conversation' },
  files: { what: 'uploaded files, with their text extracted and searchable', tool: null },
  deals: { what: 'the sales pipeline board', tool: 'create_deal / update_deal / move_deal' },
  companies: { what: 'client and supplier organisations', tool: 'create_record(companies)' },
  people: { what: 'contacts and candidates', tool: 'create_record(people)' },
  products: { what: 'products and services with prices', tool: 'create_record(products)' },
  offers: { what: 'quotes and proposals, with line items', tool: 'save_document(kind: offer)' },
  invoices: { what: 'invoices and bills, with line items', tool: 'save_document(kind: invoice)' },
  expenses: { what: 'expenses', tool: 'create_record(expenses)' },
  transactions: { what: 'the bank ledger', tool: 'create_record(transactions)' },
  finance: { what: 'money in and out, summarised', tool: null },
  'investor-update': {
    what: 'the monthly investor update, drafted from real figures. You CANNOT write it — link to /investor-update',
    tool: null,
  },
  campaigns: { what: 'marketing campaigns', tool: 'create_record(campaigns)' },
  newsletters: { what: 'email newsletters — the subject, the design and the send', tool: 'save_newsletter' },
  posts: { what: 'social posts and the content calendar', tool: 'save_post' },
  forms: { what: 'public forms that collect submissions', tool: 'save_form' },
  links: { what: 'short links with click tracking', tool: 'create_short_link' },
  projects: { what: 'projects', tool: 'create_record(projects)' },
  issues: { what: 'tasks and issues inside a project', tool: 'create_record(issues)' },
  assets: { what: 'company equipment and licences', tool: 'create_record(assets)' },
  candidates: { what: 'job applicants and their assessments', tool: 'create_candidate' },
  positions: { what: 'open roles (publishing puts one on the public careers page)', tool: 'save_position' },
  agents: { what: "the workspace's AI agents. You can propose a new one or a change (a person approves), and hand a task to one with run_agent", tool: 'propose_agent / run_agent' },
  objects: { what: 'the record types themselves — a new kind of thing, or a new field on one', tool: 'propose_object / propose_field' },
  skills: { what: 'reusable instruction packs any agent can carry', tool: 'save_skill' },
  design: { what: "the brand spec — exact colours, fonts, spacing, voice and the never-do rules. READ it with get_design before writing copy or choosing a colour; editing it stays with a person", tool: 'get_design (read only)' },
  automations: { what: 'rules that run on a trigger, unattended once approved', tool: 'propose_automation (a person approves)' },
  'my-team': { what: 'the people who work here', tool: null },
  orders: { what: 'sales orders with line items; stock moves when one is marked paid', tool: 'save_order' },
  'cap-table': { what: 'who owns the company', tool: 'save_cap_holder' },
  interviews: { what: 'scheduled interviews — booking one sends a calendar invite, so it stays a person\'s click', tool: null },
  members: { what: 'who is in the workspace and their roles', tool: 'invite_member / set_member_role (a person approves)' },
  branding: { what: 'logo, colours and the company details on invoices and emails', tool: 'update_workspace (a person approves)' },
  modules: { what: 'which sections show in the sidebar', tool: 'update_workspace (a person approves)' },
  vault: { what: 'shared passwords, encrypted in the browser — the server and you cannot read them, by design', tool: null },
  chat: { what: 'team chat channels', tool: 'post_message' },
};

/** Notes for screens that are now a tab rather than an entry, keyed by path. */
const TAB_SLUG: Record<string, string> = {
  '/investor-update': 'investor-update',
  '/finance/kpis': 'kpis',
  '/finance/forecast': 'forecast',
  '/dashboard/templates': 'templates',
  '/dashboard/sources': 'sources',
  '/dashboard/analytics': 'analytics',
};

/**
 * The map, as a compact block for the system prompt.
 *
 * Grouped the way the sidebar is grouped, because that is the structure the
 * person asking has in their head — "it's under Marketing" is how they will
 * describe it, and the copilot should be able to meet that.
 */
export function surfaceMap(): string {
  const lines: string[] = [];
  for (const group of NAV as any[]) {
    // Settings is configuration, not a place records live. Listing
    // them invites the copilot to offer changes it has no tools for and that
    // nobody asked an assistant to make.
    if (group.group === 'Settings') continue;
    const line = (label: string, href: string, slug: string) => {
      const n = NOTES[slug];
      const what = n?.what || label.toLowerCase();
      const how = n?.tool ? `write with ${n.tool}` : 'no tool — you can only point them at it';
      return `  ${label} (${href}) — ${what}; ${how}`;
    };
    // A tab is a screen of its own (Investors → Investor update), so it gets its
    // own line. Leaving it out is what makes the copilot think it does not exist.
    const items = (group.items as any[]).flatMap((it) => it.tabs?.length
      ? it.tabs.map((t: { label: string; href: string }, i: number) =>
          line(i === 0 ? it.label : `${it.label} → ${t.label}`, t.href, i === 0 ? it.slug : TAB_SLUG[t.href] || ''))
      : [line(it.label, it.href, it.slug)]);
    if (items.length) lines.push(`${group.group}:`, ...items);
  }
  return lines.join('\n');
}

/**
 * The rule that turns the map into behaviour.
 *
 * Written as an instruction rather than left implicit, because the failure it
 * prevents is a HELPFUL one: substituting a surface it can write for the one
 * that was asked for feels like progress to a model, and produces a document
 * full of HTML where a newsletter was wanted.
 */
export const SURFACE_RULE =
  `This is the product you are working inside. Every request lands on one of these surfaces.\n\n` +
  `Pick the surface the person named, and use ITS tool. If they ask for a newsletter, make a ` +
  `newsletter — do not write a document about one. If the right surface has no tool, say so ` +
  `plainly and give them the path, rather than making the nearest thing you can write: a document ` +
  `containing what they asked for is not the thing they asked for, and is worse than an honest no ` +
  `because it looks like success.`;
