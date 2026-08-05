/**
 * What is configured on this instance, and what stays broken while it isn't.
 *
 * THE ONE LIST. The setup screen, the docs table and this file used to be three
 * separate accounts of the same thing, which is how a dashboard full of
 * variables becomes impossible to audit: half of them are read by nothing, some
 * are read under a different name, and the only way to find out is to break
 * something. Everything here is checked against `process.env` on the server at
 * request time, so it reports the values the running process actually has.
 *
 * VALUES ARE NEVER RETURNED — only whether something is set. A screen that
 * shows "sk_live_…4f2" to confirm a key is right is a screen that shows a key.
 */

export type CheckLevel = 'required' | 'recommended' | 'feature';

export interface SetupCheck {
  key: string;
  group: string;
  level: CheckLevel;
  /** What works once it is set. */
  enables: string;
  /** What is broken while it is missing. Written to be actionable, not scary. */
  breaks: string;
  /** Some features need several variables; the whole group is off without all of them. */
  needsAlso?: string[];
}

export const SETUP_CHECKS: SetupCheck[] = [
  // ── Required ──────────────────────────────────────────────────────────────
  {
    key: 'NEXT_PUBLIC_SUPABASE_URL', group: 'Core', level: 'required',
    enables: 'The database connection',
    breaks: 'Nothing loads at all.',
  },
  {
    key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', group: 'Core', level: 'required',
    enables: 'The database connection',
    breaks: 'Nothing loads at all.',
  },
  {
    key: 'SUPABASE_SERVICE_ROLE_KEY', group: 'Core', level: 'required',
    enables: 'Every authenticated read and write, through /api/rpc',
    breaks: 'No data path. Also the value the cron jobs send as x-cron-secret.',
  },
  {
    key: 'NEXT_PUBLIC_PRIVY_APP_ID', group: 'Core', level: 'required',
    enables: 'Sign-in',
    breaks: 'Nobody can log in, and the build cannot prerender pages.',
  },

  // ── Recommended ───────────────────────────────────────────────────────────
  {
    key: 'NEXT_PUBLIC_SITE_URL', group: 'Core', level: 'recommended',
    enables: 'Correct links in email, short links and OAuth redirects',
    breaks: 'Unsubscribe and tracking links point at the wrong host; social OAuth grants land somewhere you do not control.',
  },
  {
    key: 'SECRETS_MASTER_KEY', group: 'Core', level: 'recommended',
    enables: 'A stable key for sealing AI keys and integration tokens',
    breaks: 'Falls back to a key derived from the service-role key — so rotating that key, or moving Supabase project, makes every sealed secret undecryptable.',
  },
  {
    key: 'CRON_SECRET', group: 'Core', level: 'recommended',
    enables: 'The invoice-reminder and Excel sweeps',
    breaks: 'Those two endpoints refuse to run. An unauthenticated URL that emails your customers is not a safe default.',
  },

  // ── Features ──────────────────────────────────────────────────────────────
  {
    key: 'RESEND_API_KEY', group: 'Email', level: 'feature',
    enables: 'All outgoing email — newsletters, reminders, candidate mail',
    breaks: 'Nothing is emailed. The UI still lets you compose.',
  },
  {
    key: 'RESEND_WEBHOOK_SECRET', group: 'Email', level: 'feature',
    enables: 'Bounce and complaint handling',
    breaks: 'Bounces never suppress, so you keep mailing dead addresses — which is how a sending domain gets burned.',
  },
  {
    key: 'STRIPE_SECRET_KEY', group: 'Billing', level: 'feature',
    enables: 'Checkout',
    breaks: 'Checkout returns 503 and the plan pages do nothing.',
  },
  {
    key: 'STRIPE_WEBHOOK_SECRET', group: 'Billing', level: 'feature',
    enables: 'Upgrading a plan after payment',
    breaks: 'THE customer pays at Stripe and their plan never changes — silently. This is the only thing that writes the new plan.',
  },
  {
    key: 'NEXT_PUBLIC_STRIPE_TEAM_PRICE_ID', group: 'Billing', level: 'feature',
    enables: 'Selling the Team plan',
    breaks: 'The Team button is inert (the old NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID is still read as a fallback).',
  },
  {
    key: 'NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID', group: 'Billing', level: 'feature',
    enables: 'Selling the Business plan',
    breaks: 'The Business button is inert (the old NEXT_PUBLIC_STRIPE_PRO_PRICE_ID is still read as a fallback).',
  },
  {
    key: 'GOOGLE_CLIENT_ID', group: 'Calendar', level: 'feature',
    enables: 'Interview scheduling in Google Calendar',
    breaks: 'Recruiters cannot connect a calendar; interviews are still recorded in the app.',
    needsAlso: ['GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'],
  },
  {
    key: 'LINKEDIN_CLIENT_ID', group: 'Social publishing', level: 'feature',
    enables: 'Publishing to LinkedIn',
    breaks: 'Posts can be written and scheduled but never leave.',
    needsAlso: ['LINKEDIN_CLIENT_SECRET'],
  },
  {
    key: 'X_CLIENT_ID', group: 'Social publishing', level: 'feature',
    enables: 'Publishing to X',
    breaks: 'Posts can be written and scheduled but never leave.',
    needsAlso: ['X_CLIENT_SECRET'],
  },
  {
    key: 'MS_CLIENT_ID', group: 'Excel sync', level: 'feature',
    enables: 'Two-way sync with a workbook in OneDrive or SharePoint',
    breaks: 'Only the read-only CSV feed works — which needs nothing but an API key.',
    needsAlso: ['MS_CLIENT_SECRET'],
  },
  {
    key: 'NEXT_PUBLIC_ANALYTICS_SITE_ID', group: 'Analytics', level: 'feature',
    enables: 'This site reporting into its own analytics',
    breaks: 'Your own marketing pages are not tracked. Customer sites are unaffected.',
  },
  {
    key: 'MINERU_URL', group: 'Files', level: 'feature',
    enables: 'OCR for scanned documents',
    breaks: 'Scans are stored with no searchable text. Normal PDFs and Word files are extracted locally regardless.',
  },
];

/** Variables nothing in this codebase reads. Left over from earlier stacks. */
export const OBSOLETE_KEYS = [
  'NEXTAUTH_SECRET', 'NEXTAUTH_URL',            // never used; auth is Privy
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', // email is Resend's API
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',         // checkout redirects server-side
  'NEXT_PUBLIC_APP_NAME',                       // the name comes from Branding
  'DIRECT_URL',                                 // a Prisma convention; there is no Prisma here
];

export interface CheckResult extends SetupCheck { present: boolean; missingAlso: string[] }

/** Server-side only: reads process.env. Returns booleans, never values. */
export function runSetupChecks(): CheckResult[] {
  const has = (k: string) => {
    const v = process.env[k];
    return !!v && v.trim() !== '' && v.trim().toLowerCase() !== 'value';
  };
  return SETUP_CHECKS.map((c) => ({
    ...c,
    // The Stripe price ids moved names; an instance still on the old ones is
    // configured, and saying otherwise would send someone to fix what works.
    present: has(c.key) || !!LEGACY_ALIAS[c.key]?.some(has),
    missingAlso: (c.needsAlso || []).filter((k) => !has(k)),
  }));
}

const LEGACY_ALIAS: Record<string, string[]> = {
  NEXT_PUBLIC_STRIPE_TEAM_PRICE_ID: ['NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID'],
  NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID: ['NEXT_PUBLIC_STRIPE_PRO_PRICE_ID'],
  SECRETS_MASTER_KEY: ['KSEF_MASTER_KEY'],
  NEXT_PUBLIC_SITE_URL: ['NEXT_PUBLIC_APP_URL'],
};

export function obsoletePresent(): string[] {
  return OBSOLETE_KEYS.filter((k) => {
    const v = process.env[k];
    return !!v && v.trim() !== '' && v.trim().toLowerCase() !== 'value';
  });
}
