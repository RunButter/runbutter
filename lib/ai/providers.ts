// BYO-key AI adapter. The user supplies their own provider key (stored encrypted);
// RunButter just proxies the call, so there is no platform token cost. No SDKs —
// plain REST — to keep deploys light. Non-streaming (simple + robust) for v1.
import { isAllowedAiHost, aiAllowlistIsEmpty } from '@/lib/security/http';

export type AIProvider = 'claude' | 'openai' | 'gemini' | 'openrouter' | 'custom';

/**
 * How hard a task is, which is a different question from how good a model is.
 *
 * `fast` is for work that is short and fully specified — rewrite this
 * paragraph, summarise this record, fill this field. `balanced` is for work
 * that needs judgement and returns structure: a workspace blueprint, a skill, a
 * newsletter, an agent driving a tool loop.
 */
export type ModelTier = 'fast' | 'balanced';

export interface ProviderDef {
  id: AIProvider; label: string; help: string;
  /** Suggestions for the datalist. Order is presentation ONLY — see `fast`/`balanced`. */
  models: string[];
  fast: string;
  balanced: string;
}

/**
 * Model lists are suggestions only — the field is free text, so users can type
 * any model their key supports without us shipping a stale hardcoded list. The
 * "custom" provider takes a base URL and covers every OpenAI-compatible API.
 *
 * THE DEFAULT IS A NAMED FIELD, NOT `models[0]`, AND THAT IS THE WHOLE POINT.
 * It used to be positional, and every list here happened to be ordered
 * best-first — so the fallback model for every AI feature in the product was
 * the most expensive one the provider sells. Opus to rewrite a paragraph;
 * gpt-4o where gpt-4o-mini is indistinguishable; Gemini Pro for a one-line
 * summary. Nobody chose that and nothing said it was happening — it was an
 * ordering accident with a bill attached, and positional meaning is exactly the
 * kind of thing that gets re-broken by someone tidying a list.
 */
export const PROVIDERS: ProviderDef[] = [
  {
    id: 'claude', label: 'Claude (Anthropic)', help: 'console.anthropic.com → API keys',
    models: ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5-20251001'],
    fast: 'claude-haiku-4-5-20251001', balanced: 'claude-sonnet-5',
  },
  {
    id: 'openai', label: 'ChatGPT (OpenAI)', help: 'platform.openai.com → API keys',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1'],
    fast: 'gpt-4o-mini', balanced: 'gpt-4o',
  },
  {
    id: 'gemini', label: 'Gemini (Google)', help: 'aistudio.google.com → API keys',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    fast: 'gemini-2.5-flash', balanced: 'gemini-2.5-pro',
  },
  {
    id: 'openrouter', label: 'OpenRouter', help: 'openrouter.ai → Keys (any model; ids ending in :free cost nothing)',
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-4o-mini', 'anthropic/claude-sonnet-5'],
    fast: 'meta-llama/llama-3.3-70b-instruct:free', balanced: 'meta-llama/llama-3.3-70b-instruct:free',
  },
  {
    id: 'custom', label: 'Custom (OpenAI-compatible)', help: 'Any OpenAI-compatible API: Groq, Mistral, DeepSeek, Together, xAI, LiteLLM… or your own Ollama/vLLM when self-hosting (see AI_ALLOWED_HOSTS)',
    models: ['llama-3.3-70b-versatile', 'mistral-large-latest', 'deepseek-chat'],
    fast: 'llama-3.3-70b-versatile', balanced: 'llama-3.3-70b-versatile',
  },
];
export const providerLabel = (p: string) => PROVIDERS.find((x) => x.id === p)?.label || p;

/**
 * The model to use when the workspace has not named one.
 *
 * A model saved on the key always wins — this is only the fallback, which is
 * why choosing "let RunButter pick" is now a real option on the settings screen
 * rather than a blank that silently stored the top of a list.
 */
export function defaultModel(provider: string, tier: ModelTier = 'balanced'): string {
  const def = PROVIDERS.find((x) => x.id === provider);
  if (!def) return '';
  return (tier === 'fast' ? def.fast : def.balanced) || def.models[0] || '';
}

/**
 * Why a private base URL was refused, and what to do about it.
 *
 * The old message was "points at a private/unsafe host", which is true and
 * useless to the person it happens to: someone self-hosting who has just
 * pointed RunButter at their own Ollama has done nothing wrong and has no way
 * to guess that an env var decides it.
 */
function privateHostMessage(base: string): string {
  let host = base;
  try { const u = new URL(base); host = u.port ? `${u.hostname}:${u.port}` : u.hostname; } catch { /* keep the raw string */ }
  return aiAllowlistIsEmpty()
    ? `This deployment will not call ${host}: it is a private address. If you are self-hosting and this is your own model server, add it to AI_ALLOWED_HOSTS (e.g. AI_ALLOWED_HOSTS=${host}) and restart. On runbutter.app, expose the model over a public https URL instead — our servers cannot reach your network.`
    : `${host} is a private address and is not in AI_ALLOWED_HOSTS. Add it there and restart. Cloud metadata addresses stay blocked whatever the list says.`;
}

// ── What a call cost ────────────────────────────────────────────────────────

/**
 * What a turn cost, as the provider itself reported it.
 *
 * COUNTED, NEVER ESTIMATED. Every provider returns this on every response and
 * RunButter threw it away, so nobody could answer "what did that agent cost" —
 * the one question a BYO-key customer actually has. `cached` is the part of
 * `input` that was served from a prompt cache; it is a subset, not an addition,
 * which is why the UI must never add the two together.
 *
 * All zeros is a legitimate answer: a gateway that omits `usage` is common, and
 * reporting zero is honest where inventing a number from character counts is
 * not. The UI says "not reported" rather than "0" for exactly that reason.
 */
export interface Usage { input: number; output: number; cached: number }

export const noUsage = (): Usage => ({ input: 0, output: 0, cached: 0 });
export const addUsage = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input, output: a.output + b.output, cached: a.cached + b.cached,
});

const num = (v: any) => (typeof v === 'number' && isFinite(v) && v > 0 ? Math.round(v) : 0);

/** Anthropic: cache reads are reported OUTSIDE input_tokens, so they are added
 *  back to make `input` mean "everything that went in" on every provider. */
const anthropicUsage = (u: any): Usage => ({
  input: num(u?.input_tokens) + num(u?.cache_read_input_tokens) + num(u?.cache_creation_input_tokens),
  output: num(u?.output_tokens),
  cached: num(u?.cache_read_input_tokens),
});

/** OpenAI-compatible: prompt_tokens already INCLUDES the cached part. */
const openaiUsage = (u: any): Usage => ({
  input: num(u?.prompt_tokens),
  output: num(u?.completion_tokens),
  cached: num(u?.prompt_tokens_details?.cached_tokens),
});

const geminiUsage = (u: any): Usage => ({
  input: num(u?.promptTokenCount),
  output: num(u?.candidatesTokenCount),
  cached: num(u?.cachedContentTokenCount),
});

/**
 * OpenRouter reports usage only when asked.
 *
 * It proxies dozens of upstreams and normalises the `usage` block for you, but
 * only if the request opts in — otherwise a request that really did cost money
 * comes back with no counts at all and lands in the "not reported" bucket. Sent
 * to OpenRouter alone: an unknown key in the body is a 400 on some strict
 * OpenAI-compatible gateways, and `custom` is by definition a server we have
 * never seen.
 */
const openrouterUsage = (provider: AIProvider) =>
  (provider === 'openrouter' ? { usage: { include: true } } : {});

// Explicit output ceiling on EVERY provider. Without it, OpenAI-compatible
// gateways assume the model max (e.g. 16k) and pre-check affordability against
// that ceiling — free/low-credit accounts get rejected before a single token.
// ~1k tokens comfortably fits a one-page draft.
const MAX_OUTPUT_TOKENS = 2048;

/**
 * The reply was cut off, and that is a different failure from a bad reply.
 *
 * WHY THIS IS ITS OWN ERROR. Three of the five callers parse the reply as JSON.
 * A truncated reply fails that parse, and the message the user got was "The
 * model did not return a plan. Try describing the business in a sentence or
 * two." — advice that cannot work, about a cause that was never mentioned, on a
 * request that was billed in full. Rewording the description does nothing when
 * the ceiling is the problem.
 *
 * REASONING MODELS MADE THIS ROUTINE. A model that thinks before answering
 * spends OUTPUT tokens doing it, so at a 1024 ceiling it can exhaust the budget
 * before writing a single character of JSON. That is why this started showing
 * up with Kimi and DeepSeek-R1 through OpenRouter and not with gpt-4o.
 */
class TruncatedReply extends Error {
  constructor(maxTokens: number, wroteNothing: boolean) {
    super(
      wroteNothing
        ? `The model used its entire ${maxTokens}-token budget thinking and never wrote an answer. Reasoning models (Kimi, DeepSeek-R1, o1) need a larger ceiling — or pick a non-reasoning model like gpt-4o-mini or claude-haiku for this.`
        : `The model's reply was cut off at ${maxTokens} tokens, so it is incomplete. Ask for something smaller, or use a model that answers more concisely.`,
    );
    this.name = 'TruncatedReply';
  }
}

/**
 * Reasoning models emit their thinking inline, in one of two shapes: a
 * `<think>` block inside the content, or a separate `reasoning` field with the
 * answer in `content`. The block form breaks JSON extraction, because a chain
 * of thought is full of braces and "first { to last }" then spans the thinking
 * and the answer together.
 */
function stripThinking(text: string): string {
  return text
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    // An unclosed block means the reply was cut off mid-thought; everything
    // after the opening tag is thinking, not answer.
    .replace(/<think(?:ing)?>[\s\S]*$/i, '')
    .trim();
}

/**
 * `maxTokens` is per call because 1024 is the right ceiling for a one-page draft
 * and the wrong one for a whole skill: a SKILL.md with an output contract, a
 * worked example and a verification checklist runs past it, and the truncation
 * arrives as invalid JSON with no clue attached. Callers that need more say so;
 * the default stays low for the affordability reason above.
 */
export interface AIReply { text: string; usage: Usage }

export async function callAI(provider: AIProvider, apiKey: string, model: string, system: string, prompt: string, baseUrl?: string, maxTokens: number = MAX_OUTPUT_TOKENS): Promise<AIReply> {
  if (provider === 'claude') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: maxTokens,
        // Cached for the same reason the agent loop caches: these system
        // prompts are large (the workspace builder ships two whole templates as
        // few-shot examples) and byte-identical across calls, and
        // `/api/plugins/generate` sends the same one up to three times in one
        // request. A hint, not a contract — under the model's minimum cacheable
        // length it is ignored and the call behaves exactly as before, so there
        // is no fallback path to maintain.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || `Claude ${r.status}`);
    const text = stripThinking((d.content || []).map((b: any) => b.text || '').join(''));
    if (d.stop_reason === 'max_tokens') throw new TruncatedReply(maxTokens, !text);
    return { text, usage: anthropicUsage(d.usage) };
  }

  if (provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || `Gemini ${r.status}`);
    const c = d.candidates?.[0];
    const text = stripThinking((c?.content?.parts || []).map((p: any) => p.text || '').join(''));
    if (c?.finishReason === 'MAX_TOKENS') throw new TruncatedReply(maxTokens, !text);
    return { text, usage: geminiUsage(d.usageMetadata) };
  }

  // openai, openrouter, and custom endpoints all speak the OpenAI chat format
  const base = provider === 'custom'
    ? (baseUrl || '').replace(/\/+$/, '')
    : provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
  if (!base) throw new Error('Custom provider needs a base URL (e.g. https://api.groq.com/openai/v1)');
  // Re-check stored URLs at call time too (SSRF guard; rows may predate 0038 validation).
  if (provider === 'custom' && !isAllowedAiHost(base)) throw new Error(privateHostMessage(base));
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      ...openrouterUsage(provider),
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || `${provider} ${r.status}`);
  const choice = d.choices?.[0];
  const text = stripThinking(choice?.message?.content || '');
  // `length` is the OpenAI-compatible word for "hit max_tokens". OpenRouter
  // passes it through from whichever upstream served the request.
  if (choice?.finish_reason === 'length') throw new TruncatedReply(maxTokens, !text);
  // A model that returned only `reasoning` and no content did the same thing
  // without admitting it — some gateways report `stop` regardless.
  if (!text && choice?.message?.reasoning) throw new TruncatedReply(maxTokens, true);
  return { text, usage: openaiUsage(d.usage) };
}

// ── Tool-calling (agent runner) ──────────────────────────────────────────────
// A single model turn that MAY return tool calls. The runner drives the loop:
// it sends history + tool defs, gets back either text (done) or tool calls,
// executes them, appends results, and calls again. Provider-native formats are
// normalised to this shape. Gemini has no tool support here yet — it returns
// text only (still useful for read-only/reasoning agents).
export interface ToolSpec { name: string; description: string; parameters: any }
export interface AgentToolCall { id: string; name: string; args: any }
export interface AgentTurn { text: string; toolCalls: AgentToolCall[] }
// `history` is an opaque provider-shaped message list the runner threads back in.
export interface AgentTurnResult extends AgentTurn { history: any[]; usage: Usage }


const AGENT_MAX_TOKENS = 2048;

export async function agentTurn(
  provider: AIProvider, apiKey: string, model: string, system: string,
  history: any[], tools: ToolSpec[], baseUrl?: string,
): Promise<AgentTurnResult> {
  if (provider === 'claude') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: AGENT_MAX_TOKENS, messages: history,
        // ── The single biggest waste in an agent run ────────────────────────
        // Tools and the system prompt are IDENTICAL on every turn of a loop
        // that runs up to 40 of them, and were re-sent and re-billed in full
        // each time. Anthropic orders the prompt tools → system → messages, so
        // one breakpoint at the end of `system` caches both.
        //
        // It is a hint, not a contract: below the model's minimum cacheable
        // length the header is ignored and the call behaves exactly as before,
        // which is why this needs no fallback path.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || `Claude ${r.status}`);
    const blocks = d.content || [];
    const text = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
    const toolCalls: AgentToolCall[] = blocks.filter((b: any) => b.type === 'tool_use')
      .map((b: any) => ({ id: b.id, name: b.name, args: b.input || {} }));
    return { text, toolCalls, history: [...history, { role: 'assistant', content: blocks }], usage: anthropicUsage(d.usage) };
  }

  if (provider === 'gemini') {
    // No tool loop for Gemini yet — single text answer from the conversation.
    const contents = history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] }));
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: AGENT_MAX_TOKENS } }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || `Gemini ${r.status}`);
    const text = (d.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim();
    return { text, toolCalls: [], history: [...history, { role: 'assistant', content: text }], usage: geminiUsage(d.usageMetadata) };
  }

  // OpenAI chat format (openai / openrouter / custom)
  const base = provider === 'custom'
    ? (baseUrl || '').replace(/\/+$/, '')
    : provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
  if (!base) throw new Error('Custom provider needs a base URL');
  if (provider === 'custom' && !isAllowedAiHost(base)) throw new Error(privateHostMessage(base));
  const messages = [{ role: 'system', content: system }, ...history];
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: AGENT_MAX_TOKENS, messages,
      tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
      tool_choice: 'auto',
      ...openrouterUsage(provider),
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || `${provider} ${r.status}`);
  const m = d.choices?.[0]?.message || {};
  const toolCalls: AgentToolCall[] = (m.tool_calls || []).map((c: any) => ({
    id: c.id, name: c.function?.name, args: safeJson(c.function?.arguments),
  }));
  return { text: (m.content || '').trim(), toolCalls, history: [...history, m], usage: openaiUsage(d.usage) };
}

// Append a tool result to history in the provider's expected shape.
export function appendToolResult(provider: AIProvider, history: any[], call: AgentToolCall, result: any): any[] {
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  if (provider === 'claude') {
    return [...history, { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: text }] }];
  }
  // OpenAI format
  return [...history, { role: 'tool', tool_call_id: call.id, name: call.name, content: text }];
}

function safeJson(s: any): any { try { return typeof s === 'string' ? JSON.parse(s) : (s || {}); } catch { return {}; } }
