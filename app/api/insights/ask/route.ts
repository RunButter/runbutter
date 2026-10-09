import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { openSecret } from '@/lib/crypto/secrets';
import { callAI, defaultModel, type AIProvider } from '@/lib/ai/providers';
import { recordAIUsage } from '@/lib/ai/usage';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import {
  normalizeSpec, FILTER_OPS, METRIC_FNS, CHART_KINDS, SORTS, type SchemaObject,
} from '@/lib/insights/spec';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/insights/ask  { privyUserId, workspaceId, question, objects: SchemaObject[] }
 *
 * A question in, a SPEC out — never a record, never a query. The model is shown
 * column NAMES (what the browser already knows from the registry and the
 * workspace's custom objects) and replies with a spec; `normalizeSpec` then
 * re-checks every field against those same columns. The rows are read and
 * counted in the browser through `list_records`, so nothing here can widen what
 * the person could already see. Same shape as /api/workspace/build.
 */

const SYSTEM = `You turn a business question into a chart spec for a company's database.
Reply with ONE JSON object and nothing else:
{"object": slug, "filters": [{"field": key, "op": op, "value": string}], "groupBy": key or null,
 "metric": {"fn": fn, "field": key or null}, "chart": kind, "sort": sort, "limit": number, "title": string}
- object: one of the slugs listed. field keys: only keys listed for that object.
- op: ${FILTER_OPS.join(', ')}. Dates are YYYY-MM-DD; in_last_days takes a number of days.
- fn: ${METRIC_FNS.join(', ')}. count ignores field; the others need a number or currency field.
- chart: ${CHART_KINDS.join(', ')}. One total → "number". A breakdown → "bar". Over time → "line".
- sort: ${SORTS.join(', ')}. limit: 1-50.
- title: a short human title for the chart.
If the question cannot be answered from these columns, still pick the closest object and say so in the title.`;

function extractJson(reply: string): any | null {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(reply.slice(start, end + 1)); } catch { return null; }
}

/** The schema arrives from the browser, so it is trimmed to names and types. */
function cleanSchema(raw: any): SchemaObject[] {
  if (!Array.isArray(raw)) return [];
  const slug = /^[a-z][a-z0-9_]{0,62}$/;
  return raw.slice(0, 60).flatMap((o: any) => {
    if (!o || !slug.test(String(o.slug))) return [];
    const fields = Array.isArray(o.fields) ? o.fields.slice(0, 80)
      .filter((f: any) => f && slug.test(String(f.key)))
      .map((f: any) => ({ key: String(f.key), label: String(f.label || f.key).slice(0, 60), type: String(f.type || 'text').slice(0, 20) })) : [];
    return fields.length ? [{ slug: String(o.slug), plural: String(o.plural || o.slug).slice(0, 60), fields }] : [];
  });
}

export async function POST(req: Request) {
  const rl = rateLimit(`insights:${clientIp(req)}`, 20);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { privyUserId, workspaceId } = b || {};
  if (!privyUserId || !workspaceId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const question = String(b?.question || '').trim().slice(0, 500);
  if (!question) return NextResponse.json({ error: 'Ask a question first.' }, { status: 400 });
  const objects = cleanSchema(b?.objects);
  if (!objects.length) return NextResponse.json({ error: 'No record types to ask about.' }, { status: 400 });

  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

  const admin = createAdminClient();
  const { data: secret, error } = await admin.rpc('get_ai_secret', { p_privy: privyUserId, p_workspace: workspaceId });
  if (error) return NextResponse.json({ error: error.message }, { status: /NOT_A_MEMBER/.test(error.message) ? 403 : 500 });
  if (!secret) {
    return NextResponse.json({ error: 'No AI key yet — build the chart with the dropdowns, or add a key in Settings → AI.' }, { status: 400 });
  }

  let apiKey: string;
  try { apiKey = openSecret((secret as any).cipher, (secret as any).iv, (secret as any).tag); }
  catch { return NextResponse.json({ error: 'Could not decrypt the stored AI key.' }, { status: 500 }); }

  const provider = (secret as any).provider as AIProvider;
  const model = (secret as any).model || defaultModel(provider, 'fast');
  const schemaText = objects.map((o) =>
    `${o.slug} (${o.plural}): ${o.fields.map((f) => `${f.key}:${f.type}`).join(', ')}`).join('\n');

  const usageRow = { workspace: workspaceId, privy: privyUserId, feature: 'insights' as const, provider, model };
  let reply: string;
  try {
    const out = await callAI(provider, apiKey, model, SYSTEM,
      `Today is ${new Date().toISOString().slice(0, 10)}.\nObjects:\n${schemaText}\n\nQuestion: ${question}`,
      (secret as any).base_url || undefined, 1024);
    reply = out.text;
    await recordAIUsage(admin, { ...usageRow, usage: out.usage });
  } catch (e: any) {
    await recordAIUsage(admin, { ...usageRow, usage: { input: 0, output: 0, cached: 0 }, ok: false });
    return NextResponse.json({ error: e?.message || 'The AI request failed.' }, { status: e?.name === 'TruncatedReply' ? 422 : 502 });
  }

  const raw = extractJson(reply);
  const schema = raw ? objects.find((o) => o.slug === raw.object) : undefined;
  const spec = normalizeSpec(raw, schema);
  if (!spec) {
    return NextResponse.json({
      error: 'The model did not pick a record type it could chart. Try naming one — invoices, deals, candidates…',
    }, { status: 422 });
  }
  return NextResponse.json({ ok: true, spec });
}
