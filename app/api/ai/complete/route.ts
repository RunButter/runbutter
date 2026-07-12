import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { openSecret } from '@/lib/crypto/secrets';
import { callAI, PROVIDERS, type AIProvider } from '@/lib/ai/providers';
import { authorizePrivy } from '@/lib/auth/privy-verify';

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
const defaultModel = (p: string) => PROVIDERS.find((x) => x.id === p)?.models[0] || '';

export async function POST(req: Request) {
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
  const model = (secret as any).model || defaultModel(provider);
  const system = 'You are a concise writing assistant inside HireBTR, a business workspace app. ' + (MODES[mode] || MODES.write);
  try {
    const out = await callAI(provider, apiKey, model, system, buildPrompt(mode, text, instruction), (secret as any).base_url || undefined);
    return NextResponse.json({ ok: true, text: out, provider, model });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'AI request failed' }, { status: 502 });
  }
}
