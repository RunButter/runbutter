import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { openSecret } from '@/lib/crypto/secrets';
import { callAI, defaultModel, type AIProvider } from '@/lib/ai/providers';
import { recordAIUsage } from '@/lib/ai/usage';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
// From lib/insights/spec.ts, which imports nothing — the same rule
// lib/workspace/blueprint.ts follows. Reaching into lib/crm/* here would pull a
// `use client` module into a route handler and break page-data collection.
import {
  normalizeSpec, FILTER_OPS, METRIC_FNS, CHART_KINDS,
  type SchemaObject,
} from '@/lib/insights/spec';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/insights/ask  { privyUserId, workspaceId, question, objects }
 *
 * Turns a question into a QUERY SPEC and returns it. IT READS NO BUSINESS DATA.
 *
 * The browser already holds the rows — it fetched them through `list_records`,
 * which is the tenancy-safe read this product trusts everywhere — so the model
 * is asked only which object, which filters and which grouping, and the answer
 * is computed locally. That means a prompt injection in a record cannot reach
 * this route, because no record ever gets here.
 *
 * It is the `/api/workspace/build` shape exactly: a model proposes, the reply is
 * re-validated against a whitelist, and a person sees what it decided before it
 * counts for anything. The difference is that a wrong blueprint creates tables
 * and a wrong spec draws a wrong bar chart — which is why the spec is displayed
 * and editable rather than hidden behind the number.
 *
 * Runs on the workspace's own AI key, like every other AI feature here.
 */

const ASK_MAX_TOKENS = 1024;

const SYSTEM = `You translate a business question into a QUERY SPEC for RunButter, a company OS.

You are given the objects available and their real columns. Reply with ONLY a JSON object,
no prose and no code fence:

{
  "object": "invoices",
  "title": "Unpaid invoices by client",
  "filters": [{ "field": "status", "op": "neq", "value": "paid" }],
  "groupBy": "company",
  "metric": { "fn": "sum", "field": "amount" },
  "chart": "bar",
  "sort": "value_desc",
  "limit": 12
}

Rules:
- "object" MUST be one of the slugs given. Pick the one that holds the answer.
- "field" in filters, "groupBy" and "metric.field" MUST be column keys of that object. Never invent one.
- ops: ${FILTER_OPS.join(', ')}. Use in_last_days with a number of days for "recently"/"this month".
- metric.fn: ${METRIC_FNS.join(', ')}. Use "count" for "how many". Use sum/avg/min/max ONLY on a
  number or currency column, and put that column in metric.field.
- chart: ${CHART_KINDS.join(', ')}. Use "number" when the answer is a single figure and there is no
  groupBy. Use "pie" only for a share of a whole with few categories. Otherwise "bar", or "line"
  when grouping by a date.
- groupBy null means one total across everything.
- If the question cannot be answered from these columns, still return your closest attempt and say
  so in "title". Do not invent columns to make it fit.`;

function extractJson(reply: string): any | null {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(reply.slice(start, end + 1)); } catch { return null; }
}

/**
 * The schemas come from the CLIENT, which sounds wrong and is not.
 *
 * They are field NAMES and TYPES, which the caller already has on screen, and
 * they are the same schema the caller then executes against locally. Lying here
 * gets you a chart of your own nothing. The alternative — deriving the object
 * list server-side — means importing `lib/crm/registry.ts` and
 * `lib/crm/custom.ts` into a route handler, and both are `use client`.
 *
 * Trimmed hard regardless: a workspace with forty custom objects would
 * otherwise send a prompt larger than the question deserves.
 */
function readSchemas(raw: any): SchemaObject[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o: any) => o && typeof o.slug === 'string' && Array.isArray(o.fields))
    .slice(0, 40)
    .map((o: any) => ({
      slug: String(o.slug).slice(0, 60),
      plural: String(o.plural || o.slug).slice(0, 60),
      fields: o.fields
        .filter((f: any) => f && typeof f.key === 'string')
        .slice(0, 40)
        .map((f: any) => ({
          key: String(f.key).slice(0, 60),
          label: String(f.label || f.key).slice(0, 60),
          type: String(f.type || 'text').slice(0, 20),
        })),
    }));
}

const schemaPrompt = (objects: SchemaObject[]) => objects
  .map((o) => `${o.slug} (${o.plural}): ${o.fields.map((f) => `${f.key}:${f.type}`).join(', ')}`)
  .join('\n');

export async function POST(req: Request) {
  const rl = rateLimit(`insights:${clientIp(req)}`, 20);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { privyUserId, workspaceId, question } = b || {};
  if (!privyUserId || !workspaceId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const text = String(question || '').trim().slice(0, 1000);
  if (!text) return NextResponse.json({ error: 'Ask a question first.' }, { status: 400 });

  const objects = readSchemas(b.objects);
  if (!objects.length) return NextResponse.json({ error: 'No objects to query.' }, { status: 400 });

  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

  const admin = createAdminClient();
  const { data: secret, error } = await admin.rpc('get_ai_secret', { p_privy: privyUserId, p_workspace: workspaceId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!secret) {
    return NextResponse.json({
      error: 'No AI provider configured. Add a key in Account → AI keys — or build the question by hand below, which needs no key.',
    }, { status: 400 });
  }

  let apiKey: string;
  try { apiKey = openSecret((secret as any).cipher, (secret as any).iv, (secret as any).tag); }
  catch { return NextResponse.json({ error: 'Could not decrypt the stored key (was SECRETS_MASTER_KEY changed?).' }, { status: 500 }); }

  const provider = (secret as any).provider as AIProvider;
  const model = (secret as any).model || defaultModel(provider);
  const usageRow = { workspace: workspaceId, privy: privyUserId, feature: 'insights' as const, provider, model };

  let reply: string;
  try {
    const out = await callAI(
      provider, apiKey, model, SYSTEM,
      `Objects available:\n${schemaPrompt(objects)}\n\nQuestion: ${text}\n`,
      (secret as any).base_url || undefined,
      ASK_MAX_TOKENS,
    );
    reply = out.text;
    await recordAIUsage(admin, { ...usageRow, usage: out.usage });
  } catch (e: any) {
    await recordAIUsage(admin, { ...usageRow, usage: { input: 0, output: 0, cached: 0 }, ok: false });
    return NextResponse.json(
      { error: e?.message || 'The AI request failed.' },
      { status: e?.name === 'TruncatedReply' ? 422 : 502 },
    );
  }

  const raw = extractJson(reply);
  if (!raw) {
    return NextResponse.json({
      error: reply.trim()
        ? 'The model replied, but not with a question it could read. Some models are much better at strict JSON.'
        : 'The model returned nothing at all. Check the key and model name in Account → AI keys.',
      detail: reply.slice(0, 300),
    }, { status: 422 });
  }

  const schema = objects.find((o) => o.slug === String(raw.object));
  const spec = normalizeSpec(raw, schema);
  if (!spec) {
    return NextResponse.json({
      error: `That question does not map onto anything in this workspace${raw?.object ? ` (it asked for "${String(raw.object).slice(0, 40)}")` : ''}. Try naming the records you mean.`,
    }, { status: 422 });
  }

  return NextResponse.json({ spec });
}
