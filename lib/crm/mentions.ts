/**
 * @-mentions: `rb-ref:<object>:<uuid>` in the text, a live label at render.
 *
 * ── WHY A TOKEN AND NOT THE NAME ────────────────────────────────────────────
 * The same decision lib/files/embeds.ts makes for `rb-file:<uuid>`. If the body
 * held "Acme Industries", a message from March would keep naming a client who
 * changed their name in April, and renaming a company would mean rewriting
 * every doc that ever mentioned it. Storing the id means the text is a
 * reference; the name is looked up when somebody reads it.
 *
 * It also survives everything the plain string survives — markdown round trips,
 * exports, an agent transcript, a copy-paste into an email — which a rendered
 * <span> would not.
 *
 * ── THE FORMAT IS DELIBERATELY BORING ───────────────────────────────────────
 * Lowercase object slug, then a uuid. No display text baked in, no nesting, no
 * escaping rules. Anything a regex cannot read in one pass is a format somebody
 * will eventually corrupt by editing around it.
 *
 * Zero imports, so this is usable from a route handler as well as a component.
 */

export interface Ref { object: string; id: string }

/** `rb-ref:companies:8b1e…` — the whole grammar. */
const REF = /rb-ref:([a-z0-9_]+):([0-9a-fA-F-]{36})/g;

export const toToken = (r: Ref) => `rb-ref:${r.object}:${r.id}`;

/** Every ref in a body, de-duplicated — a doc naming one client six times is one lookup. */
export function extractRefs(text: string): Ref[] {
  const seen = new Set<string>();
  const out: Ref[] = [];
  for (const m of String(text || '').matchAll(REF)) {
    const key = `${m[1]}:${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ object: m[1], id: m[2] });
  }
  return out;
}

export type Piece =
  | { kind: 'text'; text: string }
  | { kind: 'ref'; object: string; id: string };

/**
 * Split a body into text and refs, in order, for rendering.
 *
 * Returns PIECES rather than HTML on purpose: the caller builds React nodes, so
 * a company called `<script>` is text in a text node rather than markup this
 * function had to remember to escape. `search_files` renders its «» snippets
 * the same way, for the same reason.
 */
export function splitMentions(text: string): Piece[] {
  const src = String(text || '');
  const out: Piece[] = [];
  let last = 0;
  for (const m of src.matchAll(REF)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: src.slice(last, at) });
    out.push({ kind: 'ref', object: m[1], id: m[2] });
    last = at + m[0].length;
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) });
  return out;
}

/** Where a mention links to. Custom objects share the built-in record route. */
export function refHref(object: string, id: string): string {
  if (object === 'docs') return `/docs/${id}`;
  if (object === 'projects') return `/projects/${id}`;
  return `/objects/${object}?ref=${id}`;
}

/**
 * The `@…` the user is currently typing, if any.
 *
 * Anchored to the caret and refusing anything with a newline or more than a few
 * words, because "@" is a character people also type in email addresses and
 * prices — an autocomplete that opens on `a@b.com` is worse than none.
 */
export function activeQuery(value: string, caret: number): { at: number; query: string } | null {
  const upto = value.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;
  // Must start a word: preceded by nothing, whitespace, or an opening bracket.
  const before = at === 0 ? '' : upto[at - 1];
  if (before && !/[\s(\[]/.test(before)) return null;
  const query = upto.slice(at + 1);
  if (/[\n\r]/.test(query) || query.length > 40) return null;
  return { at, query };
}

/**
 * Replace the in-progress `@…` with a token, and say where the caret lands.
 *
 * A trailing space is added so the next word does not run into the token — but
 * ONLY when there is not one already. Picking a mention in the middle of
 * "chase @ac now" otherwise leaves a double space, which nobody notices while
 * typing and everybody sees in the sent message.
 */
export function applyMention(value: string, at: number, caret: number, ref: Ref): { text: string; caret: number } {
  const token = toToken(ref);
  const rest = value.slice(caret);
  const gap = /^\s/.test(rest) ? '' : ' ';
  return { text: `${value.slice(0, at)}${token}${gap}${rest}`, caret: at + token.length + gap.length };
}
