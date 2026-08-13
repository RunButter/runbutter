import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { openSecret } from '@/lib/crypto/secrets';
import { callAI, defaultModel, type AIProvider } from '@/lib/ai/providers';
import { recordAIUsage } from '@/lib/ai/usage';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/complete  { privyUserId, workspaceId, mode, text, instruction }
 * Runs the workspace's default BYO provider on the given text. The user funds
 * it (their key), so there is no platform token cost.
 */
const MODES: Record<string, string> = {
  write: 'Write the requested document or section. Return only the content, in clean Markdown.',
  improve: 'Improve the writing — clearer, tighter, well structured — keeping the meaning. Return only the revised Markdown.',
  summarize: 'Summarize the text concisely as Markdown bullet points.',
  continue: 'Continue the text naturally from where it ends. Return only the continuation.',
  fix: 'Fix spelling, grammar and punctuation only. Return the corrected text.',
};

function buildPrompt(mode: string, text: string, instruction?: string): string {
  if (mode === 'write') return instruction || 'Write a short professional document.';
  const instr = instruction ? `\n\nAdditional instruction: ${instruction}` : '';
  // Cap the input so a giant doc can't run up the user's token bill.
  const body = String(text || '').slice(0, 24000);
  return `Text:\n"""\n${body}\n"""${instr}`;
}

export async function POST(req: Request) {
  const rl = rateLimit(`ai:${clientIp(req)}`, 30);
  if (!rl.ok) return tooMany(rl.retryAfterS);
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { privyUserId, workspaceId, mode, text, instruction } = b || {};
  if (!privyUserId || !workspaceId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

  const admin = createAdminClient();
  const { data: secret, error } = await admin.rpc('get_ai_secret', { p_privy: privyUserId, p_workspace: workspaceId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!secret) return NextResponse.json({ error: 'No AI provider configured. Add a key in Settings → AI keys.' }, { status: 400 });

  let apiKey: string;
  try { apiKey = openSecret((secret as any).cipher, (secret as any).iv, (secret as any).tag); }
  catch { return NextResponse.json({ error: 'Could not decrypt the stored key (was SECRETS_MASTER_KEY changed?).' }, { status: 500 }); }

  const provider = (secret as any).provider as AIProvider;
  // FAST tier. Rewriting a paragraph is short, fully specified work — the
  // thing this endpoint does more often than everything else in the product
  // combined, and the last place that should fall back to a frontier model.
  const model = (secret as any).model || defaultModel(provider, 'fast');
  const system = 'You are a concise writing assistant inside RunButter, a business workspace app. ' + (MODES[mode] || MODES.write);
  const usageRow = { workspace: workspaceId, privy: privyUserId, feature: 'assistant' as const, provider, model };
  try {
    const out = await callAI(provider, apiKey, model, system, buildPrompt(mode, text, instruction), (secret as any).base_url || undefined);
    await recordAIUsage(admin, { ...usageRow, usage: out.usage });
    return NextResponse.json({ ok: true, text: out.text, provider, model });
  } catch (e: any) {
    // A failed call is still billed — a model that spends its whole budget
    // thinking and returns nothing costs exactly as much as one that answers.
    // Recording only successes is how a cost report ends up cheapest for the
    // workspace with the worst problem. The counts are unknown here (the
    // provider's error body carries none), so this row lands in `unreported`,
    // which is the honest place for it.
    await recordAIUsage(admin, { ...usageRow, usage: { input: 0, output: 0, cached: 0 }, ok: false });
    return NextResponse.json({ error: e?.message || 'AI request failed' }, { status: 502 });
  }
}
