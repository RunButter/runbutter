// Object registry — the single source of truth the generic RecordTable/views read
// to render any object without bespoke code. Backed by `object_fields` for custom
// fields later; these are the built-in core columns.
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
  },
  companies: {
    slug: 'companies', singular: 'Company', plural: 'Companies', icon: 'Building2', type: 'company',
    fields: [
      { key: 'name', label: 'Name', type: 'avatar', primary: true, width: 240 },
      { key: 'domain', label: 'Domain', type: 'text', width: 200 },
      { key: 'industry', label: 'Industry', type: 'text', width: 180 },
      { key: 'employee_count', label: 'Employees', type: 'number', align: 'right', width: 120 },
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
  },
};

// One nav over the whole platform. The CRM core (Records/Sales) is new; the
// HR·Recruitment group reuses the EXISTING, shipped ATS pages under /dashboard —
// nothing is thrown away, the ATS is simply Module 1 of the Business-OS.
export const NAV = [
  { group: 'Workspace', items: [
    { slug: 'home', label: 'Home', icon: 'LayoutDashboard', href: '/home' },
  ]},
  { group: 'Records', items: [
    { slug: 'people', label: 'People', icon: 'Users', href: '/objects/people' },
    { slug: 'companies', label: 'Companies', icon: 'Building2', href: '/objects/companies' },
  ]},
  { group: 'Sales', items: [
    { slug: 'sales', label: 'Sales pipeline', icon: 'TrendingUp', href: '/pipelines/sales/board' },
  ]},
  { group: 'HR · Recruitment', items: [
    { slug: 'candidates', label: 'Candidates', icon: 'Users', href: '/dashboard/candidates' },
    { slug: 'pipeline', label: 'Hiring pipeline', icon: 'Columns3', href: '/dashboard/pipeline' },
    { slug: 'positions', label: 'Positions', icon: 'Briefcase', href: '/dashboard/positions' },
    { slug: 'treasury', label: 'Talent Treasury', icon: 'Sparkles', href: '/dashboard/treasury' },
    { slug: 'interviews', label: 'Interviews', icon: 'Calendar', href: '/dashboard/interviews' },
    { slug: 'sources', label: 'Source tracking', icon: 'Radio', href: '/dashboard/sources' },
    { slug: 'templates', label: 'Email templates', icon: 'Mail', href: '/dashboard/templates' },
    { slug: 'analytics', label: 'Analytics', icon: 'BarChart3', href: '/dashboard/analytics' },
  ]},
  { group: 'Team · HRIS', items: [
    { slug: 'my-team', label: 'My Team', icon: 'Heart', href: '/dashboard/my-team' },
    { slug: 'directory', label: 'Directory', icon: 'Users', href: '/hris/directory' },
    { slug: 'assets', label: 'Assets', icon: 'Laptop', href: '/objects/assets' },
  ]},
];
