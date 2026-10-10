// The words the automation builder speaks — triggers, fields, conditions,
// steps, recipes — in one place, so the screen, the recipes and the sentence on
// each card cannot describe the same automation three different ways.
//
// Client-safe: imports only the object registry (pure data). The dispatcher
// (lib/automations/dispatcher.ts) is the reader of what this writes; keep the
// op and action names in step with it.
import { OBJECTS } from '@/lib/crm/registry';

export interface FieldOption { key: string; label: string; options?: string[]; type?: 'text' | 'number' | 'date' }
export interface TriggerObject {
  slug: string;
  /** "an invoice" — used in sentences. */
  one: string;
  label: string;
  group: string;
  fields: FieldOption[];
  /** Created only (a form submission is never edited). */
  createdOnly?: boolean;
  /** Can an automation update this record / add a note to it? (CRUD objects only.) */
  writable?: boolean;
}

const fromRegistry = (slug: string): FieldOption[] =>
  (OBJECTS[slug]?.form || [])
    .filter((f) => !['image', 'lookup', 'relation'].includes(f.input))
    .map((f) => ({ key: f.key, label: f.label, options: f.input === 'select' ? f.options : undefined,
      type: f.input === 'number' ? 'number' : f.input === 'date' ? 'date' : 'text' }));

const COMPANY: FieldOption = { key: 'company', label: 'Company name' };

export const TRIGGER_OBJECTS: TriggerObject[] = [
  { slug: 'deals', one: 'a deal', label: 'Deals', group: 'Sales', fields: [
    { key: 'title', label: 'Title' }, { key: 'amount', label: 'Amount', type: 'number' },
    { key: 'status', label: 'Status', options: ['active', 'won', 'lost'] }, { key: 'stage', label: 'Stage' },
    COMPANY, { key: 'close_date', label: 'Expected close', type: 'date' },
  ] },
  { slug: 'companies', one: 'a company', label: 'Companies', group: 'Sales', fields: fromRegistry('companies'), writable: true },
  { slug: 'people', one: 'a person', label: 'People', group: 'Sales', fields: [...fromRegistry('people'), COMPANY], writable: true },
  { slug: 'products', one: 'a product', label: 'Products', group: 'Sales', fields: fromRegistry('products'), writable: true },
  { slug: 'orders', one: 'an order', label: 'Orders', group: 'Sales', fields: [
    { key: 'number', label: 'Number' }, { key: 'status', label: 'Status', options: ['draft', 'pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded'] },
    COMPANY, { key: 'ship_to', label: 'Ship to' }, { key: 'placed_at', label: 'Placed', type: 'date' },
  ] },
  { slug: 'invoices', one: 'an invoice', label: 'Invoices & offers', group: 'Finance', fields: [...fromRegistry('invoices'), COMPANY], writable: true },
  { slug: 'expenses', one: 'an expense', label: 'Expenses', group: 'Finance', fields: fromRegistry('expenses'), writable: true },
  { slug: 'transactions', one: 'a transaction', label: 'Transactions', group: 'Finance', fields: fromRegistry('transactions'), writable: true },
  { slug: 'form_submissions', one: 'a form submission', label: 'Form submissions', group: 'Marketing', createdOnly: true, fields: [
    { key: 'form', label: 'Form name' }, { key: 'email', label: 'Email' }, { key: 'name', label: 'Name' },
  ] },
  { slug: 'campaigns', one: 'a campaign', label: 'Campaigns', group: 'Marketing', fields: fromRegistry('campaigns'), writable: true },
  { slug: 'conversations', one: 'a chat conversation', label: 'Support conversations', group: 'Support', fields: [
    { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'message', label: 'First message' },
    { key: 'status', label: 'Status', options: ['open', 'pending', 'closed'] }, { key: 'page_url', label: 'Page' },
  ] },
  { slug: 'candidates', one: 'a candidate', label: 'Candidates', group: 'HR', fields: [
    { key: 'full_name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'position', label: 'Position' },
    { key: 'status', label: 'Status', options: ['applied', 'screening', 'assessment_sent', 'assessment_completed', 'interview_scheduled', 'interviewed', 'offered', 'rejected', 'hired'] },
    { key: 'source', label: 'Source' },
  ] },
  { slug: 'projects', one: 'a project', label: 'Projects', group: 'Projects', fields: fromRegistry('projects'), writable: true },
  { slug: 'issues', one: 'an issue', label: 'Issues', group: 'Projects', fields: fromRegistry('issues'), writable: true },
  { slug: 'assets', one: 'an asset', label: 'Assets', group: 'Team', fields: fromRegistry('assets'), writable: true },
];

/** Objects an automation can CREATE (the CRUD monolith's built-ins). */
export const CREATABLE = ['people', 'companies', 'issues', 'projects', 'invoices', 'expenses', 'products', 'campaigns', 'assets'];
export const createFields = (slug: string): FieldOption[] => fromRegistry(slug);

export interface Op { v: string; l: string; needsValue: boolean; updatesOnly?: boolean }
export const OPS: Op[] = [
  { v: 'changed_to', l: 'changes to', needsValue: true, updatesOnly: true },
  { v: 'eq', l: 'is', needsValue: true },
  { v: 'neq', l: 'is not', needsValue: true },
  { v: 'contains', l: 'contains', needsValue: true },
  { v: 'gt', l: 'is more than', needsValue: true },
  { v: 'lt', l: 'is less than', needsValue: true },
  { v: 'not_empty', l: 'is filled in', needsValue: false },
  { v: 'empty', l: 'is empty', needsValue: false },
  { v: 'changed', l: 'changes at all', needsValue: false, updatesOnly: true },
  { v: 'changed_from', l: 'changes from', needsValue: true, updatesOnly: true },
];
export const opLabel = (v: string) => OPS.find((o) => o.v === v)?.l || v;

export interface ActionType { v: string; l: string; hint: string; needsRecord?: boolean }
export const ACTIONS: ActionType[] = [
  { v: 'send_email', l: 'Send an email', hint: 'To you, the team, or the person in the record' },
  { v: 'post_to_chat', l: 'Post in team chat', hint: 'A message in a channel' },
  { v: 'ask_ai', l: 'Ask AI', hint: 'Summarise, classify or draft — the answer is {{ai_output}}' },
  { v: 'run_agent', l: 'Hand it to an agent', hint: 'One of your agents takes it from here' },
  { v: 'create_record', l: 'Create a record', hint: 'A task, a contact, a company…' },
  { v: 'update_record', l: 'Update this record', hint: 'Set fields on the record that triggered it', needsRecord: true },
  { v: 'add_note', l: 'Add a note', hint: 'Written on the record that triggered it', needsRecord: true },
  { v: 'send_webhook', l: 'Send to a connected app', hint: 'Slack, Zapier, Make, n8n — set up in Integrations' },
];
export const actionLabel = (v: string) => ACTIONS.find((a) => a.v === v)?.l || v;

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface Schedule { every: 'minute' | 'hour' | 'day' | 'week'; at?: string; day?: number; tz?: string }

/** "When an invoice's status changes to paid" — the sentence on a card. */
export function describeTrigger(a: { trigger_type: string; object: string; event: string; conditions?: any[]; schedule?: Schedule | null }, objects: TriggerObject[] = TRIGGER_OBJECTS): string {
  if (a.trigger_type === 'webhook') return 'When another app sends data';
  if (a.trigger_type === 'schedule') {
    const s = a.schedule || { every: 'day' };
    if (s.every === 'minute') return 'Every minute';
    if (s.every === 'hour') return 'Every hour';
    if (s.every === 'week') return `Every ${WEEKDAYS[s.day ?? 1]}${s.at ? ` at ${s.at}` : ''}`;
    return `Every day${s.at ? ` at ${s.at}` : ''}`;
  }
  const o = objects.find((x) => x.slug === a.object);
  const one = o?.one || `a ${a.object}`;
  const c = (a.conditions || [])[0];
  if (c && a.event === 'updated' && String(c.op).startsWith('changed')) {
    const f = o?.fields.find((x) => x.key === c.field)?.label.toLowerCase() || c.field;
    return `When ${one}’s ${f} ${opLabel(c.op)}${c.value ? ` ${c.value}` : ''}`;
  }
  return `When ${one} is ${a.event === 'updated' ? 'updated' : 'added'}${(a.conditions || []).length ? ' (with filters)' : ''}`;
}

// ── Recipes ─────────────────────────────────────────────────────────────────
// Real, working automations — each opens in the editor with the gaps (a
// channel, an address, an agent) for a person to fill. They are also the
// clearest documentation of what the engine can do.
export interface Recipe { key: string; name: string; desc: string; automation: any }
export const RECIPES: Recipe[] = [
  { key: 'invoice-paid', name: 'Invoice paid → tell the team', desc: 'A message in chat the moment an invoice is marked paid.',
    automation: { name: 'Invoice paid', trigger_type: 'event', object: 'invoices', event: 'updated',
      conditions: [{ field: 'status', op: 'changed_to', value: 'paid' }],
      actions: [{ type: 'post_to_chat', config: { message: '💰 {{number}} from {{company}} is paid — {{amount}}' } }] } },
  { key: 'deal-won', name: 'Deal won → kick-off task', desc: 'Celebrate in chat and open a task to start the work.',
    automation: { name: 'Deal won', trigger_type: 'event', object: 'deals', event: 'updated',
      conditions: [{ field: 'status', op: 'changed_to', value: 'won' }],
      actions: [
        { type: 'post_to_chat', config: { message: '🎉 {{title}} won — {{amount}} ({{company}})' } },
        { type: 'create_record', config: { object: 'issues', data: { title: 'Kick off {{title}}', status: 'todo', priority: 'high' } } },
      ] } },
  { key: 'form-lead', name: 'Form submitted → email me', desc: 'Every new submission of a public form, in your inbox.',
    automation: { name: 'New form submission', trigger_type: 'event', object: 'form_submissions', event: 'created', conditions: [],
      actions: [{ type: 'send_email', config: { subject: 'New {{form}} submission from {{email}}', body: 'Someone filled in {{form}}.\n\nEmail: {{email}}\nName: {{name}}' } }] } },
  { key: 'chat-triage', name: 'Website chat → AI summary', desc: 'AI reads each new conversation and posts a one-line summary.',
    automation: { name: 'Summarise new chats', trigger_type: 'event', object: 'conversations', event: 'created', conditions: [],
      actions: [
        { type: 'ask_ai', config: { prompt: 'In one line: what does this person want, and what should we do next?' } },
        { type: 'post_to_chat', config: { message: '💬 {{name}} ({{email}}): {{ai_output}}' } },
      ] } },
  { key: 'new-applicant', name: 'New applicant → hiring channel', desc: 'Post each new candidate where the hiring team will see it.',
    automation: { name: 'New applicant', trigger_type: 'event', object: 'candidates', event: 'created', conditions: [],
      actions: [{ type: 'post_to_chat', config: { message: '🧑‍💼 {{full_name}} applied for {{position}}' } }] } },
  { key: 'contact-brief', name: 'New contact → AI brief', desc: 'AI writes a two-line brief and saves it as a note on the person.',
    automation: { name: 'Brief on new contacts', trigger_type: 'event', object: 'people', event: 'created', conditions: [],
      actions: [
        { type: 'ask_ai', config: { prompt: 'Write a two-sentence brief on {{first_name}} {{last_name}} ({{title}}) for the team.' } },
        { type: 'add_note', config: { body: '{{ai_output}}' } },
      ] } },
  { key: 'weekly-agent', name: 'Monday pipeline review', desc: 'Every Monday morning an agent reviews open deals and reports.',
    automation: { name: 'Weekly pipeline review', trigger_type: 'schedule', object: 'schedule', event: 'schedule', conditions: [],
      schedule: { every: 'week', day: 1, at: '09:00' },
      actions: [{ type: 'run_agent', config: { task: 'Review the open deals: which are stuck, which close this month, what should we do next? Keep it short.' } }] } },
  { key: 'overdue', name: 'Invoice overdue → remind me', desc: 'An email the day an invoice goes overdue.',
    automation: { name: 'Overdue invoice', trigger_type: 'event', object: 'invoices', event: 'updated',
      conditions: [{ field: 'status', op: 'changed_to', value: 'overdue' }],
      actions: [{ type: 'send_email', config: { subject: 'Invoice {{number}} is overdue', body: '{{number}} for {{company}} ({{amount}}) was due {{due_at}}.' } }] } },
  { key: 'inbound', name: 'Another app → new contact', desc: 'A URL any tool can POST to that creates a person.',
    automation: { name: 'Inbound lead', trigger_type: 'webhook', object: 'webhook', event: 'webhook', conditions: [],
      actions: [{ type: 'create_record', config: { object: 'people', data: { first_name: '{{first_name}}', last_name: '{{last_name}}', email: '{{email}}' } } }] } },
];
