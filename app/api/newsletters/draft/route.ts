import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { openSecret } from '@/lib/crypto/secrets';
import { PROVIDERS, callAI, type AIProvider } from '@/lib/ai/providers';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/newsletters/draft { privyUserId, workspaceId, template, brief }
 *
 * Drafts subject, preheader and body from a brief, on the WORKSPACE'S OWN AI KEY
 * (the cost rule: no metered calls on our account, ever).
 *
 * IT DRAFTS, IT DOES NOT SEND. The response is returned to the composer for a
 * human to read, edit and then send — the same shape as agents proposing writes
 * rather than making them. Nothing here touches the newsletters table.
 */

const defaultModel = (p: string) => PROVIDERS.find((x) => x.id === p)?.models[0] || '';

const SHAPES: Record<string, string> = {
  plain: `{"subject":"","preheader":"","heading":"","body":"","ctaLabel":"","ctaUrl":""}`,
  announcement: `{"subject":"","preheader":"","heading":"","body":"","ctaLabel":"","ctaUrl":""}`,
  digest: `{"subject":"","preheader":"","heading":"","intro":"","items":[{"title":"","blurb":"","url":""}]}`,
};

/**
 * Models wrap JSON in prose or fences no matter how firmly you ask. Rather than
 * failing the request on that, take the outermost braces and parse those.
 */
function extractJson(raw: string): any | null {
  const s = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

const str = (v: any, max: number) => (typeof v === 'string' ? v : '').slice(0, max);

export async function POST(req: Request) {
  const rl = rateLimit(`nldraft:${clientIp(req)}`, 20);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { privyUserId, workspaceId } = b || {};
  const template = ['plain', 'announcement', 'digest'].includes(b?.template) ? b.template : 'plain';
  const brief = String(b?.brief || '').slice(0, 2000);
  if (!privyUserId || !workspaceId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!brief.trim()) return NextResponse.json({ error: 'Describe what the newsletter should say.' }, { status: 400 });

  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

  const admin = createAdminClient();

  // Also validates membership — raises NOT_A_MEMBER otherwise.
  const { data: secret, error: secErr } = await admin.rpc('get_ai_secret', { p_privy: privyUserId, p_workspace: workspaceId });
  if (secErr) return NextResponse.json({ error: secErr.message }, { status: /NOT_A_MEMBER/.test(secErr.message) ? 403 : 500 });
  if (!secret) return NextResponse.json({ error: 'No AI provider configured. Add a key in Account → AI keys.' }, { status: 400 });

  let apiKey: string;
  try { apiKey = openSecret((secret as any).cipher, (secret as any).iv, (secret as any).tag); }
  catch { return NextResponse.json({ error: 'Could not decrypt the stored AI key.' }, { status: 500 }); }

  const provider = (secret as any).provider as AIProvider;
  const model = (secret as any).model || defaultModel(provider);

  // Tone reference: the workspace's OWN last few sends. A newsletter that sounds
  // like this company is the entire point, and generic "write a newsletter"
  // output is what makes AI drafts unusable.
  const { data: past } = await admin
    .from('newsletters')
    .select('subject, content')
    .eq('workspace_id', workspaceId)
    .eq('status', 'sent')
    .order('finished_at', { ascending: false })
    .limit(3);

  const samples = (past || [])
    .map((p: any) => `SUBJECT: ${p.subject}\n${(p.content?.body || p.content?.intro || '').slice(0, 600)}`)
    .join('\n---\n')
    .slice(0, 2500);

  const system =
    `You write email newsletters for a company. Return ONLY JSON matching this shape, no prose, no code fences:\n${SHAPES[template]}\n\n` +
    `Rules:\n` +
    `- Subject under 60 characters. No emoji unless the brief asks. Never use "Don't miss", "Act now" or similar — those trip spam filters and read as a mailing list, not a person.\n` +
    `- preheader is one short line that ADDS to the subject rather than repeating it.\n` +
    `- Body: short paragraphs separated by blank lines. Plain text, no HTML, no markdown.\n` +
    `- Only include a ctaUrl if the brief supplies one. Never invent a link, a statistic, a date, a price or a customer name — an invented fact in a newsletter goes to every subscriber at once.\n` +
    (samples ? `\nMatch the voice of these previous sends from this company:\n${samples}` : '');

  let raw: string;
  try {
    raw = await callAI(provider, apiKey, model, system, `Brief:\n${brief}`, (secret as any).base_url || undefined);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'The AI provider call failed.' }, { status: 502 });
  }

  const j = extractJson(raw);
  if (!j) return NextResponse.json({ error: 'The model did not return usable JSON. Try rewording the brief.' }, { status: 502 });

  // Whitelisted field by field. The draft goes straight into a send, so an
  // unexpected key must not ride along into stored content.
  const out: any = {
    subject: str(j.subject, 200),
    preheader: str(j.preheader, 200),
    content: {
      heading: str(j.heading, 200),
      body: str(j.body, 8000),
      intro: str(j.intro, 1000),
      ctaLabel: str(j.ctaLabel, 60),
      ctaUrl: str(j.ctaUrl, 500),
      items: Array.isArray(j.items)
        ? j.items.slice(0, 25).map((it: any) => ({
            title: str(it?.title, 200), blurb: str(it?.blurb, 400), url: str(it?.url, 500),
          })).filter((it: any) => it.title)
        : [],
    },
  };
  return NextResponse.json({ ok: true, draft: out });
}
