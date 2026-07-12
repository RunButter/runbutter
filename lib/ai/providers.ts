// BYO-key AI adapter. The user supplies their own provider key (stored encrypted);
// HireBTR just proxies the call, so there is no platform token cost. No SDKs —
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
