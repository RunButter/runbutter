/**
 * Sample data — a small consultancy, mid-quarter.
 *
 * WHY IT EXISTS. `docker compose up` currently lands on an empty workspace,
 * which is the worst possible first impression of a product whose whole pitch
 * is that everything is connected: an empty pipeline next to an empty ledger
 * next to an empty inbox demonstrates nothing. Twenty minutes of clicking is
 * what stands between someone and understanding the product, and nobody spends
 * it before deciding whether to care.
 *
 * WHAT MAKES IT WORTH LOADING RATHER THAN JUST FILLING TABLES: the rows REFER
 * to each other. The invoice to Northwind is for the deal in the pipeline, the
 * expense is the subcontractor on that project, and the overdue invoice is from
 * the client whose deal stalled. That is the only thing a demo can show that a
 * screenshot cannot.
 *
 * DELIBERATELY SMALL. Four companies, not forty. A seeded workspace someone
 * cannot read in one screen is as unhelpful as an empty one, and every row here
 * has to be deletable by hand without it becoming a chore.
 *
 * The dates are RELATIVE, so a workspace seeded today looks like a workspace in
 * use today — a demo full of invoices due in 2024 reads as abandoned software.
 */

const day = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);

export interface DemoRow { object: string; data: Record<string, any>; /** Referenced by later rows. */ ref?: string }

/**
 * Ordered: companies before the people and invoices that point at them.
 * `ref` names a row so a later one can link to it — resolved at insert time,
 * because the ids do not exist until then.
 */
export const DEMO_ROWS: DemoRow[] = [
  // ── Who we work with ──────────────────────────────────────────────────────
  { ref: 'northwind', object: 'companies', data: { name: 'Northwind Freight', domain: 'northwind.example', industry: 'Logistics', employee_count: 120, country: 'PL' } },
  { ref: 'vertex', object: 'companies', data: { name: 'Vertex Robotics', domain: 'vertex.example', industry: 'Manufacturing', employee_count: 40, country: 'DE' } },
  { ref: 'pulse', object: 'companies', data: { name: 'Pulse Health', domain: 'pulsehealth.example', industry: 'Healthcare', employee_count: 15, country: 'PL' } },
  { ref: 'cobalt', object: 'companies', data: { name: 'Cobalt Studio', domain: 'cobalt.example', industry: 'Design', employee_count: 8, country: 'NL' } },

  { object: 'people', data: { first_name: 'Anna', last_name: 'Kowalska', email: 'anna@northwind.example', title: 'Operations Director', phone: '+48 501 234 567', source: 'Referral' }, ref: 'anna' },
  { object: 'people', data: { first_name: 'Tomas', last_name: 'Berger', email: 'tomas@vertex.example', title: 'Head of Engineering', source: 'Conference' } },
  { object: 'people', data: { first_name: 'Marta', last_name: 'Nowak', email: 'marta@pulsehealth.example', title: 'Founder', source: 'Inbound' } },
  { object: 'people', data: { first_name: 'Sven', last_name: 'de Vries', email: 'sven@cobalt.example', title: 'Creative Lead', source: 'Referral' } },

  // ── Money in ──────────────────────────────────────────────────────────────
  // Paid, sent, and one overdue — so the finance dashboard has something to
  // say and the reminder feature has something to act on.
  { object: 'invoices', data: { number: 'INV-0041', direction: 'income', amount: 18400, status: 'paid', issued_at: iso(-38), due_at: iso(-24), category: 'Consulting', notes: 'Q3 discovery engagement' }, ref: 'inv41' },
  { object: 'invoices', data: { number: 'INV-0042', direction: 'income', amount: 24000, status: 'sent', issued_at: iso(-9), due_at: iso(5), category: 'Consulting', notes: 'Fleet routing — phase 1' } },
  { object: 'invoices', data: { number: 'INV-0043', direction: 'income', amount: 9600, status: 'overdue', issued_at: iso(-52), due_at: iso(-17), category: 'Retainer', notes: 'Chased twice — see the deal notes' } },
  { object: 'invoices', data: { number: 'INV-0044', direction: 'income', amount: 6200, status: 'draft', issued_at: iso(0), due_at: iso(21), category: 'Design' } },

  // ── Money out ─────────────────────────────────────────────────────────────
  { object: 'expenses', data: { vendor: 'Hetzner', category: 'Infrastructure', amount: 320, status: 'paid', spent_at: iso(-12), notes: 'Monthly' } },
  { object: 'expenses', data: { vendor: 'Marek Wisniewski', category: 'Subcontractor', amount: 4800, status: 'approved', spent_at: iso(-6), notes: 'Backend work on the routing project' } },
  { object: 'expenses', data: { vendor: 'Figma', category: 'Software', amount: 180, status: 'paid', spent_at: iso(-20) } },
  { object: 'expenses', data: { vendor: 'Warsaw Coworking', category: 'Office', amount: 950, status: 'pending', spent_at: iso(-2) } },

  // ── What we sell ──────────────────────────────────────────────────────────
  { object: 'products', data: { name: 'Discovery sprint', sku: 'SRV-DISC', category: 'Service', unit_price: 8500, unit: 'sprint' } },
  { object: 'products', data: { name: 'Monthly retainer', sku: 'SRV-RET', category: 'Service', unit_price: 6000, unit: 'month' } },
  { object: 'products', data: { name: 'Integration build', sku: 'SRV-INT', category: 'Service', unit_price: 14000, unit: 'project' } },

  // ── Work in flight ────────────────────────────────────────────────────────
  { ref: 'proj_routing', object: 'projects', data: { name: 'Fleet routing rebuild', identifier: 'ROUTE', status: 'active', description: 'Replace the spreadsheet dispatch process for Northwind.' } },
  { object: 'projects', data: { name: 'Pulse onboarding', identifier: 'PULSE', status: 'active', description: 'Patient intake forms and reporting.' } },

  { object: 'issues', data: { title: 'Import the historic route data', status: 'done', priority: 'high', due_date: iso(-8) } },
  { object: 'issues', data: { title: 'Draft the dispatcher screen', status: 'in_progress', priority: 'high', due_date: iso(3) } },
  { object: 'issues', data: { title: 'Agree the SLA wording with Anna', status: 'todo', priority: 'medium', due_date: iso(7) } },
  { object: 'issues', data: { title: 'Set up staging for Vertex', status: 'backlog', priority: 'low' } },

  // ── Marketing ─────────────────────────────────────────────────────────────
  { object: 'campaigns', data: { name: 'Logistics newsletter Q4', channel: 'Email', status: 'active', budget: 1200, spend: 340, leads: 18, starts_on: iso(-14), ends_on: iso(45) } },
  { object: 'campaigns', data: { name: 'Manufacturing case study', channel: 'Content', status: 'planned', budget: 2500, spend: 0, leads: 0, starts_on: iso(10) } },
];

/**
 * The deals. Separate from DEMO_ROWS because a pipeline record is not a CRUD
 * object — it goes through create_pipeline_record (0092), not create_record.
 *
 * This block is the reason the header above was a lie for as long as it has
 * existed: "the invoice to Northwind is for the deal in the pipeline" described
 * a deal nobody ever seeded, on a board that had no way to create one. Seeding
 * an empty board next to a full ledger demonstrates the opposite of the pitch.
 *
 * `stage` is matched by NAME against the pipeline's own stages, because the
 * stage ids do not exist until seed_default_pipelines has run for that
 * workspace. An unmatched name falls into the first stage rather than failing —
 * a renamed pipeline should still get sample data.
 */
export const DEMO_DEALS: { title: string; amount: number; stage: string; companyRef?: string }[] = [
  { title: 'Fleet routing — phase 2', amount: 24000, stage: 'Proposal', companyRef: 'northwind' },
  { title: 'Vertex — line monitoring', amount: 41000, stage: 'Discovery', companyRef: 'vertex' },
  { title: 'Pulse — intake forms', amount: 9600, stage: 'Lead', companyRef: 'pulse' },
  { title: 'Cobalt — brand refresh', amount: 6200, stage: 'Lead', companyRef: 'cobalt' },
  { title: 'Northwind — discovery', amount: 18400, stage: 'Closed Won', companyRef: 'northwind' },
];

/**
 * The relations, applied after everything exists.
 *
 * Kept apart from the rows because a company has to have an id before an
 * invoice can point at it, and threading that through one pass would mean
 * ordering the array by dependency AND remembering to keep it that way.
 */
export const DEMO_LINKS: { ref: string; object: string; field: string; toRef: string }[] = [
  { ref: 'inv41', object: 'invoices', field: 'organization_id', toRef: 'northwind' },
  { ref: 'anna', object: 'people', field: 'primary_company_id', toRef: 'northwind' },
];

/** A doc, a checklist and a table — so Docs is not empty either. */
export const DEMO_DOCS = [
  {
    kind: 'doc' as const,
    title: 'Northwind — discovery notes',
    tags: ['Clients'],
    body: `## What they actually asked for\n\nDispatch currently runs on one shared spreadsheet. Three people edit it at once and the last save wins.\n\n- 12 vehicles, 14 drivers\n- Routes planned the evening before\n- No history once a row is overwritten\n\n## What we proposed\n\nA routing screen backed by real records, and an export their accountant already understands.\n\n> "If I can see yesterday, I can argue with the client." — Anna, Ops Director`,
  },
  {
    kind: 'todo' as const,
    title: 'Before the Northwind kickoff',
    tags: ['Clients', 'Urgent'],
    body: `- [x] Send the SOW\n- [x] Get the historic route export\n- [ ] Agree the SLA wording\n  - [ ] Response times\n  - [ ] Escalation contact\n- [ ] Book the kickoff call\n- [ ] Set up staging`,
  },
  {
    kind: 'sheet' as const,
    title: 'Rate card',
    tags: ['Finance'],
    body: `| Service | Rate | Unit | Currency |\n| --- | --- | --- | --- |\n| Discovery sprint | 8500 | sprint | PLN |\n| Monthly retainer | 6000 | month | PLN |\n| Integration build | 14000 | project | PLN |\n| Ad-hoc support | 320 | hour | PLN |`,
  },
];

export const DEMO_SUMMARY =
  '4 companies, 4 contacts, 5 deals on the board, 4 invoices, 4 expenses, 2 projects with issues, 2 campaigns and 3 documents — linked to each other, dated around today.';
