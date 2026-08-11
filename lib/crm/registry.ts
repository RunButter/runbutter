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
      { key: 'synergy', label: 'Synergy', type: 'number', align: 'right', width: 100 },
    ],
    form: [
      { key: 'first_name', label: 'First name', input: 'text', required: true },
      { key: 'last_name', label: 'Last name', input: 'text' },
      { key: 'email', label: 'Email', input: 'text' },
      { key: 'phone', label: 'Phone', input: 'text' },
      { key: 'title', label: 'Title', input: 'text' },
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
      { key: 'kind', label: 'Doc', type: 'tags', width: 90 },
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
// Four collapsible pillars over the company OS (+ a pinned Home). Order and
// names match the product structure: Sales → Finance → HR → Team.
export const NAV = [
  { group: 'Workspace', pinned: true, items: [
    { slug: 'home', label: 'Home', icon: 'LayoutDashboard', href: '/home' },
    { slug: 'docs', label: 'Docs', icon: 'FileText', href: '/docs' },
    // Files sits beside Docs, not under Settings: it is a place to work, and
    // its whole value is that uploaded documents become searchable rows in the
    // same database as the ledger.
    { slug: 'files', label: 'Files', icon: 'FolderOpen', href: '/files' },
    // Maps sits with Docs and Files: it is a place to think, not a module of
    // the business. Free-form canvas, so it belongs to no pillar.
    { slug: 'maps', label: 'Maps', icon: 'Waypoints', href: '/maps' },
    { slug: 'pdf', label: 'PDF tools', icon: 'FileStack', href: '/pdf' },
    // Beside the PDF tools rather than under Marketing: it is a utility, not a
    // campaign — the thing it most often encodes is a link somebody already has.
    { slug: 'qr', label: 'QR codes', icon: 'QrCode', href: '/qr' },
  ]},
  { group: 'Sales', items: [
    { slug: 'deals', label: 'Deals', icon: 'Target', href: '/pipelines/sales/board' },
    { slug: 'companies', label: 'Companies', icon: 'Building2', href: '/objects/companies' },
    { slug: 'people', label: 'People', icon: 'Users', href: '/objects/people' },
    { slug: 'products', label: 'Products', icon: 'Package', href: '/objects/products' },
    { slug: 'offers', label: 'Offers', icon: 'FileText', href: '/objects/offers' },
  ]},
  { group: 'Finance', items: [
    { slug: 'finance', label: 'Overview', icon: 'TrendingUp', href: '/finance/overview' },
    { slug: 'transactions', label: 'Transactions', icon: 'ArrowLeftRight', href: '/finance/transactions' },
    { slug: 'invoices', label: 'Invoices', icon: 'Receipt', href: '/objects/invoices' },
    { slug: 'expenses', label: 'Expenses', icon: 'Wallet', href: '/objects/expenses' },
    { slug: 'sign', label: 'Signatures', icon: 'PenLine', href: '/finance/sign' },
  ]},
  { group: 'Marketing', items: [
    { slug: 'marketing', label: 'Overview', icon: 'Megaphone', href: '/marketing/overview' },
    { slug: 'campaigns', label: 'Campaigns', icon: 'Rocket', href: '/objects/campaigns' },
    { slug: 'posts', label: 'Posts', icon: 'PenSquare', href: '/marketing/posts' },
    { slug: 'newsletters', label: 'Newsletters', icon: 'Mail', href: '/marketing/newsletters' },
    { slug: 'forms', label: 'Forms', icon: 'FileInput', href: '/marketing/forms' },
    { slug: 'links', label: 'Short links', icon: 'Link2', href: '/marketing/links' },
    { slug: 'webanalytics', label: 'Web analytics', icon: 'Globe', href: '/marketing/analytics' },
    { slug: 'sources', label: 'Source tracking', icon: 'Radio', href: '/dashboard/sources' },
  ]},
  { group: 'HR', items: [
    { slug: 'hr-overview', label: 'Overview', icon: 'LayoutDashboard', href: '/dashboard/overview' },
    { slug: 'candidates', label: 'Candidates', icon: 'Users', href: '/dashboard/candidates' },
    { slug: 'pipeline', label: 'Hiring pipeline', icon: 'Columns3', href: '/dashboard/pipeline' },
    { slug: 'positions', label: 'Positions', icon: 'Briefcase', href: '/dashboard/positions' },
    // Careers page lives in HR, next to the roles it publishes — it is a
    // hiring surface, not a settings screen. Its look comes from Settings →
    // Branding so there is still only one place to define the brand.
    { slug: 'careers', label: 'Careers page', icon: 'Globe2', href: '/dashboard/careers' },
    { slug: 'treasury', label: 'Talent Treasury', icon: 'Sparkles', href: '/dashboard/treasury' },
    { slug: 'interviews', label: 'Interviews', icon: 'Calendar', href: '/dashboard/interviews' },
    { slug: 'templates', label: 'Email templates', icon: 'Mail', href: '/dashboard/templates' },
    { slug: 'analytics', label: 'Analytics', icon: 'BarChart3', href: '/dashboard/analytics' },
  ]},
  { group: 'Projects', items: [
    { slug: 'projects', label: 'Projects', icon: 'FolderKanban', href: '/objects/projects' },
    { slug: 'issues', label: 'Issues', icon: 'ListTodo', href: '/objects/issues' },
    { slug: 'roadmap', label: 'Roadmap', icon: 'GanttChartSquare', href: '/projects/roadmap' },
    { slug: 'board', label: 'Board', icon: 'Columns3', href: '/projects/board' },
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
    { slug: 'my-team', label: 'My Team', icon: 'Heart', href: '/dashboard/my-team' },
    { slug: 'assets', label: 'Assets', icon: 'Laptop', href: '/objects/assets' },
  ]},
  // Settings splits by WHO a change affects: everything here changes the
  // workspace for everyone in it…
  { group: 'Settings', items: [
    { slug: 'branding', label: 'Branding', icon: 'Palette', href: '/settings/branding' },
    { slug: 'objects', label: 'Objects', icon: 'Table2', href: '/settings/objects' },
    { slug: 'members', label: 'Members & roles', icon: 'ShieldCheck', href: '/settings/members' },
    { slug: 'plans', label: 'Plans & billing', icon: 'CreditCard', href: '/settings/plans' },
    { slug: 'integrations', label: 'Integrations', icon: 'Plug', href: '/settings/integrations' },
    { slug: 'reports', label: 'Reports', icon: 'FileBarChart', href: '/settings/reports' },
    // Last, because it is the one you visit twice a year — but it belongs to the
    // workspace, not to a person, so it is here rather than under Account.
    { slug: 'updates', label: 'Updates', icon: 'Rocket', href: '/settings/updates' },
  ]},
  // …and everything here is yours alone.
  { group: 'Account', items: [
    { slug: 'ai-keys', label: 'AI keys', icon: 'Sparkles', href: '/settings/ai' },
    { slug: 'assistant', label: 'Assistant', icon: 'MessageCircle', href: '/settings/assistant' },
  ]},
];
