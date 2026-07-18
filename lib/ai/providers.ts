// BYO-key AI adapter. The user supplies their own provider key (stored encrypted);
// RunButter just proxies the call, so there is no platform token cost. No SDKs —
// plain REST — to keep deploys light. Non-streaming (simple + robust) for v1.
import { isSafeOutboundUrl } from '@/lib/security/http';

export type AIProvider = 'claude' | 'openai' | 'gemini' | 'openrouter' | 'custom';

export interface ProviderDef { id: AIProvider; label: string; help: string; models: string[] }

// Model lists are suggestions only — the field is free text, so users can type any
// model their key supports without us shipping a stale hardcoded list. The
// "custom" provider takes a base URL and covers every OpenAI-compatible API.
export const PROVIDERS: ProviderDef[] = [
  { id: 'claude', label: 'Claude (Anthropic)', help: 'console.anthropic.com → API keys', models: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'] },
  { id: 'openai', label: 'ChatGPT (OpenAI)', help: 'platform.openai.com → API keys', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'] },
  { id: 'gemini', label: 'Gemini (Google)', help: 'aistudio.google.com → API keys', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  { id: 'openrouter', label: 'OpenRouter', help: 'openrouter.ai → Keys (any model; ids ending in :free cost nothing)', models: ['meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-4o-mini', 'anthropic/claude-sonnet-5'] },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', help: 'Any OpenAI-compatible API: Groq, Mistral, DeepSeek, Together, xAI, Ollama, LiteLLM…', models: ['llama-3.3-70b-versatile', 'mistral-large-latest', 'deepseek-chat'] },
];
export const providerLabel = (p: string) => PROVIDERS.find((x) => x.id === p)?.label || p;

// Explicit output ceiling on EVERY provider. Without it, OpenAI-compatible
// gateways assume the model max (e.g. 16k) and pre-check affordability against
// that ceiling — free/low-credit accounts get rejected before a single token.
// ~1k tokens comfortably fits a one-page draft.
const MAX_OUTPUT_TOKENS = 1024;

export async function callAI(provider: AIProvider, apiKey: string, model: string, system: string, prompt: string, baseUrl?: string): Promise<string> {
  if (provider === 'claude') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: MAX_OUTPUT_TOKENS, system, messages: [{ role: 'user', content: prompt }] }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || `Claude ${r.status}`);
    return (d.content || []).map((b: any) => b.text || '').join('').trim();
  }

  if (provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS } }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || `Gemini ${r.status}`);
    return (d.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim();
  }

  // openai, openrouter, and custom endpoints all speak the OpenAI chat format
  const base = provider === 'custom'
    ? (baseUrl || '').replace(/\/+$/, '')
    : provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
  if (!base) throw new Error('Custom provider needs a base URL (e.g. https://api.groq.com/openai/v1)');
  // Re-check stored URLs at call time too (SSRF guard; rows may predate 0038 validation).
  if (provider === 'custom' && !isSafeOutboundUrl(base)) throw new Error('Custom base URL points at a private/unsafe host');
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: MAX_OUTPUT_TOKENS, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || `${provider} ${r.status}`);
  return (d.choices?.[0]?.message?.content || '').trim();
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
export interface AgentTurnResult extends AgentTurn { history: any[] }

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
        model, max_tokens: AGENT_MAX_TOKENS, system, messages: history,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || `Claude ${r.status}`);
    const blocks = d.content || [];
    const text = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
    const toolCalls: AgentToolCall[] = blocks.filter((b: any) => b.type === 'tool_use')
      .map((b: any) => ({ id: b.id, name: b.name, args: b.input || {} }));
    return { text, toolCalls, history: [...history, { role: 'assistant', content: blocks }] };
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
    return { text, toolCalls: [], history: [...history, { role: 'assistant', content: text }] };
  }

  // OpenAI chat format (openai / openrouter / custom)
  const base = provider === 'custom'
    ? (baseUrl || '').replace(/\/+$/, '')
    : provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
  if (!base) throw new Error('Custom provider needs a base URL');
  if (provider === 'custom' && !isSafeOutboundUrl(base)) throw new Error('Custom base URL points at a private/unsafe host');
  const messages = [{ role: 'system', content: system }, ...history];
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: AGENT_MAX_TOKENS, messages,
      tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
      tool_choice: 'auto',
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || `${provider} ${r.status}`);
  const m = d.choices?.[0]?.message || {};
  const toolCalls: AgentToolCall[] = (m.tool_calls || []).map((c: any) => ({
    id: c.id, name: c.function?.name, args: safeJson(c.function?.arguments),
  }));
  return { text: (m.content || '').trim(), toolCalls, history: [...history, m] };
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
