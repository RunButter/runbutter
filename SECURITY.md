# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Email
**hello@hirebtr.com** with the details (steps to reproduce, impact, affected
endpoint or file). You'll get an acknowledgement within 72 hours and a fix or
mitigation plan within 14 days for anything that exposes tenant data.

## Scope

- The application code in this repository (API routes, RPC proxy, automations
  dispatcher, MCP server, SQL functions in `supabase/`).
- The hosted instance at hirebtr.com.

Out of scope: denial-of-service volumetrics, issues requiring a victim's
device, and vulnerabilities in third-party services themselves (Supabase,
Privy, Stripe, Resend) — report those upstream.

## Handling of data

- Never include real customer data in reports; use your own test workspace.
- Workspace AI keys and integration secrets are AES-256-GCM encrypted at rest;
  if you find a path that returns them decrypted to a browser, that is a
  critical finding — report it immediately.
