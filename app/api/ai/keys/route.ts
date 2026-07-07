import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { sealSecret, secretHint } from '@/lib/crypto/secrets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROVIDERS = new Set(['claude', 'openai', 'gemini', 'openrouter']);

/**
 * POST /api/ai/keys  { privyUserId, workspaceId, provider, model, key }
 * Seals the BYO provider key with AES-256-GCM and stores the ciphertext.
 * The plaintext key never touches the database or comes back to the client.
 */
export async function POST(req: Request) {
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { privyUserId, workspaceId, provider, model, key } = b || {};
  if (!privyUserId || !workspaceId || !PROVIDERS.has(provider) || !key || !String(key).trim()) {
    return NextResponse.json({ error: 'Missing/invalid fields' }, { status: 400 });
  }
  try {
    const plain = String(key).trim();
    const sealed = sealSecret(plain);
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('store_ai_provider', {
      p_privy: privyUserId, p_workspace: workspaceId, p_provider: provider, p_model: model || '',
      p_cipher: sealed.cipher, p_iv: sealed.iv, p_tag: sealed.tag, p_hint: secretHint(plain),
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, id: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to store key' }, { status: 500 });
  }
}
