import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { openSecret } from '@/lib/crypto/secrets';
import { callAI, defaultModel, type AIProvider } from '@/lib/ai/providers';
import { recordAIUsage } from '@/lib/ai/usage';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { metricsPrompt, type InvestorMetrics } from '@/lib/investor/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/investor/draft  { privyUserId, workspaceId, metrics, highlights, asks }
 *
 * Writes the PROSE of a monthly investor update around figures that were
 * already computed. It sends nothing and saves nothing.
 *
 * THE MODEL IS NEVER ASKED WHAT A NUMBER IS. It receives the figures and writes
 * the sentences between them. An investor update is the one document in this
 * product where a hallucinated number does lasting damage — it is forwarded,
 * archived, and quoted back next quarter — so the arithmetic happens in
 * lib/investor/metrics.ts over the real ledger, and every figure is displayed
 * beside the draft so it can be checked before anybody sends it.
 *
 * The founder's own highlights and asks are passed through because those are
 * the half no model can know: what shipped, who joined, what help is wanted.
 */

const DRAFT_MAX_TOKENS = 1400;

const SYSTEM = `You write a monthly investor update for a startup founder, in their voice.

You are given FIGURES that are already correct. Use them exactly as written.

Absolute rules:
- NEVER invent, estimate, round differently, or extrapolate a number. If a figure is not in
  the list, do not mention that topic at all.
- Never describe a trend you were not given. Two numbers and their percentage change is a
  trend; one number is not.
- Do not add a metric the founder did not provide because investor updates "usually" have it.
  An absent number is absent on purpose.

Tone: plain, direct, confident without spin. Investors read hundreds of these. Short
sentences. No adjectives doing work a number should do. If the month was bad, say so
plainly — a founder who reports a bad month clearly is more fundable than one who buries it.

Reply with ONLY a JSON object, no prose and no code fence:
{
  "subject": "Acme — August update",
  "summary": "Two or three sentences: the month in plain terms.",
  "sections": [
    { "heading": "Numbers", "body": "Prose using the given figures." },
    { "heading": "What shipped", "body": "..." },
    { "heading": "Asks", "body": "..." }
  ]
}

Include a section only when you were given something to put in it. Three to five sections.`;

function extractJson(reply: string): any | null {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(reply.slice(start, end + 1)); } catch { return null; }
}

/** Trust nothing about shape; the numbers were computed client-side but are re-read here. */
function readMetrics(raw: any): InvestorMetrics | null {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    period: typeof raw.period === 'string' ? raw.period.slice(0, 40) : null,
    revenue: num(raw.revenue), revenuePrev: num(raw.revenuePrev), growthPct: num(raw.growthPct),
    costs: num(raw.costs), net: num(raw.net), outstanding: num(raw.outstanding),
    cash: num(raw.cash), runwayMonths: num(raw.runwayMonths), burn: num(raw.burn),
    pipelineValue: num(raw.pipelineValue), pipelineCount: num(raw.pipelineCount),
    headcount: num(raw.headcount), missing: [],
  };
}

export async function POST(req: Request) {
  const rl = rateLimit(`investor:${clientIp(req)}`, 10);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { privyUserId, workspaceId } = b || {};
  if (!privyUserId || !workspaceId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const metrics = readMetrics(b.metrics);
  if (!metrics) return NextResponse.json({ error: 'No figures to write about.' }, { status: 400 });

  const figures = metricsPrompt(metrics);
  if (!figures.trim()) {
    return NextResponse.json({ error: 'There are no figures yet — add some invoices or expenses first.' }, { status: 400 });
  }

  const highlights = String(b.highlights || '').trim().slice(0, 3000);
  const asks = String(b.asks || '').trim().slice(0, 1500);
  const company = String(b.company || '').trim().slice(0, 80);

  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

  const admin = createAdminClient();
  const { data: secret, error } = await admin.rpc('get_ai_secret', { p_privy: privyUserId, p_workspace: workspaceId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!secret) {
    return NextResponse.json({
      error: 'No AI provider configured. Add a key in Account → AI keys — the figures below are still yours to copy.',
    }, { status: 400 });
  }

  let apiKey: string;
  try { apiKey = openSecret((secret as any).cipher, (secret as any).iv, (secret as any).tag); }
  catch { return NextResponse.json({ error: 'Could not decrypt the stored key (was SECRETS_MASTER_KEY changed?).' }, { status: 500 }); }

  const provider = (secret as any).provider as AIProvider;
  const model = (secret as any).model || defaultModel(provider);
  const usageRow = { workspace: workspaceId, privy: privyUserId, feature: 'investor' as const, provider, model };

  const prompt = [
    company ? `Company: ${company}` : '',
    `FIGURES (use exactly, invent nothing):\n${figures}`,
    highlights ? `\nWhat the founder says happened:\n${highlights}` : '',
    asks ? `\nWhat they want help with:\n${asks}` : '',
  ].filter(Boolean).join('\n');

  let reply: string;
  try {
    const out = await callAI(provider, apiKey, model, SYSTEM, prompt, (secret as any).base_url || undefined, DRAFT_MAX_TOKENS);
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
        ? 'The model replied, but not with a draft it could read. Some models are much better at strict JSON.'
        : 'The model returned nothing at all. Check the key and model name in Account → AI keys.',
    }, { status: 422 });
  }

  const sections = Array.isArray(raw.sections)
    ? raw.sections
        .filter((s: any) => s && typeof s.body === 'string' && s.body.trim())
        .slice(0, 6)
        .map((s: any) => ({ heading: String(s.heading || '').slice(0, 80), body: String(s.body).slice(0, 4000) }))
    : [];

  return NextResponse.json({
    subject: String(raw.subject || `${company || 'Company'} update`).slice(0, 160),
    summary: String(raw.summary || '').slice(0, 2000),
    sections,
  });
}
