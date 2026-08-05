/**
 * The legacy files, in dependency order.
 *
 * Hardcoded rather than sorted, because these predate any naming convention and
 * alphabetical order is wrong: the schema has to exist before anything alters
 * it. This list is the only written record of that order.
 *
 * It lives in its own module because TWO things need it — the migration runner
 * and the single-file bundler — and a second copy is a second thing to forget
 * when a file is added. A bundle built in the wrong order fails on a stranger's
 * machine, which is the worst place to find out.
 */
export const LEGACY_ORDER = [
  'supabase-schema.sql',
  'migration.sql',
  'security-migration.sql',
  'screening-migration.sql',
  'neuro-profile-migration.sql',
  'fix-assessment-schema.sql',
  'fix-assessment-and-visibility.sql',
  'fix-company-branding-visibility.sql',
  'fix-logo-storage-rls.sql',
  'create-contact-table.sql',
  'add-gdpr.sql',
  'add-message-templates.sql',
  'add-my-team.sql',
  'add-resume-search.sql',
  'add-source-attribution.sql',
  'add-treasury-dataset.sql',
  'add-webhooks.sql',
];
