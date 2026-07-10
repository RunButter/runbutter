import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { sealSecret, secretHint } from '@/lib/crypto/secrets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROVIDERS = new Set(['claude', 'openai', 'gemini', 'openrouter', 'custom']);

/**
 * POST /api/ai/keys  { privyUserId, workspaceId, provider, model, key, baseUrl? }
 * Seals the BYO provider key with AES-256-GCM and stores the ciphertext.
 * The plaintext key never touches the database or comes back to the client.
 * provider "custom" = any OpenAI-compatible endpoint; baseUrl is required.
 */
export async function POST(req: Request) {
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { privyUserId, workspaceId, provider, model, key, baseUrl } = b || {};
  if (!privyUserId || !workspaceId || !PROVIDERS.has(provider) || !key || !String(key).trim()) {
    return NextResponse.json({ error: 'Missing/invalid fields' }, { status: 400 });
  }
  if (provider === 'custom' && !/^https?:\/\/.+/i.test(String(baseUrl || '').trim())) {
    return NextResponse.json({ error: 'Custom provider needs a base URL, e.g. https://api.groq.com/openai/v1' }, { status: 400 });
  }
  try {
    const plain = String(key).trim();
    const sealed = sealSecret(plain);
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('store_ai_provider', {
      p_privy: privyUserId, p_workspace: workspaceId, p_provider: provider, p_model: model || '',
      p_cipher: sealed.cipher, p_iv: sealed.iv, p_tag: sealed.tag, p_hint: secretHint(plain),
      p_base_url: provider === 'custom' ? String(baseUrl).trim().replace(/\/+$/, '') : null,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, id: data });
  } catch (e: any) {
    const msg = String(e?.message || 'Failed to store key');
    // 0038 renames the RPC signature; give a actionable hint if it's missing.
    const friendly = /store_ai_provider/.test(msg) ? 'Database migration 0038 has not been run yet (Supabase SQL editor).' : msg;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
}
