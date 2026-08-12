import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { openSecret } from '@/lib/crypto/secrets';
import { PROVIDERS, callAI, type AIProvider } from '@/lib/ai/providers';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { DOC_PRESETS, DOC_BLOCK_META, normalizeDoc, newBlockId, ROOT } from '@/lib/marketing/email-doc';

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
  blocks: `{"subject":"","preheader":"","blocks":[{"type":"Heading","text":""},{"type":"Text","text":""}]}`,
};

/**
 * The block vocabulary, and one real layout, both generated from the shipped
 * presets.
 *
 * Written out rather than described, because a model given a bare type list
 * invents plausible neighbours — `subheading`, `paragraph`, `cta` — and every
 * one of them is dropped, which reads as the AI having produced half an email.
 * Showing a preset is also what stops the prompt and the manual builder
 * drifting: improving a preset improves the drafts.
 *
 * The model returns a FLAT LIST, not Waypoint's id-keyed document. Asking a
 * model to mint ids and cross-reference them in `childrenIds` is asking for a
 * document that fails its own schema; the ids are assembled below, where they
 * cannot be wrong.
 */
function blocksPrompt(): string {
  const vocab = DOC_BLOCK_META.filter((m) => m.type !== 'Html' && m.type !== 'ColumnsContainer')
    .map((m) => `  "${m.type}" — ${m.hint}`).join('\n');
  const doc = DOC_PRESETS.find((p) => p.key === 'letter')!.build('#4653CE');
  const example = JSON.stringify(
    (doc[ROOT].data.childrenIds as string[]).map((id) => ({
      type: doc[id].type,
      ...(doc[id].data?.props?.text !== undefined ? { text: doc[id].data.props.text } : {}),
      ...(doc[id].data?.props?.level ? { level: doc[id].data.props.level } : {}),
    })),
  );
  return (
    `\nblocks is an ORDERED list rendered top to bottom. Use ONLY these types:\n${vocab}\n\n` +
    `Fields: Heading {text, level:h1|h2|h3}, Text {text}, Button {text, url}, ` +
    `Image {url, alt}, Divider {}, Spacer {}.\n` +
    `Do not invent image URLs or links — leave url empty and a person will fill it in.\n` +
    `A good email is 3 to 6 blocks. Example:\n${example}\n`
  );
}

/**
 * The model's flat list → a document the renderer will accept.
 *
 * Every id is minted here and every unknown type is dropped, so the worst a
 * confused model achieves is a shorter email — never a document that throws in
 * the composer or, worse, in the send cron at 3am.
 */
function blocksToDoc(raw: any, accent: string) {
  const known = new Map(DOC_PRESETS[1].build(accent) ? DOC_BLOCK_META.map((m) => [m.type, m]) : []);
  const doc: any = { [ROOT]: { type: 'EmailLayout', data: {
    backdropColor: '#F5F5F5', canvasColor: '#FFFFFF', textColor: '#242424',
    fontFamily: 'MODERN_SANS', childrenIds: [] as string[] } } };
  const pad = { top: 8, right: 24, bottom: 8, left: 24 };
  for (const b of (Array.isArray(raw) ? raw : []).slice(0, 20)) {
    const type = String(b?.type || '');
    // Html and columns are excluded from the prompt AND here: a model must not
    // be the thing that decides raw markup goes into a send.
    if (!known.has(type as any) || type === 'Html' || type === 'ColumnsContainer') continue;
    const text = typeof b?.text === 'string' ? b.text.slice(0, 8000) : '';
    const url = typeof b?.url === 'string' ? b.url.slice(0, 2000) : '';
    let data: any;
    if (type === 'Heading') data = { props: { text: text || 'Heading', level: ['h1','h2','h3'].includes(b?.level) ? b.level : 'h2' }, style: { padding: { ...pad, top: 24 }, textAlign: 'left' } };
    else if (type === 'Text') data = { props: { text }, style: { padding: pad, fontSize: 16 } };
    else if (type === 'Button') data = { props: { text: text || 'Read more', url, buttonStyle: 'rounded', buttonTextColor: '#FFFFFF', buttonBackgroundColor: accent, size: 'medium' }, style: { padding: { ...pad, bottom: 24 }, textAlign: 'left' } };
    else if (type === 'Image') data = { props: { url, alt: typeof b?.alt === 'string' ? b.alt.slice(0, 300) : '', contentAlignment: 'middle' }, style: { padding: pad } };
    else if (type === 'Divider') data = { props: { lineColor: '#E4E4E7' }, style: { padding: pad } };
    else if (type === 'Spacer') data = { props: { height: 24 } };
    else continue;
    const id = newBlockId();
    doc[id] = { type, data };
    doc[ROOT].data.childrenIds.push(id);
  }
  return doc[ROOT].data.childrenIds.length ? normalizeDoc(doc) : null;
}

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
  const template = ['plain', 'announcement', 'digest', 'blocks'].includes(b?.template) ? b.template : 'plain';
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
    (template === 'blocks' ? blocksPrompt() : '') +
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

  if (template === 'blocks') {
    const doc = blocksToDoc(j.blocks, '#4653CE');
    if (!doc) {
      return NextResponse.json(
        { error: 'The model returned no usable blocks. Try a more specific brief.' }, { status: 502 });
    }
    out.content = { doc };
  }

  return NextResponse.json({ ok: true, draft: out });
}
