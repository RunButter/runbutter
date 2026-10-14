// Web search for a company's own website — the free way from a German (or
// Spanish, or British…) VAT number to a company when no register will say whose
// it is.
//
// Every German business site must print its VAT ID in its Impressum, and search
// engines index those pages. So: search the quoted number, keep the results that
// are the COMPANY'S OWN site (not a directory that copied it), and read that
// site's legal notice. The server accepts a site only when its legal notice
// carries the exact number typed (lookupCompany's `candidates`), so a search
// result is a lead, never an answer.
//
// The search is Firecrawl's keyless API (no key, a free monthly allowance per
// caller, CORS open). It runs in the PERSON'S BROWSER, the same way Find leads
// reads the open map data, so each person searches on their own allowance and
// the server's address never gets rate-limited for everyone. The server uses it
// too (the Copilot has no browser), with FIRECRAWL_API_KEY when an operator sets
// one. Verified live 2026-10: "DE137222785" → the company's own PDFs and site.
//
// ISOMORPHIC: fetch only, no imports.

export interface WebHit { url: string; title: string; description: string }

const ENDPOINT = 'https://api.firecrawl.dev/v2/search';

export async function searchWeb(query: string, opts: { limit?: number; key?: string; timeoutMs?: number } = {}): Promise<WebHit[]> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(opts.key ? { authorization: `Bearer ${opts.key}` } : {}) },
    body: JSON.stringify({ query: String(query).slice(0, 200), limit: Math.min(10, opts.limit ?? 8) }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
  if (res.status === 429 || res.status === 402) throw new Error('the free web search allowance is used up for now');
  if (!res.ok) throw new Error(`web search answered HTTP ${res.status}`);
  const j = await res.json().catch(() => null);
  const web: any[] = Array.isArray(j?.data?.web) ? j.data.web : Array.isArray(j?.data) ? j.data : [];
  return web
    .map((w) => ({ url: String(w?.url || ''), title: String(w?.title || '').slice(0, 200), description: String(w?.description || '').slice(0, 400) }))
    .filter((w) => /^https?:\/\//i.test(w.url));
}

/**
 * Hosts that list OTHER companies — registers, directories, review and social
 * sites. Their pages carry the number too, but reading them is reading someone
 * else's copy; the company's own legal notice is the source.
 */
const DIRECTORIES = new RegExp('(^|\\.)(' + [
  'northdata\\.(de|com)', 'north-data\\.\\w+', 'wer-zu-wem\\.de', 'kompass\\.com', 'verif\\.com', 'companyhouse\\.de', 'firmenwissen\\.de',
  'implisense\\.com', 'dnb\\.com', 'opencorporates\\.com', 'openregister\\.de', 'unternehmensregister\\.de', 'handelsregister\\.de',
  'bundesanzeiger\\.de', 'peppol\\.eu', 'peppol-id\\.eu', 'helger\\.com', 'lei-lookup\\.com', 'gleif\\.org', 'leilookup\\.\\w+',
  'datocapital\\.\\w+', 'empresite\\.\\w+', 'eleconomista\\.es', 'infocif\\.es', 'einforma\\.com', 'axesor\\.es', 'infoempresa\\.com',
  'kununu\\.com', 'glassdoor\\.\\w+', 'indeed\\.\\w+', 'stepstone\\.\\w+', 'xing\\.com', 'linkedin\\.com', 'facebook\\.com', 'instagram\\.com',
  'twitter\\.com', 'x\\.com', 'youtube\\.com', 'wikipedia\\.org', 'wikidata\\.org', 'yelp\\.\\w+', 'trustpilot\\.com', 'gelbeseiten\\.de',
  'dasoertliche\\.de', 'dastelefonbuch\\.de', '11880\\.com', 'cylex[\\w.-]*', 'firmania\\.\\w+', 'creditreform\\.de', 'moneyhouse\\.ch',
  'zefix\\.ch', 'easymonitoring\\.ch', 'monetas\\.ch', 'ausschreibungen-deutschland\\.de', 'europa\\.eu', 'bund\\.de', 'vatify\\.eu',
  'vat-search\\.eu', 'vatcheckapi\\.com', 'vies\\.\\w+', 'google\\.\\w+', 'bing\\.com', 'apple\\.com', 'amazon\\.\\w+', 'ebay\\.\\w+',
  'companieshouse\\.gov\\.uk', 'company-information\\.service\\.gov\\.uk', 'endole\\.co\\.uk', 'companycheck\\.co\\.uk', 'find-and-update\\.\\w+',
  'pappers\\.fr', 'societe\\.com', 'infogreffe\\.fr', 'verif\\.\\w+', 'manageo\\.fr', 'annuaire-entreprises\\.data\\.gouv\\.fr',
  'firmy\\.cz', 'rejstrik-firem\\.\\w+', 'kurzy\\.cz', 'aleo\\.com', 'rejestr\\.io', 'krs-online\\.com\\.pl', 'panoramafirm\\.pl', 'owg\\.pl',
  'bizraport\\.pl', 'proff\\.\\w+', 'purehelp\\.no', 'allabolag\\.se', 'finder\\.fi', 'asiakastieto\\.fi', 'bloomberg\\.com', 'reuters\\.com',
  'crunchbase\\.com', 'zoominfo\\.com', 'rocketreach\\.co', 'apollo\\.io', 'lusha\\.com', 'datanyze\\.com', 'scribd\\.com', 'issuu\\.com',
].join('|') + ')$', 'i');

const host = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };

const LEGAL_PATH = /(impressum|imprint|legal[-_ ]?notice|mentions[-_ ]?l[ée]gales|aviso[-_ ]?legal|note[-_ ]?legali|colofon|nota[-_ ]?prawna)/i;

/**
 * The result pages that are a company's OWN site, best first, at most `max`,
 * one per host. A hit that IS the legal notice is kept as that page (it is the
 * page to read); anything else becomes the site's root.
 */
export function ownSites(hits: WebHit[], max = 4): string[] {
  const byHost = new Map<string, string>();
  for (const h of hits) {
    const hn = host(h.url);
    if (!hn || DIRECTORIES.test(hn) || /\.(gov|gouv|gob|gv)\.|(^|\.)gov$/.test(hn)) continue;
    let u: URL;
    try { u = new URL(h.url); } catch { continue; }
    const legal = LEGAL_PATH.test(u.pathname) ? `${u.protocol}//${u.host}${u.pathname}` : '';
    const have = byHost.get(hn);
    if (!have) { if (byHost.size >= max) continue; byHost.set(hn, legal || `${u.protocol}//${u.host}/`); }
    else if (legal && !LEGAL_PATH.test(have)) byHost.set(hn, legal);
  }
  return [...byHost.values()];
}

const FORM = /\b(GmbH\s*&\s*Co\.?\s*KG|gGmbH|GmbH|mbH|UG(\s*\(haftungsbeschränkt\))?|AG|SE|KGaA|KG|OHG|GbR|e\.\s?K\.|e\.\s?V\.|S\.?L\.?U?|S\.?A\.?U?|SAS|SARL|S\.r\.l\.|S\.p\.A\.|B\.?V\.?|N\.?V\.?|Ltd\.?|Limited|LLP|PLC|LLC|Inc\.?|Oy|AB|ApS|A\/S|AS|s\.r\.o\.|sp\.\s*z\s*o\.\s*o\.)(?=$|[\s,.;:|)\-–—])/i;

/**
 * Company names the result titles and snippets agree on ("Terma GmbH, Darmstadt
 * - North Data" → "Terma GmbH"), most-mentioned first. These are HINTS for a
 * second search; nothing is filled in from them.
 */
export function nameHints(hits: WebHit[], max = 2): string[] {
  const count = new Map<string, { name: string; n: number }>();
  for (const h of hits) {
    for (const text of [h.title, h.description]) {
      for (const part of text.split(/\s[-–—|·]\s|[,;(\n]|\s{2,}|#+\s/)) {
        const m = FORM.exec(part);
        if (!m) continue;
        const name = part.slice(0, m.index + m[0].length)
          // A label or a sentence before the name: keep what follows it.
          .replace(/^.*(?:[:.]\s|\b(?:tilhører|belongs to|gehört zu|kuulub ettevõttele|Offizielle Bezeichnung|Impressum der|Impressum des|Impressum)\s+)/i, '')
          .replace(/^[\s:#·]+/, '').trim();
        const words = name.split(/\s+/);
        if (words.length < 2 || words.length > 8 || name.length > 80 || /\d{4,}/.test(name)) continue;
        // "Public Limited", "Company Type GmbH": a form with no name in front of it.
        const rest = name.slice(0, name.length - m[0].length).trim();
        if (!rest || /^(public|private|company|type|the|a|eine?|die|der)$/i.test(rest)) continue;
        const key = name.toLowerCase().replace(/\s+/g, ' ');
        const c = count.get(key);
        count.set(key, { name: c?.name ?? name, n: (c?.n ?? 0) + 1 });
      }
    }
  }
  return [...count.values()].sort((a, b) => b.n - a.n).slice(0, max).map((c) => c.name);
}

/** What a company's legal page is called where it is based — the word that finds it. */
const LEGAL_WORD: Record<string, string> = {
  DE: 'Impressum', AT: 'Impressum', CH: 'Impressum', LI: 'Impressum',
  FR: '"mentions légales"', BE: '"mentions légales"', LU: '"mentions légales"', ES: '"aviso legal"', IT: '"note legali"',
  NL: '"KvK" "btw"', PL: '"NIP"', PT: '"NIF"', GB: '"VAT number"', IE: '"VAT number"', XI: '"VAT number"',
};

/** The second search: the company's name plus its country's word for a legal notice. */
export const legalQuery = (name: string, country: string) => `"${name}" ${LEGAL_WORD[String(country).toUpperCase()] || '"VAT"'}`;
