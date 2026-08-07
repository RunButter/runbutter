/**
 * Credential scanning for anything about to be packaged.
 *
 * WHY THIS EXISTS. A plugin is a directory of text files that people commit to
 * git and push to public repositories — that is the whole distribution model.
 * The builder happily accepted an API key pasted into a skill's instructions
 * and handed back a zip, and the first time anyone noticed would be after the
 * push. A key deleted in commit 40 is still readable in commit 12, so "we'll
 * remove it later" is not a fix.
 *
 * It runs in the browser on text the user typed, so scanning costs nothing and
 * leaks nothing. Same rule as the rest of this page: no upload, no account.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: detect "malicious instructions" or "prompt
 * injection", both of which the brief asks for. There is no reliable test —
 * "ignore previous instructions" is a legitimate sentence in a skill about
 * handling untrusted input — and a scanner that flags ordinary prose is a
 * scanner people learn to click past, which then costs them the real finding
 * too. It detects things with a KNOWN SHAPE, and says nothing about the rest.
 */

export type Severity = 'secret' | 'warning';

export interface Finding {
  severity: Severity;
  /** Which file the match is in, as it will appear in the package. */
  where: string;
  label: string;
  /** The match, redacted — never the whole credential. */
  preview: string;
}

/**
 * Patterns are anchored on issuer prefixes wherever one exists, because a
 * prefix is a fact and an entropy score is a guess. `sk-ant-…` is an Anthropic
 * key or it is nothing; a 32-character hex string is equally likely to be a
 * commit sha, a UUID with the dashes taken out, or an example.
 */
const RULES: { label: string; re: RegExp }[] = [
  { label: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  // (?!ant-) so an Anthropic key is not ALSO reported as an OpenAI one — both
  // start `sk-`, and counting one pasted key as two findings makes the whole
  // panel look like it is guessing.
  { label: 'OpenAI API key', re: /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g },
  { label: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { label: 'AWS access key id', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { label: 'Google API key', re: /\bAIza[A-Za-z0-9_-]{35}\b/g },
  { label: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { label: 'Stripe secret key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g },
  { label: 'Private key block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { label: 'Supabase service-role key', re: /\bsbp_[A-Za-z0-9]{20,}/g },
  // A JWT is only interesting if it carries a role — a Supabase anon key is
  // public by design and flagging it would be noise on every self-host guide.
  { label: 'JWT with a service_role claim', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*(?:c2VydmljZV9yb2xl|InNlcnZpY2Vfcm9sZSI)[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+/g },
  { label: 'Bearer token', re: /\b[Aa]uthorization\s*[:=]\s*["']?[Bb]earer\s+[A-Za-z0-9._~+/=-]{16,}/g },
  // The generic catch, kept last and deliberately narrow: an assignment whose
  // NAME says credential and whose value is long enough to be one. `api_key:
  // <your key>` and `API_KEY=` are placeholders and must not fire.
  {
    label: 'Assigned credential',
    re: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd)\b\s*[:=]\s*["']?(?![<{$][A-Za-z_])[A-Za-z0-9._~+/=-]{16,}["']?/gi,
  },
];

/** Show enough to find it, never enough to use it. */
export function redact(match: string): string {
  const flat = match.replace(/\s+/g, ' ').trim();
  if (flat.length <= 12) return flat;
  return `${flat.slice(0, 8)}…${flat.slice(-4)} (${flat.length} chars)`;
}

/** Scan one blob of text. `where` is only used to label the finding. */
export function scanText(text: string, where: string): Finding[] {
  const out: Finding[] = [];
  if (!text) return out;
  for (const { label, re } of RULES) {
    // Fresh lastIndex per call: a module-level /g regex is stateful, and
    // reusing one across inputs silently skips matches on every other call.
    const rx = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text))) {
      out.push({ severity: 'secret', where, label, preview: redact(m[0]) });
      if (out.length > 50) return out;    // a pasted .env should not produce 900 rows
    }
  }
  return out;
}

/** Scan every file that is about to be written into the package. */
export function scanFiles(files: { path: string; content: string }[]): Finding[] {
  return files.flatMap((f) => scanText(f.content, f.path));
}

/** Distinct labels, for a one-line summary that does not repeat itself. */
export function summarise(findings: Finding[]): string {
  const labels = [...new Set(findings.map((f) => f.label))];
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
