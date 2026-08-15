/**
 * A short, vetted directory of public APIs that need no key.
 *
 * ── WHY A CURATED SHORTLIST AND NOT A MIRROR OF public-apis ─────────────────
 * github.com/public-apis/public-apis lists roughly 1,400 entries. Shipping all
 * of them would be a worse product, not a bigger one: most need a key, many are
 * dead, several are single-person side projects that will disappear, and a
 * picker with 1,400 rows is a search box over other people's uptime.
 *
 * So this is a shortlist against four rules, and every entry meets all four:
 *
 *   1. NO KEY. A connection you can add and use in one click. Anything needing
 *      a signup belongs in the manual form, where you paste your own URL.
 *   2. HTTPS, on a real host. Each URL below passes `isSafeOutboundUrl`, which
 *      is what `call_connection` enforces anyway — an owner-saved URL is still
 *      not automatically a safe one.
 *   3. USEFUL TO A BUSINESS, not a novelty. No dog pictures, no chuck-norris
 *      jokes, no random quotes. This is a directory inside a company OS.
 *   4. RUN BY SOMEONE WHO WILL STILL EXIST. Central banks, government
 *      registries, standards bodies and long-lived public infrastructure.
 *
 * ── IT CREATES A `connections` ROW AND NOTHING ELSE ─────────────────────────
 * This changes no security property. `call_connection` remains the only tool
 * that leaves the workspace, the model still picks a SAVED ROW BY ID and never
 * supplies a URL, and `isSafeOutboundUrl` still runs on every call. All this
 * does is stop the first step being "type a URL from memory".
 *
 * Zero imports, so a route handler and a client component can both read it.
 */

export interface PublicApi {
  id: string;
  name: string;
  /** What it answers, in the words somebody would use asking for it. */
  blurb: string;
  url: string;
  group: 'Finance' | 'Company data' | 'Location' | 'Time' | 'Web';
  /** A concrete call, so the first thing you try works. */
  example: string;
  /** Who runs it — the reason to trust it still being there next year. */
  operator: string;
}

export const API_DIRECTORY: PublicApi[] = [
  {
    id: 'ecb-fx',
    name: 'ECB exchange rates',
    blurb: 'Official euro reference rates, updated every business day.',
    url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
    group: 'Finance',
    example: 'GET the daily XML — the same feed /api/fx/refresh already uses.',
    operator: 'European Central Bank',
  },
  {
    id: 'frankfurter',
    name: 'Frankfurter',
    blurb: 'ECB rates as JSON, including historical dates and conversion.',
    url: 'https://api.frankfurter.dev/v1/latest',
    group: 'Finance',
    example: '/v1/2026-03-01?base=EUR&symbols=USD,PLN',
    operator: 'Open source, ECB data',
  },
  {
    id: 'vies',
    name: 'EU VAT (VIES)',
    blurb: 'Check an EU VAT number and get the registered company name.',
    url: 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms/DE/vat/811907980',
    group: 'Company data',
    example: 'Already wired into Companies → VAT autofill.',
    operator: 'European Commission',
  },
  {
    id: 'gleif',
    name: 'GLEIF (LEI)',
    blurb: 'Legal Entity Identifiers: the official record behind a counterparty.',
    url: 'https://api.gleif.org/api/v1/lei-records',
    group: 'Company data',
    example: '?filter[entity.legalName]=Siemens',
    operator: 'Global LEI Foundation',
  },
  {
    id: 'bialalista',
    name: 'PL white list (Biała lista)',
    blurb: 'Polish VAT status and the bank accounts a company may legally be paid into.',
    url: 'https://wl-api.mf.gov.pl/api/search/nip/5260250274?date=2026-08-14',
    group: 'Company data',
    example: 'Already wired into Companies → NIP autofill.',
    operator: 'Polish Ministry of Finance',
  },
  {
    id: 'nager-holidays',
    name: 'Public holidays',
    blurb: 'Every public holiday for a country and year. Useful for due dates and rotas.',
    url: 'https://date.nager.at/api/v3/PublicHolidays/2026/PL',
    group: 'Time',
    example: '/api/v3/PublicHolidays/2026/DE',
    operator: 'Nager.Date, open source',
  },
  {
    id: 'worldtime',
    name: 'World time',
    blurb: 'Current time and UTC offset for any IANA timezone.',
    url: 'https://worldtimeapi.org/api/timezone/Europe/Warsaw',
    group: 'Time',
    example: '/api/timezone/America/New_York',
    operator: 'WorldTimeAPI',
  },
  {
    id: 'zippopotam',
    name: 'Postcode lookup',
    blurb: 'Turn a postcode into a place and coordinates, in 60 countries.',
    url: 'https://api.zippopotam.us/pl/00-001',
    group: 'Location',
    example: '/us/90210',
    operator: 'Zippopotam.us',
  },
  {
    id: 'nominatim',
    name: 'OpenStreetMap geocoding',
    blurb: 'An address to coordinates, and back. Fair-use limits, no key.',
    url: 'https://nominatim.openstreetmap.org/search?format=json&q=Berlin',
    group: 'Location',
    example: '?format=json&q=1600+Amphitheatre+Parkway',
    operator: 'OpenStreetMap Foundation',
  },
  {
    id: 'restcountries',
    name: 'Countries',
    blurb: 'Currency, calling code, languages and region for any country.',
    url: 'https://restcountries.com/v3.1/alpha/pl',
    group: 'Location',
    example: '/v3.1/alpha/de',
    operator: 'REST Countries',
  },
  {
    id: 'open-meteo',
    name: 'Weather',
    blurb: 'Forecast and history by coordinates. Genuinely keyless, generous limits.',
    url: 'https://api.open-meteo.com/v1/forecast?latitude=52.23&longitude=21.01&daily=temperature_2m_max',
    group: 'Location',
    example: 'Site visits, deliveries, outdoor crews.',
    operator: 'Open-Meteo, open source',
  },
  {
    id: 'ipapi-country',
    name: 'IP to country',
    blurb: 'Country for an IP address. Note: analytics here uses edge headers instead.',
    url: 'https://ipapi.co/8.8.8.8/json/',
    group: 'Web',
    example: 'Free tier is rate-limited; the built-in analytics never calls it.',
    operator: 'ipapi.co',
  },
];

export const API_GROUPS = ['Finance', 'Company data', 'Location', 'Time', 'Web'] as const;

export const apisByGroup = () =>
  API_GROUPS.map((g) => ({ group: g, items: API_DIRECTORY.filter((a) => a.group === g) }))
    .filter((s) => s.items.length);
