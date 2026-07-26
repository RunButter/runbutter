// Email hygiene — catch undeliverable and throwaway addresses before they enter
// the CRM and before Resend tries to mail them.
//
// WHY THIS AND NOT A VERIFICATION API: the paid services bundle four checks —
// syntax, disposable-domain, role-address, and MX. Three are pure string work,
// and the fourth is a DNS query the server can make itself in a few
// milliseconds. Their free tiers cap out around 100-1000/month, which a public
// lead form burns through quickly, and every lookup ships a prospect's address
// to a third party. All of it is local here.
//
// The honest limit: MX proves a domain ACCEPTS mail, not that the mailbox
// exists. Only SMTP probing tells you that, and it gets you blocklisted. Bounce
// rate is still the ground truth — this just removes the obvious garbage that
// wrecks sender reputation.

import { DISPOSABLE_DOMAINS } from './disposable-domains';

// Deliberately practical rather than RFC 5322-complete. The full grammar allows
// quoted strings and comments that no real signup form ever receives, and
// implementations that chase it reject valid everyday addresses.
const SYNTAX = /^[^\s@,;:<>()[\]\\"]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

// Mailbox names that belong to a function, not a person. Not invalid — but they
// skew reply rates and often forward to a whole team, so they're worth marking.
const ROLE_LOCALS = new Set([
  'abuse', 'admin', 'administrator', 'billing', 'careers', 'compliance', 'contact',
  'enquiries', 'enquiry', 'help', 'hello', 'hr', 'info', 'inquiries', 'invoice',
  'invoices', 'jobs', 'legal', 'mail', 'marketing', 'noreply', 'no-reply', 'office',
  'postmaster', 'privacy', 'recruitment', 'sales', 'security', 'support', 'team',
  'webmaster',
]);

// Domains typo'd often enough to be worth suggesting a fix for.
const COMMON_DOMAINS = [
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'aol.com', 'proton.me',
  'protonmail.com', 'gmx.de', 'gmx.net', 'web.de', 't-online.de', 'wp.pl', 'o2.pl',
  'interia.pl', 'onet.pl', 'op.pl', 'seznam.cz', 'orange.fr', 'free.fr', 'libero.it',
];

export type EmailIssue = 'empty' | 'syntax' | 'disposable' | 'role' | 'typo' | 'no_mx' | 'mx_unknown';

export interface EmailAnalysis {
  /** Lowercased, trimmed. Store this. */
  normalized: string;
  local: string;
  domain: string;
  /** Structurally parseable — a prerequisite for everything else. */
  validSyntax: boolean;
  disposable: boolean;
  role: boolean;
  /** Set when the domain is one edit away from a well-known provider. */
  suggestion: string | null;
  issues: EmailIssue[];
}

/** Damerau-Levenshtein, capped: we only care about distances of 1-2. */
function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let prevPrev: number[] = [];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      // transposition ("gmail" ← "gmial")
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prevPrev[j - 2] + 1);
      }
      row.push(v);
    }
    prevPrev = prev.slice();
    for (let k = 0; k <= b.length; k++) prev[k] = row[k];
  }
  return prev[b.length];
}

/** "did you mean gmail.com?" — null when the domain is fine or too far off. */
export function suggestDomain(domain: string): string | null {
  if (!domain || COMMON_DOMAINS.includes(domain)) return null;
  let best: string | null = null;
  let bestScore = 3;
  for (const candidate of COMMON_DOMAINS) {
    const d = editDistance(domain, candidate);
    if (d < bestScore) { bestScore = d; best = candidate; }
  }
  // Distance 1 is a confident typo. Distance 2 only for longer domains, or
  // "wp.pl" would suggest a fix for every other two-letter domain.
  if (bestScore === 1) return best;
  if (bestScore === 2 && domain.length >= 8) return best;
  return null;
}

/** Everything checkable without touching the network. */
export function analyzeEmail(input: string): EmailAnalysis {
  const normalized = String(input || '').trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  const local = at > 0 ? normalized.slice(0, at) : '';
  const domain = at > 0 ? normalized.slice(at + 1) : '';
  const issues: EmailIssue[] = [];

  if (!normalized) issues.push('empty');
  const validSyntax = !!normalized && SYNTAX.test(normalized);
  if (normalized && !validSyntax) issues.push('syntax');

  const disposable = validSyntax && DISPOSABLE_DOMAINS.has(domain);
  if (disposable) issues.push('disposable');

  const role = validSyntax && ROLE_LOCALS.has(local);
  if (role) issues.push('role');

  const suggestion = validSyntax ? suggestDomain(domain) : null;
  if (suggestion) issues.push('typo');

  return { normalized, local, domain, validSyntax, disposable, role, suggestion, issues };
}

export type MxVerdict = 'has_mx' | 'no_mx' | 'unknown';

/**
 * Does this domain accept mail at all? SERVER ONLY — imports node:dns.
 *
 * Fails OPEN. A DNS timeout or SERVFAIL means we don't know, and turning away a
 * real lead because a resolver hiccuped is far worse than accepting a bad
 * address. Only NXDOMAIN / no-records — a definitive "this domain cannot
 * receive mail" — returns 'no_mx'.
 */
export async function lookupMx(domain: string, timeoutMs = 3000): Promise<MxVerdict> {
  if (!domain) return 'unknown';
  const dns = await import('node:dns');
  const resolver = new dns.promises.Resolver({ timeout: timeoutMs, tries: 2 });

  try {
    const records = await resolver.resolveMx(domain);
    if (records.length > 0) return 'has_mx';
  } catch (e: any) {
    // NOTFOUND/NODATA are answers, not failures — fall through to the A-record
    // check. Anything else (timeout, SERVFAIL, refused) is genuinely unknown.
    if (e?.code !== 'ENOTFOUND' && e?.code !== 'ENODATA') return 'unknown';
  }

  // A domain with no MX but an A record still accepts mail per RFC 5321 §5.1 —
  // small self-hosted domains rely on this, and treating them as undeliverable
  // would reject legitimate business addresses.
  try {
    const a = await resolver.resolve4(domain);
    return a.length > 0 ? 'has_mx' : 'no_mx';
  } catch (e: any) {
    if (e?.code === 'ENOTFOUND' || e?.code === 'ENODATA') return 'no_mx';
    return 'unknown';
  }
}

export interface EmailVerdict extends EmailAnalysis {
  mx: MxVerdict;
  /** Hard failure: refuse the submission. */
  undeliverable: boolean;
  /** Accept, but worth surfacing to the workspace. */
  suspicious: boolean;
  /** Safe to show a submitter. */
  message: string;
}

/** Full check, syntax + DNS. Server only. */
export async function verifyEmail(input: string): Promise<EmailVerdict> {
  const a = analyzeEmail(input);
  if (!a.validSyntax) {
    return {
      ...a, mx: 'unknown', undeliverable: true, suspicious: false,
      message: a.issues.includes('empty') ? 'Enter an email address.' : 'That email address is not valid.',
    };
  }

  const mx = await lookupMx(a.domain);
  if (mx === 'no_mx') a.issues.push('no_mx');
  else if (mx === 'unknown') a.issues.push('mx_unknown');

  const undeliverable = mx === 'no_mx';
  return {
    ...a, mx, undeliverable,
    suspicious: !undeliverable && (a.disposable || a.role),
    message: undeliverable
      ? (a.suggestion
          ? `“${a.domain}” doesn’t receive email. Did you mean ${a.suggestion}?`
          : `“${a.domain}” doesn’t receive email — please check the address.`)
      : a.suggestion
        ? `Did you mean ${a.local}@${a.suggestion}?`
        : '',
  };
}
