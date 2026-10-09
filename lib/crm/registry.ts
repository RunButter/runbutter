// Object registry — the single source of truth the generic RecordTable/views read
// to render any object without bespoke code.
import type { ObjectDef } from './types';

export const OBJECTS: Record<string, ObjectDef> = {
  people: {
    slug: 'people', singular: 'Person', plural: 'People', icon: 'Users', type: 'person',
    fields: [
      { key: 'name', label: 'Name', type: 'avatar', primary: true, width: 240 },
      { key: 'title', label: 'Title', type: 'text', width: 180 },
      { key: 'company', label: 'Company', type: 'relation', width: 160 },
      { key: 'email', label: 'Email', type: 'text', width: 220 },
      { key: 'source', label: 'Source', type: 'tags', width: 120 },
      // No "Synergy" column: it is the latest psychometric score, which exists
      // only for someone who took a hiring assessment — on a sales contact list
      // it was an empty column with a label nobody could explain. Candidates
      // show their scores on the HR screens, where they mean something.
    ],
    form: [
      { key: 'first_name', label: 'First name', input: 'text', required: true },
      { key: 'last_name', label: 'Last name', input: 'text' },
      { key: 'email', label: 'Email', input: 'text' },
      { key: 'phone', label: 'Phone', input: 'text' },
      { key: 'title', label: 'Title', input: 'text' },
      // The relation the CRM is FOR. It was absent from this form and dropped
      // by create_record (0117), so a person was never attached to a company by
      // any path a human could take.
      { key: 'primary_company_id', label: 'Company', input: 'relation', optionsObject: 'companies' },
      { key: 'source', label: 'Source', input: 'text' },
    ],
  },
  companies: {
    slug: 'companies', singular: 'Company', plural: 'Companies', icon: 'Building2', type: 'company',
    fields: [
      { key: 'name', label: 'Name', type: 'avatar', primary: true, width: 220 },
      { key: 'tax_id', label: 'Tax ID', type: 'text', width: 150 },
      { key: 'domain', label: 'Domain', type: 'text', width: 180 },
      { key: 'industry', label: 'Industry', type: 'text', width: 160 },
      { key: 'employee_count', label: 'Employees', type: 'number', align: 'right', width: 110 },
    ],
    form: [
      { key: 'country', label: 'Country', input: 'select', options: ['PL', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'AT', 'CZ', 'SK', 'SE', 'DK', 'FI', 'IE', 'PT', 'RO', 'HU', 'GR', 'BG', 'HR', 'LT', 'LV', 'EE', 'SI', 'LU', 'CY', 'MT'] },
      { key: 'tax_id', label: 'Tax / VAT ID', input: 'text' },
      { key: 'lookup', label: 'Fetch company details', input: 'lookup' },
      { key: 'name', label: 'Name', input: 'text', required: true },
      { key: 'address', label: 'Address', input: 'textarea' },
      { key: 'domain', label: 'Domain', input: 'text' },
      { key: 'industry', label: 'Industry', input: 'text' },
      { key: 'employee_count', label: 'Employees', input: 'number' },
    ],
  },
  invoices: {
    slug: 'invoices', singular: 'Invoice', plural: 'Invoices', icon: 'Receipt', type: 'asset',
    fields: [
      { key: 'number', label: 'Invoice', type: 'avatar', primary: true, width: 150 },
      { key: 'company', label: 'Account', type: 'relation', width: 160 },
      { key: 'direction', label: 'Type', type: 'tags', width: 100 },
      { key: 'category', label: 'Category', type: 'tags', width: 130 },
      { key: 'amount', label: 'Amount', type: 'currency', align: 'right', width: 120 },
      { key: 'status', label: 'Status', type: 'tags', width: 100 },
      { key: 'due_at', label: 'Due', type: 'date', width: 120 },
    ],
    form: [
      { key: 'number', label: 'Invoice #', input: 'text', required: true },
      { key: 'organization_id', label: 'Company', input: 'relation', optionsObject: 'companies' },
      { key: 'kind', label: 'Document', input: 'select', options: ['invoice', 'offer'] },
      { key: 'direction', label: 'Type', input: 'select', options: ['income', 'cost'] },
      { key: 'amount', label: 'Amount', input: 'number', required: true },
      { key: 'category', label: 'Category', input: 'datalist' },
      { key: 'status', label: 'Status', input: 'select', options: ['draft', 'sent', 'paid', 'overdue'] },
      { key: 'issued_at', label: 'Issued', input: 'date' },
      { key: 'due_at', label: 'Due', input: 'date' },
      { key: 'notes', label: 'Notes', input: 'textarea' },
    ],
  },
  offers: {
    slug: 'offers', singular: 'Offer', plural: 'Offers', icon: 'FileText', type: 'asset',
    fields: [
      { key: 'number', label: 'Offer', type: 'avatar', primary: true, width: 150 },
      { key: 'company', label: 'Client', type: 'relation', width: 180 },
      { key: 'category', label: 'Category', type: 'tags', width: 140 },
      { key: 'amount', label: 'Total', type: 'currency', align: 'right', width: 130 },
      { key: 'status', label: 'Status', type: 'tags', width: 120 },
      { key: 'due_at', label: 'Valid until', type: 'date', width: 130 },
    ],
    form: [
      { key: 'number', label: 'Offer #', input: 'text', required: true },
      { key: 'organization_id', label: 'Client', input: 'relation', optionsObject: 'companies' },
      { key: 'status', label: 'Status', input: 'select', options: ['draft', 'sent', 'accepted', 'declined'] },
      { key: 'category', label: 'Category', input: 'datalist' },
      { key: 'issued_at', label: 'Issued', input: 'date' },
      { key: 'due_at', label: 'Valid until', input: 'date' },
      { key: 'notes', label: 'Notes', input: 'textarea' },
    ],
  },
  transactions: {
    slug: 'transactions', singular: 'Transaction', plural: 'Transactions', icon: 'ArrowLeftRight', type: 'asset',
    fields: [
      { key: 'txn_date', label: 'Date', type: 'date', width: 120 },
      { key: 'description', label: 'Description', type: 'avatar', primary: true, width: 240 },
      { key: 'category', label: 'Category', type: 'tags', width: 150 },
      { key: 'account', label: 'Account', type: 'text', width: 150 },
      { key: 'status', label: 'Status', type: 'tags', width: 110 },
      { key: 'amount', label: 'Amount', type: 'currency', align: 'right', width: 130 },
    ],
    form: [
      { key: 'txn_date', label: 'Date', input: 'date', required: true },
      { key: 'description', label: 'Description', input: 'text', required: true },
      { key: 'amount', label: 'Amount (– for money out)', input: 'number', required: true },
      { key: 'category', label: 'Category', input: 'datalist' },
      { key: 'method', label: 'Method', input: 'select', options: ['transfer', 'card', 'cash', 'direct_debit', 'fee', 'other'] },
      { key: 'status', label: 'Status', input: 'select', options: ['posted', 'pending', 'excluded'] },
      { key: 'tax_rate', label: 'VAT %', input: 'number' },
      { key: 'notes', label: 'Notes', input: 'textarea' },
    ],
  },
  expenses: {
    slug: 'expenses', singular: 'Expense', plural: 'Expenses', icon: 'Wallet', type: 'asset',
    fields: [
      { key: 'vendor', label: 'Vendor', type: 'avatar', primary: true, width: 180 },
      { key: 'category', label: 'Category', type: 'tags', width: 140 },
      { key: 'amount', label: 'Amount', type: 'currency', align: 'right', width: 140 },
      { key: 'status', label: 'Status', type: 'tags', width: 120 },
      { key: 'spent_at', label: 'Date', type: 'date', width: 140 },
    ],
    form: [
      { key: 'vendor', label: 'Vendor', input: 'text', required: true },
      { key: 'category', label: 'Category', input: 'select', options: ['payroll', 'software', 'office', 'travel', 'other'] },
      { key: 'amount', label: 'Amount', input: 'number', required: true },
      { key: 'status', label: 'Status', input: 'select', options: ['pending', 'approved', 'paid'] },
      { key: 'spent_at', label: 'Date', input: 'date' },
      { key: 'notes', label: 'Notes', input: 'textarea' },
    ],
  },
  campaigns: {
    slug: 'campaigns', singular: 'Campaign', plural: 'Campaigns', icon: 'Megaphone', type: 'asset',
    fields: [
      { key: 'name', label: 'Campaign', type: 'avatar', primary: true, width: 220 },
      { key: 'channel', label: 'Channel', type: 'tags', width: 110 },
      { key: 'status', label: 'Status', type: 'tags', width: 110 },
      { key: 'budget', label: 'Budget', type: 'currency', align: 'right', width: 110 },
      { key: 'spend', label: 'Spend', type: 'currency', align: 'right', width: 110 },
      { key: 'leads', label: 'Leads', type: 'number', align: 'right', width: 80 },
      { key: 'ends_on', label: 'Ends', type: 'date', width: 120 },
    ],
    form: [
      { key: 'name', label: 'Campaign name', input: 'text', required: true },
      { key: 'channel', label: 'Channel', input: 'select', options: ['email', 'social', 'ads', 'event', 'content', 'other'] },
      { key: 'status', label: 'Status', input: 'select', options: ['planned', 'active', 'paused', 'completed'] },
      { key: 'budget', label: 'Budget', input: 'number' },
      { key: 'spend', label: 'Spend', input: 'number' },
      { key: 'leads', label: 'Leads generated', input: 'number' },
      { key: 'starts_on', label: 'Starts', input: 'date' },
      { key: 'ends_on', label: 'Ends', input: 'date' },
      { key: 'notes', label: 'Notes', input: 'textarea' },
    ],
  },
  projects: {
    slug: 'projects', singular: 'Project', plural: 'Projects', icon: 'FolderKanban', type: 'asset',
    fields: [
      { key: 'name', label: 'Project', type: 'avatar', primary: true, width: 240 },
      { key: 'identifier', label: 'Key', type: 'tags', width: 110 },
      { key: 'status', label: 'Status', type: 'tags', width: 120 },
      { key: 'issues', label: 'Issues', type: 'number', align: 'right', width: 90 },
    ],
    form: [
      { key: 'name', label: 'Project name', input: 'text', required: true },
      { key: 'identifier', label: 'Key', input: 'text' },
      { key: 'status', label: 'Status', input: 'select', options: ['active', 'paused', 'completed', 'cancelled'] },
      { key: 'description', label: 'Description', input: 'textarea' },
    ],
  },
  issues: {
    slug: 'issues', singular: 'Issue', plural: 'Issues', icon: 'ListTodo', type: 'asset',
    fields: [
      { key: 'name', label: 'Issue', type: 'avatar', primary: true, width: 280 },
      { key: 'project', label: 'Project', type: 'relation', width: 160 },
      { key: 'status', label: 'Status', type: 'tags', width: 130 },
      { key: 'priority', label: 'Priority', type: 'tags', width: 110 },
      { key: 'due_date', label: 'Due', type: 'date', width: 130 },
    ],
    form: [
      { key: 'title', label: 'Title', input: 'text', required: true },
      // Same story as people.primary_company_id: editable in SQL since 0088,
      // never creatable, never on the form. An issue with no project is missing
      // from the board, the project page and the roadmap.
      { key: 'project_id', label: 'Project', input: 'relation', optionsObject: 'projects' },
      { key: 'status', label: 'Status', input: 'select', options: ['backlog', 'todo', 'in_progress', 'done', 'cancelled'] },
      { key: 'priority', label: 'Priority', input: 'select', options: ['none', 'low', 'medium', 'high', 'urgent'] },
      { key: 'due_date', label: 'Due date', input: 'date' },
      { key: 'description', label: 'Description', input: 'textarea' },
    ],
  },
  products: {
    slug: 'products', singular: 'Product', plural: 'Products', icon: 'Package', type: 'asset',
    fields: [
      { key: 'image', label: '', type: 'image', width: 52 },
      { key: 'name', label: 'Product', type: 'avatar', primary: true, width: 220 },
      { key: 'sku', label: 'SKU', type: 'tags', width: 130 },
      { key: 'category', label: 'Category', type: 'tags', width: 140 },
      { key: 'unit_price', label: 'Price', type: 'currency', align: 'right', width: 120 },
      { key: 'unit', label: 'Unit', type: 'text', width: 100 },
    ],
    form: [
      { key: 'image_url', label: 'Image', input: 'image' },
      { key: 'name', label: 'Name', input: 'text', required: true },
      { key: 'sku', label: 'SKU', input: 'text' },
      { key: 'category', label: 'Category', input: 'datalist' },
      { key: 'unit_price', label: 'Unit price', input: 'number', required: true },
      { key: 'unit', label: 'Unit', input: 'text' },
      { key: 'description', label: 'Description', input: 'textarea' },
    ],
  },
  assets: {
    slug: 'assets', singular: 'Asset', plural: 'Assets', icon: 'Laptop', type: 'asset',
    fields: [
      { key: 'name', label: 'Asset', type: 'avatar', primary: true, width: 220 },
      { key: 'category', label: 'Category', type: 'tags', width: 130 },
      { key: 'serial_number', label: 'Serial', type: 'text', width: 160 },
      { key: 'status', label: 'Status', type: 'tags', width: 130 },
      { key: 'assigned_to', label: 'Assigned to', type: 'relation', width: 180 },
    ],
    form: [
      { key: 'name', label: 'Name', input: 'text', required: true },
      { key: 'category', label: 'Category', input: 'select', options: ['laptop', 'monitor', 'phone', 'license', 'other'] },
      { key: 'serial_number', label: 'Serial number', input: 'text' },
      { key: 'status', label: 'Status', input: 'select', options: ['available', 'assigned', 'repair', 'retired'] },
      { key: 'assigned_to_person_id', label: 'Assigned to', input: 'relation', optionsObject: 'people' },
    ],
  },
};

// One nav over the whole company OS. Sales/CRM leads; the shipped ATS is the HR
// module; Finance + HRIS round it out. Nothing from the ATS is removed.
//
// `tabs` folds related screens under ONE entry (2026-10 audit: 60 entries in 11
// sections was a menu nobody could hold in their head). Every tab keeps its own
// URL — links, bookmarks and agent hand-backs still work — and the shell draws
// the tab strip (`SectionTabs`). The FIRST tab is always the entry's own href.
export interface NavTab { label: string; href: string }
export const NAV = [
  { group: 'Workspace', pinned: true, items: [
    { slug: 'home', label: 'Home', icon: 'LayoutDashboard', href: '/home' },
    // Any question about any record type, as a chart. Workspace rather than
    // Finance because it reads every object, custom ones included.
    { slug: 'insights', label: 'Insights', icon: 'BarChart3', href: '/insights' },
    { slug: 'docs', label: 'Docs', icon: 'FileText', href: '/docs' },
    // Files sits beside Docs, not under Settings: it is a place to work, and
    // its whole value is that uploaded documents become searchable rows in the
    // same database as the ledger.
    { slug: 'files', label: 'Files', icon: 'FolderOpen', href: '/files' },
    // Beside Docs rather than under Finance: what gets signed is a contract, an
    // NDA, an offer letter — documents, most of which never touch the ledger.
    { slug: 'sign', label: 'Signatures', icon: 'PenLine', href: '/finance/sign' },
    // One calendar over the whole company: invoice due dates, issue deadlines,
    // scheduled posts and newsletters, campaign windows, interviews and Cal.com
    // bookings. It sits with Docs and Files because it is a place to look, not
    // a module — every pillar feeds it and none owns it.
    { slug: 'calendar', label: 'Calendar', icon: 'CalendarDays', href: '/calendar' },
  ]},
  { group: 'Sales', items: [
    { slug: 'deals', label: 'Deals', icon: 'Target', href: '/pipelines/sales/board' },
    { slug: 'companies', label: 'Companies', icon: 'Building2', href: '/objects/companies' },
    { slug: 'people', label: 'People', icon: 'Users', href: '/objects/people' },
    { slug: 'products', label: 'Products', icon: 'Package', href: '/objects/products' },
    { slug: 'offers', label: 'Offers', icon: 'FileText', href: '/objects/offers' },
    // Orders sit with the catalogue they sell from. Their own screen rather
    // than /objects/orders because an order has line items, and the generic
    // RecordTable is flat.
    { slug: 'orders', label: 'Orders', icon: 'ShoppingCart', href: '/orders' },
  ]},
  { group: 'Finance', items: [
    // Three views of the same numbers — where we are, how we are doing, where
    // we are heading — so one entry with three tabs, not three entries.
    { slug: 'finance', label: 'Overview', icon: 'TrendingUp', href: '/finance/overview', tabs: [
      { label: 'Overview', href: '/finance/overview' },
      { label: 'KPIs', href: '/finance/kpis' },
      { label: 'Forecast', href: '/finance/forecast' },
    ]},
    { slug: 'transactions', label: 'Transactions', icon: 'ArrowLeftRight', href: '/finance/transactions' },
    { slug: 'invoices', label: 'Invoices', icon: 'Receipt', href: '/objects/invoices' },
    { slug: 'expenses', label: 'Expenses', icon: 'Wallet', href: '/objects/expenses' },
    // Who owns the company and what they are told each month are the same
    // conversation. The slug stays `cap-table` so a module someone switched off
    // stays off.
    { slug: 'cap-table', label: 'Investors', icon: 'PieChart', href: '/cap-table', tabs: [
      { label: 'Cap table', href: '/cap-table' },
      { label: 'Investor update', href: '/investor-update' },
    ]},
  ]},
  { group: 'Marketing', items: [
    { slug: 'marketing', label: 'Overview', icon: 'Megaphone', href: '/marketing/overview' },
    // Marketing rather than Settings, and the distinction is real: Settings →
    // Branding is the ten values an invoice renderer reads, and this is the
    // whole spec — palette, type, spacing, voice, and the rules an AI agent
    // needs before it writes a word. It sits next to the surfaces that consume
    // it rather than beside the switches nobody opens twice.
    { slug: 'design', label: 'Design', icon: 'Palette', href: '/design' },
    { slug: 'campaigns', label: 'Campaigns', icon: 'Rocket', href: '/objects/campaigns' },
    { slug: 'posts', label: 'Posts', icon: 'PenSquare', href: '/marketing/posts' },
    { slug: 'newsletters', label: 'Newsletters', icon: 'Mail', href: '/marketing/newsletters' },
    { slug: 'forms', label: 'Forms', icon: 'FileInput', href: '/marketing/forms' },
    { slug: 'links', label: 'Short links', icon: 'Link2', href: '/marketing/links' },
    { slug: 'webanalytics', label: 'Web analytics', icon: 'Globe', href: '/marketing/analytics' },
  ]},
  // Customers writing in (0131). Its own section rather than under Sales:
  // support is somebody's whole job in a company of any size, and the person
  // doing it should not have to open the sales pipeline to find their queue.
  { group: 'Support', items: [
    { slug: 'inbox', label: 'Inbox', icon: 'Inbox', href: '/inbox', tabs: [
      { label: 'Inbox', href: '/inbox' },
      { label: 'Chat widget', href: '/inbox/widget' },
    ]},
  ]},
  { group: 'HR', items: [
    { slug: 'hr-overview', label: 'Overview', icon: 'LayoutDashboard', href: '/dashboard/overview', tabs: [
      { label: 'Overview', href: '/dashboard/overview' },
      { label: 'Analytics', href: '/dashboard/analytics' },
    ]},
    { slug: 'positions', label: 'Positions', icon: 'Briefcase', href: '/dashboard/positions' },
    // Email templates are what you send TO candidates, so they live a tab away
    // from them rather than as an entry of their own.
    { slug: 'candidates', label: 'Candidates', icon: 'Users', href: '/dashboard/candidates', tabs: [
      { label: 'Candidates', href: '/dashboard/candidates' },
      { label: 'Email templates', href: '/dashboard/templates' },
    ]},
    { slug: 'pipeline', label: 'Hiring pipeline', icon: 'Columns3', href: '/dashboard/pipeline' },
    { slug: 'interviews', label: 'Interviews', icon: 'Calendar', href: '/dashboard/interviews' },
    { slug: 'treasury', label: 'Talent pool', icon: 'Sparkles', href: '/dashboard/treasury' },
    // The public page and the links that bring people to it. Source tracking
    // sat under Marketing, where it read as UTM links — it makes job-board
    // links for a position, which is a hiring question. The careers page's
    // look still comes from Settings → Branding.
    { slug: 'careers', label: 'Careers & sources', icon: 'Globe2', href: '/dashboard/careers', tabs: [
      { label: 'Careers page', href: '/dashboard/careers' },
      { label: 'Source tracking', href: '/dashboard/sources' },
    ]},
    // The people already hired — onboarding and wellbeing — so HR, not Team.
    { slug: 'my-team', label: 'My team', icon: 'Heart', href: '/dashboard/my-team' },
  ]},
  { group: 'Projects', items: [
    { slug: 'projects', label: 'Projects', icon: 'FolderKanban', href: '/objects/projects' },
    // Issues has its own Board view (every object does), so the separate
    // Board entry that drew the same cards is gone; /projects/board redirects.
    { slug: 'issues', label: 'Issues', icon: 'ListTodo', href: '/objects/issues' },
    { slug: 'roadmap', label: 'Roadmap', icon: 'GanttChartSquare', href: '/projects/roadmap' },
  ]},
  { group: 'Automate', items: [
    { slug: 'agents', label: 'Agents', icon: 'Bot', href: '/agents' },
    // A library, not a per-agent setting — one skill is usually attached to
    // several agents, so it needs a home you can reach without editing one.
    { slug: 'skills', label: 'Skills', icon: 'BookOpen', href: '/skills' },
    { slug: 'automations', label: 'Automations', icon: 'Zap', href: '/settings/automations' },
  ]},
  // People, not configuration — kept out of Settings deliberately.
  // A "Directory" link used to sit here pointing at /hris/directory, a route
  // that was never built — it 404'd for every user who clicked it. It was also
  // redundant three ways: Settings → Members lists who is in the workspace,
  // My Team covers your own reports, and /objects/people holds contacts.
  { group: 'Team', items: [
    { slug: 'chat', label: 'Chat', icon: 'MessageCircle', href: '/chat' },
    { slug: 'assets', label: 'Assets', icon: 'Laptop', href: '/objects/assets' },
    // Shared credentials are a team thing, not a setting: the registrar login
    // belongs to whoever needs it today, the same way an asset does.
    { slug: 'vault', label: 'Vault', icon: 'KeyRound', href: '/vault' },
  ]},
  // Utilities that belong to no pillar. They sat pinned at the top beside
  // Home and Docs, which put seven loose links above every section and made
  // the first thing in the rail a list of tools rather than the business.
  // Collapsed here they are one click away and out of the way.
  { group: 'Tools', items: [
    { slug: 'maps', label: 'Maps', icon: 'Waypoints', href: '/maps' },
    { slug: 'pdf', label: 'PDF tools', icon: 'FileStack', href: '/pdf' },
    { slug: 'qr', label: 'QR codes', icon: 'QrCode', href: '/qr' },
  ]},
  // Everything here changes the workspace for everyone in it. There used to be
  // an "Account — yours alone" section beside it, and BOTH of its entries were
  // workspace-wide: the AI key every agent reads, and the Telegram bot an admin
  // connects. A heading that says "only you" over a switch that changes it for
  // everybody is how a viewer ended up able to replace the AI key (0129).
  { group: 'Settings', items: [
    { slug: 'branding', label: 'Branding', icon: 'Palette', href: '/settings/branding' },
    // Switch whole sections or single screens off (0128). Next to Objects
    // because both decide what this workspace looks like.
    { slug: 'modules', label: 'Modules', icon: 'Boxes', href: '/settings/modules' },
    { slug: 'objects', label: 'Objects', icon: 'Table2', href: '/settings/objects' },
    { slug: 'members', label: 'Members & roles', icon: 'ShieldCheck', href: '/settings/members' },
    { slug: 'plans', label: 'Plans & billing', icon: 'CreditCard', href: '/settings/plans' },
    // Three pages, one question — "what is connected to this workspace" — so
    // one entry. Connectors first: connecting Slack is what most people come
    // for, and it used to be the eighth section of the page now second.
    { slug: 'connectors', label: 'Integrations', icon: 'Plug', href: '/settings/connectors', tabs: [
      { label: 'Connectors', href: '/settings/connectors' },
      { label: 'API & webhooks', href: '/settings/integrations' },
      { label: 'Telegram bot', href: '/settings/assistant' },
    ]},
    { slug: 'ai-keys', label: 'AI', icon: 'Sparkles', href: '/settings/ai' },
    { slug: 'reports', label: 'Reports', icon: 'FileBarChart', href: '/settings/reports' },
    // Last, because it is the one you visit twice a year.
    { slug: 'updates', label: 'Updates', icon: 'Rocket', href: '/settings/updates' },
  ]},
];

/** The entry (and its tab list) that owns `pathname`, if the entry has tabs. */
export function navTabsFor(pathname: string): { label: string; tabs: NavTab[] } | null {
  const hit = (href: string) => pathname === href || pathname.startsWith(href + '/');
  for (const g of NAV as any[]) {
    for (const it of g.items) {
      if (it.tabs?.some((t: NavTab) => hit(t.href))) return { label: it.label, tabs: it.tabs };
    }
  }
  return null;
}

/** Every href an entry answers for — its own plus its tabs'. */
export function navHrefs(it: { href: string; tabs?: NavTab[] }): string[] {
  return it.tabs?.length ? it.tabs.map((t) => t.href) : [it.href];
}
