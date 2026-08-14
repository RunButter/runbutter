import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { openSecret } from '@/lib/crypto/secrets';
import { callAI, defaultModel, type AIProvider } from '@/lib/ai/providers';
import { recordAIUsage } from '@/lib/ai/usage';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
// lib/records/extract.ts imports nothing, for the reason blueprint.ts documents.
import { normalizeExtraction, fieldsPrompt, type ExtractField } from '@/lib/records/extract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/records/extract  { privyUserId, workspaceId, text, fields }
 *
 * Reads a lump of text — a pasted email, an invoice, text pulled out of a PDF
 * in the browser — and returns FIELD VALUES for one object. It writes nothing.
 * The values open a prefilled form and a person presses Save.
 *
 * THE TEXT IS UNTRUSTED BY DEFINITION: it is something somebody was sent. So
 * this is the /api/workspace/build shape again — a model proposes, every value
 * is re-validated against the object's declared fields and types, and a human
 * sees it before it becomes a row. A prompt injection in a forwarded invoice
 * gets to put a wrong value in a form field, in front of the person who pasted
 * it. It has no path to a write.
 *
 * PDFs ARE PARSED IN THE BROWSER (lib/pdf/convert.ts) and arrive here as text,
 * which is the same rule /pdf and the doc exporter follow: somebody's invoice
 * or contract does not need to be uploaded to be read.
 */

const EXTRACT_MAX_TOKENS = 1024;

const SYSTEM = `You read a document and fill in a form. Reply with ONLY a JSON object of
field keys to values — no prose, no code fence, no explanation.

Rules:
- Use ONLY the field keys given. Never invent one. Omit anything the text does not state.
- Dates MUST be ISO: YYYY-MM-DD. Never DD/MM/YYYY, never a month name.
- Numbers: digits only, a dot for the decimal, no currency symbol and no thousands separator.
- For a field listing options with |, reply with exactly one of them.
- Do not guess. An omitted field is far better than a wrong one — a person is about to
  read what you return, and every value they have to correct costs more than one they type.`;

function extractJson(reply: string): any | null {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(reply.slice(start, end + 1)); } catch { return null; }
}

/**
 * The field list comes from the CLIENT, and that is safe for the same reason it
 * is in /api/insights/ask: these are labels and input types the caller already
 * has on screen, and they are the same fields the reply is validated against.
 * Lying about them gets you a form full of your own nothing.
 */
function readFields(raw: any): ExtractField[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f: any) => f && typeof f.key === 'string' && typeof f.input === 'string')
    .slice(0, 60)
    .map((f: any) => ({
      key: String(f.key).slice(0, 60),
      label: String(f.label || f.key).slice(0, 80),
      input: String(f.input).slice(0, 20),
      options: Array.isArray(f.options) ? f.options.slice(0, 40).map((o: any) => String(o).slice(0, 60)) : undefined,
    }));
}

export async function POST(req: Request) {
  const rl = rateLimit(`extract:${clientIp(req)}`, 20);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { privyUserId, workspaceId } = b || {};
  if (!privyUserId || !workspaceId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // Generous, because an invoice PDF's text runs long, but bounded — the useful
  // fields are near the top and a whole contract is mostly boilerplate.
  const text = String(b.text || '').trim().slice(0, 20000);
  if (!text) return NextResponse.json({ error: 'Nothing to read.' }, { status: 400 });

  const fields = readFields(b.fields);
  if (!fields.length) return NextResponse.json({ error: 'This object has no fields to fill.' }, { status: 400 });

  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

  const admin = createAdminClient();
  const { data: secret, error } = await admin.rpc('get_ai_secret', { p_privy: privyUserId, p_workspace: workspaceId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!secret) {
    return NextResponse.json({ error: 'No AI provider configured. Add a key in Account → AI keys.' }, { status: 400 });
  }

  let apiKey: string;
  try { apiKey = openSecret((secret as any).cipher, (secret as any).iv, (secret as any).tag); }
  catch { return NextResponse.json({ error: 'Could not decrypt the stored key (was SECRETS_MASTER_KEY changed?).' }, { status: 500 }); }

  const provider = (secret as any).provider as AIProvider;
  const model = (secret as any).model || defaultModel(provider);
  const usageRow = { workspace: workspaceId, privy: privyUserId, feature: 'extract' as const, provider, model };

  let reply: string;
  try {
    const out = await callAI(
      provider, apiKey, model, SYSTEM,
      `Fields:\n${fieldsPrompt(fields)}\n\nDocument:\n${text}\n`,
      (secret as any).base_url || undefined,
      EXTRACT_MAX_TOKENS,
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
        ? 'The model replied, but not with fields it could read. Some models are much better at strict JSON.'
        : 'The model returned nothing at all. Check the key and model name in Account → AI keys.',
    }, { status: 422 });
  }

  // Every value re-checked against the declared type here. `dropped` is
  // RETURNED rather than swallowed: a form that quietly lost the total is worse
  // than one that says it could not read it.
  const { values, dropped } = normalizeExtraction(raw, fields);
  return NextResponse.json({ values, dropped });
}
