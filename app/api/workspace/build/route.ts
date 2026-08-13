import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { openSecret } from '@/lib/crypto/secrets';
import { callAI, defaultModel, type AIProvider } from '@/lib/ai/providers';
import { recordAIUsage } from '@/lib/ai/usage';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
// FIELD_TYPES and the icon vocabulary come from blueprint.ts, not from
// lib/crm/custom.ts — that one is `use client` and pulls in the browser
// Supabase client, which breaks a route handler at page-data collection.
import { normalizeBlueprint, FIELD_TYPES, OBJECT_ICON_NAMES } from '@/lib/workspace/blueprint';
import { WORKSPACE_TEMPLATES } from '@/lib/workspace/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/workspace/build  { privyUserId, workspaceId, description }
 *
 * Turns a description of a business into a PLAN — a blueprint of objects and
 * fields — and returns it. IT CREATES NOTHING. The browser shows the plan, a
 * person reads it, and applying it is a separate act made of ordinary
 * save_custom_object / save_custom_field calls.
 *
 * THAT SEPARATION IS THE SECURITY MODEL, not a UX preference. The description
 * is untrusted text, and so is anything a model does with it. Because the reply
 * is only ever parsed as a blueprint, and every value is re-validated against
 * the same whitelist the database enforces, the worst a prompt injection
 * achieves is a silly plan a human declines. It has no path to a write.
 *
 * Runs on the workspace's own AI key — the user funds it, so there is no
 * platform token cost, and no key means the templates rather than an upsell.
 */

const SYSTEM = `You design database schemas for small businesses using RunButter, a company OS.

RunButter ALREADY HAS these objects built in, wired to invoicing, pipelines, projects and agents:
companies, people, invoices, offers, expenses, transactions, products, campaigns,
projects, issues, assets, candidates, positions, documents, files.

Your job is to add ONLY what this particular business tracks that a general business does not.
Never recreate a built-in. If they mention customers, that is "companies". If they mention
staff or contacts, that is "people". If they mention bills or quotes, those are invoices and
offers. Link to a built-in with a relation field instead of duplicating it.

Reply with ONLY a JSON object, no prose and no code fence:
{
  "summary": "one line about what this adds",
  "objects": [{
    "singular": "Vehicle", "plural": "Vehicles", "slug": "vehicles",
    "group": "Fleet", "icon": "Truck", "description": "short",
    "fields": [
      { "label": "Plate", "key": "plate", "type": "text", "primary": true, "required": true },
      { "label": "Status", "key": "status", "type": "select", "options": ["active","sold"] },
      { "label": "Customer", "key": "customer", "type": "relation", "relation_to": "companies" }
    ]
  }]
}

Rules:
- field types are exactly: ${FIELD_TYPES.join(', ')}
- "relation" needs "relation_to": a built-in slug or another slug in this same plan
- exactly one field per object has "primary": true — the one the record is called by
- slugs and keys are lowercase with underscores
- at most 4 objects, at most 10 fields each. Fewer, well chosen, is better.
- money is "currency"; a yes/no is "checkbox"; a fixed set of values is "select" with options
- "icon" is one of exactly these, or omitted: ${OBJECT_ICON_NAMES.join(', ')}`;

/** Two real templates as few-shot examples, so the model matches their taste. */
function examples(): string {
  return WORKSPACE_TEMPLATES.slice(0, 2).map((t) =>
    `Business: ${t.audience}\n${JSON.stringify(t.blueprint)}`).join('\n\n');
}


const BUILD_MAX_TOKENS = 4096;

/**
 * Pull the JSON out of a reply.
 *
 * Models wrap JSON in fences and add a sentence before it however firmly they
 * are told not to, so the first `{` to the last `}` is the reliable read. A
 * reply with no JSON at all is a plain failure with the model's own words
 * shown, which is more useful than "could not parse".
 */
function extractJson(reply: string): any | null {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(reply.slice(start, end + 1)); } catch { return null; }
}

export async function POST(req: Request) {
  const rl = rateLimit(`wsbuild:${clientIp(req)}`, 10);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { privyUserId, workspaceId, description } = b || {};
  if (!privyUserId || !workspaceId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const text = String(description || '').trim().slice(0, 4000);
  if (!text) return NextResponse.json({ error: 'Describe the business first.' }, { status: 400 });

  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

  const admin = createAdminClient();
  const { data: secret, error } = await admin.rpc('get_ai_secret', { p_privy: privyUserId, p_workspace: workspaceId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!secret) {
    return NextResponse.json({
      error: 'No AI provider configured. Add a key in Account → AI keys, or start from one of the trade templates below.',
    }, { status: 400 });
  }

  let apiKey: string;
  try { apiKey = openSecret((secret as any).cipher, (secret as any).iv, (secret as any).tag); }
  catch { return NextResponse.json({ error: 'Could not decrypt the stored key (was SECRETS_MASTER_KEY changed?).' }, { status: 500 }); }

  const provider = (secret as any).provider as AIProvider;
  const model = (secret as any).model || defaultModel(provider);

  const usageRow = { workspace: workspaceId, privy: privyUserId, feature: 'workspace' as const, provider, model };
  let reply: string;
  try {
    const out = await callAI(
      provider, apiKey, model, SYSTEM,
      `${examples()}\n\nBusiness: ${text}\n`,
      (secret as any).base_url || undefined,
      // A blueprint is up to 4 objects of 10 fields each as JSON, and a
      // reasoning model spends output tokens thinking before it writes any of
      // it. At the 2048 default that ran out mid-object and surfaced as "the
      // model did not return a plan", which blamed the description.
      BUILD_MAX_TOKENS,
    );
    reply = out.text;
    await recordAIUsage(admin, { ...usageRow, usage: out.usage });
  } catch (e: any) {
    await recordAIUsage(admin, { ...usageRow, usage: { input: 0, output: 0, cached: 0 }, ok: false });
    // A truncated reply explains itself and is the user's to act on (pick a
    // different model, ask for less) — not a 502, which reads as our outage.
    const truncated = e?.name === 'TruncatedReply';
    return NextResponse.json(
      { error: e?.message || 'The AI request failed.' },
      { status: truncated ? 422 : 502 },
    );
  }

  const raw = extractJson(reply);
  if (!raw) {
    return NextResponse.json({
      // Says what actually happened. The old text advised rewording the
      // description, which cannot help when the reply was empty or was JSON the
      // parser could not read.
      error: reply.trim()
        ? 'The model replied, but not with a plan it could read. Try a different model — some are much better at returning strict JSON.'
        : 'The model returned nothing at all. Check the key and model name in Account → AI keys.',
      detail: reply.slice(0, 300),
    }, { status: 422 });
  }

  // Every value re-validated here, against the same whitelist the database
  // enforces. Anything unusable is dropped and REPORTED — a plan that quietly
  // loses half its fields is worse than one that says what it could not use.
  const { blueprint, warnings } = normalizeBlueprint(raw);
  if (!blueprint.objects.length) {
    return NextResponse.json({
      error: 'That produced nothing usable — every object was a built-in or was missing a name.',
      warnings,
    }, { status: 422 });
  }

  return NextResponse.json({ ok: true, blueprint, warnings, provider, model });
}
