// What a model costs, when we can honestly say.
//
// ── WHY THIS FILE RESISTED BEING WRITTEN ────────────────────────────────────
// Every usage screen so far reports TOKENS and refuses to report money, on the
// grounds that a hardcoded price table is wrong the week after it is written.
// That reasoning is right about hardcoded tables and wrong as a final answer:
// "which agent is burning my money" is a question in POUNDS, and answering it
// in tokens makes the person do arithmetic against a page they have to go and
// find. Refusing to help is not the same as being honest.
//
// So prices are given, under three rules that keep the number trustworthy:
//
//   1. AN UNKNOWN MODEL COSTS `null`, NEVER ZERO. A model this table has not
//      heard of — a new release, a fine-tune, an OpenRouter id, somebody's local
//      Ollama — reports "no price" and is EXCLUDED from the total, and the total
//      says so. A confident figure that silently omits an unknown share is the
//      exact failure the token-only screens were built to avoid.
//   2. EVERY ENTRY IS DATED. `AS_OF` is what a stale table looks like from the
//      outside: the UI shows it, so somebody reading a cost knows how old the
//      arithmetic behind it is.
//   3. THE WORKSPACE CAN OVERRIDE IT. Negotiated rates, OpenRouter's per-upstream
//      pricing and a self-hosted model that costs nothing are all real, and none
//      of them are knowable from here. Overrides live in the database (0104) and
//      always win.
//
// Prices are USD per MILLION tokens, which is how every provider publishes them
// — storing per-token would mean six leading zeros in the source and a typo
// nobody could see.

/** When these numbers were last checked against the providers' public pricing. */
export const AS_OF = '2026-08';

export interface ModelPrice {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
  /**
   * USD per million tokens READ from a prompt cache, when the provider bills
   * them differently. Anthropic charges about a tenth for a cache read, which
   * is the single biggest lever on an agent's bill — a 40-turn loop is mostly
   * the same system prompt over and over. Omitted means "billed as input".
   */
  cached?: number;
}

/**
 * Keyed by model id, matched EXACTLY first and then by prefix.
 *
 * Prefix matching is what makes dated ids work: `claude-haiku-4-5-20251001` is
 * the same price as `claude-haiku-4-5`, and a table that demanded the full
 * string would report "no price" for the id the product actually sends.
 */
const PRICES: Record<string, ModelPrice> = {
  // ── Anthropic ──
  'claude-opus-5': { input: 15, output: 75, cached: 1.5 },
  'claude-sonnet-5': { input: 3, output: 15, cached: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cached: 0.1 },
  'claude-opus-4': { input: 15, output: 75, cached: 1.5 },
  'claude-sonnet-4': { input: 3, output: 15, cached: 0.3 },
  'claude-3-7-sonnet': { input: 3, output: 15, cached: 0.3 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cached: 0.08 },
  // ── OpenAI ──
  'gpt-4o-mini': { input: 0.15, output: 0.6, cached: 0.075 },
  'gpt-4o': { input: 2.5, output: 10, cached: 1.25 },
  'gpt-4.1': { input: 2, output: 8, cached: 0.5 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6, cached: 0.1 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4, cached: 0.025 },
  'o4-mini': { input: 1.1, output: 4.4, cached: 0.275 },
  'o3': { input: 2, output: 8, cached: 0.5 },
  // ── Google ──
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  // ── DeepSeek ── (cache hits are billed separately and are the cheapest going)
  'deepseek-chat': { input: 0.27, output: 1.1, cached: 0.07 },
  'deepseek-reasoner': { input: 0.55, output: 2.19, cached: 0.14 },
  'deepseek-v3': { input: 0.27, output: 1.1, cached: 0.07 },
  'deepseek-r1': { input: 0.55, output: 2.19, cached: 0.14 },
  // ── Moonshot / Kimi ──
  'kimi-k2': { input: 0.6, output: 2.5, cached: 0.15 },
  'moonshot-v1-128k': { input: 2, output: 5 },
  // ── Mistral ──
  'mistral-large': { input: 2, output: 6 },
  'mistral-small': { input: 0.1, output: 0.3 },
  'open-mistral-nemo': { input: 0.15, output: 0.15 },
  'codestral': { input: 0.3, output: 0.9 },
  // ── Meta Llama (typical hosted rates) ──
  'llama-3.3-70b': { input: 0.6, output: 0.7 },
  'llama-3.1-8b': { input: 0.05, output: 0.08 },
  'llama-3.1-70b': { input: 0.6, output: 0.7 },
  'llama-3.1-405b': { input: 3, output: 3 },
  // ── Qwen ──
  'qwen3-32b': { input: 0.3, output: 0.5 },
  'qwen-2.5-72b': { input: 0.35, output: 0.4 },
  'qwen2.5-coder': { input: 0.18, output: 0.18 },
  // ── xAI ──
  'grok-4': { input: 3, output: 15, cached: 0.75 },
  'grok-3': { input: 3, output: 15, cached: 0.75 },
  'grok-3-mini': { input: 0.3, output: 0.5, cached: 0.075 },
  // ── Open-weight, commonly hosted ──
  'gpt-oss-120b': { input: 0.15, output: 0.6 },
  'gpt-oss-20b': { input: 0.05, output: 0.2 },
};

/**
 * Anything ending `:free` is free, whatever else the table says.
 *
 * OpenRouter's convention, and it is worth encoding rather than listing: the
 * default OpenRouter model in `PROVIDERS` is a `:free` one, so without this the
 * commonest zero-cost setup in the product would report "no price" and drag
 * every total into "partial".
 */
const FREE_SUFFIX = ':free';

export function priceFor(model: string, overrides?: Record<string, ModelPrice>): ModelPrice | null {
  // Leading punctuation is stripped. A real workspace was storing
  // `~deepseek/deepseek-v4-flash-latest` — gateways and routers prefix ids with
  // `~`, `@` or a slash to mark a variant or a floating alias, and every one of
  // those made an otherwise-known model report "no price". The symptom was a
  // usage panel reading "20 unpriced" on a workspace whose only model was one
  // this table knows perfectly well.
  const id = String(model || '').trim().toLowerCase().replace(/^[^a-z0-9]+/, '');
  if (!id) return null;
  if (id.endsWith(FREE_SUFFIX)) return { input: 0, output: 0, cached: 0 };

  // A workspace's own numbers beat ours, always — they are the ones being
  // billed, and they know their rate.
  if (overrides) {
    if (overrides[id]) return overrides[id];
    for (const [k, v] of Object.entries(overrides)) if (id.startsWith(k.toLowerCase())) return v;
  }

  if (PRICES[id]) return PRICES[id];
  // An OpenRouter id is `vendor/model`, sometimes with a `:tag`. The bare model
  // is what our table knows, so the vendor prefix and any tag come off before
  // the prefix match — otherwise every OpenRouter row reports "no price".
  // `vendor/model:tag` -> `model`. Trailing version words are also dropped for
  // the prefix pass below: `-latest`, `-preview` and a date suffix are floating
  // aliases for a model that IS in the table, and refusing to price them
  // punishes anyone who followed the provider's own recommendation to use one.
  const bare = id.split('/').pop()!.split(':')[0]
    .replace(/-(latest|preview|exp|instruct|versatile|instant)$/g, '')
    .replace(/-\d{8}$/, '');
  if (PRICES[bare]) return PRICES[bare];

  // Longest prefix wins: `gpt-4.1` must not match a hypothetical `gpt-4` entry
  // when a more specific one exists.
  let best: ModelPrice | null = null; let bestLen = 0;
  for (const [k, v] of Object.entries(PRICES)) {
    if ((id.startsWith(k) || bare.startsWith(k)) && k.length > bestLen) { best = v; bestLen = k.length; }
  }
  return best;
}

export interface Spend { usd: number; priced: boolean }

/**
 * What a bundle of tokens cost.
 *
 * `cached` is a SUBSET of `input` on every provider (the client folds
 * Anthropic's out-of-band cache reads in before storing), so the uncached part
 * is `input - cached` and the two are never added. Getting this backwards
 * double-counts the cheap half of the bill, which is why it is done here once
 * rather than at three call sites.
 */
export function spendFor(
  model: string,
  tokens: { input: number; output: number; cached: number },
  overrides?: Record<string, ModelPrice>,
): Spend {
  const p = priceFor(model, overrides);
  if (!p) return { usd: 0, priced: false };
  const cached = Math.min(Math.max(tokens.cached || 0, 0), Math.max(tokens.input || 0, 0));
  const fresh = Math.max((tokens.input || 0) - cached, 0);
  const cachedRate = p.cached ?? p.input;
  const usd =
    (fresh * p.input + cached * cachedRate + Math.max(tokens.output || 0, 0) * p.output) / 1_000_000;
  return { usd, priced: true };
}

/**
 * Money, at the scale these numbers actually land on.
 *
 * A month of copilot use on Haiku is a few cents, and `$0.00` reads as free
 * rather than as small — so under a dollar keeps enough decimals to be a number
 * somebody believes, and anything under a tenth of a cent says so instead of
 * rounding itself away.
 */
export function fmtUSD(usd: number): string {
  if (!isFinite(usd) || usd <= 0) return '$0';
  if (usd < 0.001) return '<$0.001';
  if (usd < 1) return `$${usd.toFixed(3)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd).toLocaleString()}`;
}

// ── Before the call, not after ──────────────────────────────────────────────

/**
 * What a call is ABOUT to cost.
 *
 * THE HONEST ANSWER IS A RANGE, NOT A NUMBER, and the reason is not solvable:
 * output length is decided by the model while it generates. Anything quoting a
 * single figure up front has either guessed the output or ignored it.
 *
 * What IS knowable before sending:
 *   • the input, exactly — it is the prompt, and it is in hand;
 *   • the output CEILING, exactly — `max_tokens` is a number we set.
 *
 * So this returns a floor (input only) and a ceiling (input plus a full-length
 * reply). The real answer lands between them, and somebody deciding whether to
 * point an agent at four hundred records wants the ceiling.
 */
export interface Forecast { floor: number; ceiling: number; priced: boolean }

export function forecast(
  model: string,
  inputTokens: number,
  maxOutputTokens: number,
  overrides?: Record<string, ModelPrice>,
): Forecast {
  const p = priceFor(model, overrides);
  if (!p) return { floor: 0, ceiling: 0, priced: false };
  const inUsd = (Math.max(inputTokens, 0) * p.input) / 1_000_000;
  const outUsd = (Math.max(maxOutputTokens, 0) * p.output) / 1_000_000;
  return { floor: inUsd, ceiling: inUsd + outUsd, priced: true };
}

/**
 * Tokens from characters, for the moment before a call when nothing better
 * exists.
 *
 * ~3.7 characters per token is a fair average for English prose and is WRONG
 * for code, JSON and non-Latin scripts — all three of which this product sends
 * constantly. Rounded UP deliberately: an estimate used to answer "can I afford
 * this" should err towards the expensive answer, because the failure mode in
 * the other direction is a bill.
 *
 * NEVER use this to report what something COST. Providers return exact counts
 * on every response and those are what gets stored; this exists only for the
 * moment before a call, when there is no counted number to have.
 */
export function approxTokens(text: string): number {
  return Math.ceil(String(text || '').length / 3.7);
}
