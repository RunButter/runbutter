import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { openSecret } from '@/lib/crypto/secrets';
import { callAI, PROVIDERS, type AIProvider } from '@/lib/ai/providers';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { SYSTEM, fewShot, extractJson, normalizeGenerated, repairPrompt, draftWeight } from '@/lib/plugins/generate';
import { lintProject } from '@/lib/plugins/lint';
import { buildPlugin } from '@/lib/plugins/agent-plugin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/plugins/generate  { description }
 *
 * THE BODY CARRIES NO IDENTITY. Both the user and the workspace are derived
 * from the signed `privy-token` cookie, which is what lets `/plugins` call this
 * without importing the Privy SDK — and that is not a detail. Pulling
 * `usePrivy()` into that page added 487 KB to a public marketing tool that most
 * visitors will never sign in to. Sending nothing and reading the cookie costs
 * nothing and is strictly stronger: there is no claimed id to disagree with.
 *
 * It also means this route must fail CLOSED when verification is unavailable,
 * unlike `authorizePrivy`, which fails open on a JWKS outage. That is safe only
 * because it has a claimed id to compare against; here the token IS the
 * identity, so an unverified token is simply no identity at all.
 *
 * Writes a skill from a description, LINTS IT, and hands the findings back to
 * the model until they are gone or the budget is spent. Returns a draft for the
 * editor — it creates nothing and stores nothing, same separation as
 * /api/workspace/build.
 *
 * WHY THE LOOP IS THE FEATURE. Asking a model for a SKILL.md is a prompt anyone
 * can write, and what comes back is reliably a page of rules with no output
 * contract, no worked example and no failure path. `lib/plugins/lint.ts` names
 * exactly those gaps in words that are already phrased as instructions, so the
 * repair prompt is not a second guess at quality — it is the same check the
 * panel beside the editor will run, applied before the user ever sees the draft.
 *
 * THE BUDGET IS THE USER'S MONEY. This runs on the workspace's own AI key, so
 * every iteration is a bill somebody pays. Three calls maximum, it stops the
 * moment nothing actionable is left, and `repairPrompt` deliberately ignores
 * `idea`-severity findings — those are the ones that are fine to leave, and
 * chasing them is how a repair loop becomes a token sink.
 */

const MAX_ATTEMPTS = 3;          // one write + up to two repairs
const GENERATE_MAX_TOKENS = 3072;

const defaultModel = (p: string) => PROVIDERS.find((x) => x.id === p)?.models[0] || '';

export async function POST(req: Request) {
  // Tighter than the workspace builder's 10: this one makes up to three model
  // calls per request, so the same limit would be three times the spend.
  const rl = rateLimit(`plugingen:${clientIp(req)}`, 6);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const text = String(b?.description || '').trim().slice(0, 4000);
  if (!text) return NextResponse.json({ error: 'Describe the skill first.' }, { status: 400 });

  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') {
    // `signin: true` is what lets the page swap its button for a sign-in link
    // without ever asking whether somebody is logged in — there is no way to
    // know that from a page carrying no auth SDK, and one honest 401 is a
    // better answer than a request on every pageview.
    return NextResponse.json({ error: 'Sign in to generate — it runs on your own AI key.', signin: true }, { status: 401 });
  }
  const privyUserId = v.userId;

  const admin = createAdminClient();
  const { data: ws } = await admin.rpc('get_my_workspace', { p_privy: privyUserId });
  const workspaceId = (ws as any)?.id;
  if (!workspaceId) {
    return NextResponse.json({ error: 'No workspace yet — finish signing up first.' }, { status: 400 });
  }

  const { data: secret, error } = await admin.rpc('get_ai_secret', { p_privy: privyUserId, p_workspace: workspaceId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!secret) {
    return NextResponse.json({
      error: 'No AI provider configured. Add a key in Account → AI keys — RunButter never charges for tokens, so generation runs on your own key.',
    }, { status: 400 });
  }

  let apiKey: string;
  try { apiKey = openSecret((secret as any).cipher, (secret as any).iv, (secret as any).tag); }
  catch { return NextResponse.json({ error: 'Could not decrypt the stored key (was SECRETS_MASTER_KEY changed?).' }, { status: 500 }); }

  const provider = (secret as any).provider as AIProvider;
  const model = (secret as any).model || defaultModel(provider);
  const baseUrl = (secret as any).base_url || undefined;

  let prompt = `${fewShot()}\n\nWrite a skill for this:\n${text}\n`;
  let best: ReturnType<typeof normalizeGenerated> = null;
  let bestFindings: ReturnType<typeof lintProject>['findings'] = [];
  let attempts = 0;
  let lastReply = '';

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    let reply: string;
    try {
      reply = await callAI(provider, apiKey, model, SYSTEM, prompt, baseUrl, GENERATE_MAX_TOKENS);
    } catch (e: any) {
      // A failure on a REPAIR is not a failure of the request — we already have
      // a draft, and handing back a worse experience than "here is your skill,
      // three things left to fix" would be silly.
      if (best) break;
      return NextResponse.json({ error: e?.message || 'The AI request failed.' }, { status: 502 });
    }
    lastReply = reply;

    const draft = normalizeGenerated(extractJson(reply));
    if (!draft) {
      if (best) break;                     // keep the earlier good draft
      if (attempts >= MAX_ATTEMPTS) break;
      // Not a repair — the model did not produce a skill at all, so ask again
      // rather than sending it a list of lint findings about nothing.
      prompt = `${prompt}\n\nYour last reply was not a single valid JSON object. Reply with ONLY the JSON object, no prose, no code fence.`;
      continue;
    }

    // Lint the draft exactly as the browser will, by building the real files —
    // which is also what runs the credential scan over everything the model
    // wrote, before any of it reaches a form field.
    const project = {
      manifest: { name: draft.name },
      skills: [{
        name: draft.name,
        description: draft.description,
        instructions: draft.instructions,
        when_to_use: draft.whenToUse,
        resources: draft.resources,
      }],
    };
    const files = buildPlugin(project);
    const { findings } = lintProject(project, files);

    // Keep the better of the two. A repair that makes things worse must not
    // overwrite a good draft — see draftWeight.
    if (!best || draftWeight(findings) < draftWeight(bestFindings)) {
      best = draft;
      bestFindings = findings;
    }

    const next = repairPrompt(bestFindings);
    if (!next) break;                       // nothing actionable left
    if (attempts >= MAX_ATTEMPTS) break;
    prompt = `${prompt}\n\nYou replied:\n${JSON.stringify(draft)}\n\n${next}`;
  }

  if (!best) {
    return NextResponse.json({
      error: 'The model did not return a skill. Try describing it in a sentence or two.',
      detail: lastReply.slice(0, 300),
    }, { status: 422 });
  }

  return NextResponse.json({
    ok: true,
    skill: best,
    attempts,
    // What is still wrong, in the model's own aftermath. The panel will say the
    // same thing once the draft is loaded; returning it here means the UI can
    // be honest about a draft that came back imperfect instead of implying the
    // loop always succeeds.
    remaining: bestFindings.filter((f) => f.severity !== 'idea').map((f) => f.message),
    provider,
    model,
  });
}
