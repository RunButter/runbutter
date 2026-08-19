/**
 * The docs table of contents.
 *
 * Hand-ordered rather than derived from the directory listing: "install before
 * architecture" is an editorial decision and alphabetical order would put
 * `agents` first, in front of the page that tells you how to run the thing at
 * all.
 *
 * `slug` is the file in docs/ without .md, and also the URL. Anything in docs/
 * that is not listed here is still reachable by URL — the page reads the file —
 * it simply does not appear in the sidebar.
 */
export interface DocLink { slug: string; title: string; blurb?: string }
export interface DocSection { group: string; items: DocLink[] }

export const DOCS_NAV: DocSection[] = [
  {
    group: 'Getting started',
    items: [
      { slug: 'index', title: 'Overview', blurb: 'What this is and how it fits together' },
      { slug: 'install', title: 'Install', blurb: 'Docker, Supabase, or one SQL file' },
      { slug: 'configuration', title: 'Configuration', blurb: 'Every variable and what it switches on' },
      { slug: 'going-live', title: 'Going live', blurb: 'Cron, Stripe, email, secrets — step by step' },
      { slug: 'updating', title: 'Updating', blurb: 'New code, then new schema' },
    ],
  },
  {
    group: 'Building on it',
    items: [
      { slug: 'architecture', title: 'Architecture', blurb: 'One database, one door' },
      { slug: 'custom-objects', title: 'Custom objects', blurb: 'Track what your business actually has' },
      { slug: 'agents', title: 'Agents', blurb: 'Roles, tools, and what bounds them' },
      { slug: 'api', title: 'REST API & MCP', blurb: 'Keys, scopes, and the CSV feed' },
      { slug: 'file-extraction', title: 'Files that become data', blurb: 'Extraction and full-text search' },
      { slug: 'vault', title: 'The team vault', blurb: 'Shared logins your own server cannot read' },
      { slug: 'design', title: 'The design spec', blurb: 'Your brand, in a shape an AI applies exactly' },
    ],
  },
  {
    group: 'Project',
    items: [
      { slug: 'roadmap', title: 'Roadmap', blurb: 'Shipped, next, and declined' },
      { slug: 'contributing', title: 'Contributing', blurb: 'Conventions worth knowing first' },
      { slug: 'support', title: 'Support & bugs', blurb: 'How to report something' },
    ],
  },
  {
    group: 'Optional extras',
    items: [
      { slug: 'umami-analytics', title: 'Umami analytics', blurb: 'Only if you need session metrics' },
      { slug: 'umami-deploy', title: 'Deploying Umami', blurb: 'Read the first paragraph first' },
    ],
  },
];

export const ALL_DOC_SLUGS = DOCS_NAV.flatMap((s) => s.items.map((i) => i.slug));

export const docTitle = (slug: string) =>
  DOCS_NAV.flatMap((s) => s.items).find((i) => i.slug === slug)?.title;
