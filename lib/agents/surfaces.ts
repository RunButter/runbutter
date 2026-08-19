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
  files: { what: 'uploaded files, with their text extracted and searchable', tool: null },
  deals: { what: 'the sales pipeline board', tool: 'create_deal / update_deal / move_deal' },
  companies: { what: 'client and supplier organisations', tool: 'create_record(companies)' },
  people: { what: 'contacts and candidates', tool: 'create_record(people)' },
  products: { what: 'products and services with prices', tool: 'create_record(products)' },
  offers: { what: 'quotes and proposals', tool: 'create_record(offers)' },
  invoices: { what: 'invoices and bills', tool: 'create_record(invoices)' },
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
  forms: { what: 'public forms that collect submissions', tool: null },
  links: { what: 'short links with click tracking', tool: null },
  projects: { what: 'projects', tool: 'create_record(projects)' },
  issues: { what: 'tasks and issues inside a project', tool: 'create_record(issues)' },
  assets: { what: 'company equipment and licences', tool: 'create_record(assets)' },
  candidates: { what: 'job applicants and their assessments', tool: 'create_candidate' },
  positions: { what: 'open roles', tool: null },
  agents: { what: "the workspace's AI agents — you can read them, but creating one stays with a person", tool: null },
  objects: { what: 'the record types themselves — adding a new kind of thing', tool: 'propose_object' },
  skills: { what: 'reusable instruction packs any agent can carry', tool: 'save_skill' },
  design: { what: "the brand spec — exact colours, fonts, spacing, voice and the never-do rules. READ it with get_design before writing copy or choosing a colour; editing it stays with a person", tool: 'get_design (read only)' },
  automations: { what: 'rules that run on a trigger — you can read them, not write them', tool: null },
  'my-team': { what: 'the people who work here', tool: null },
  chat: { what: 'team chat channels', tool: 'post_message' },
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
    // Settings and Account are configuration, not places records live. Listing
    // them invites the copilot to offer changes it has no tools for and that
    // nobody asked an assistant to make.
    if (group.group === 'Settings' || group.group === 'Account') continue;
    const items = (group.items as any[])
      .map((it) => {
        const n = NOTES[it.slug];
        const what = n?.what || it.label.toLowerCase();
        const how = n?.tool ? `write with ${n.tool}` : 'no tool — you can only point them at it';
        return `  ${it.label} (${it.href}) — ${what}; ${how}`;
      });
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
