# Find leads

**Sales → Find leads** finds businesses of one kind in one place — dentists in
Kraków, restaurants within 2 km of an address, every accountant in a postcode —
and saves the ones you choose as **Leads**, ready to call, write to or send an
offer.

## Three sources

| | Free · open data (default) | Google · live | Google scraper |
|---|---|---|---|
| Data | [Overture Maps](https://overturemaps.org) — business listings from Meta, Microsoft and others; OpenStreetMap as the backup | Google Maps, through Google's official Places API | Google Maps, through a scraper you run |
| Cost | **Free, no key** | Your Google key; each month's first searches are free | Free, your server |
| Phone, website | Most businesses (see below) | Almost always | Almost always |
| Email, Facebook page | Often | — (Check websites finds emails) | — |
| Rating and reviews | — | Yes | Yes |
| Any kind of business | Anything you type | Anything you type | Anything you type |
| Speed | Seconds; the first search after a restart ~10 s | Seconds (a whole city: under a minute) | Minutes |
| Fresh | Monthly release | Live | Live |
| Set up | Nothing | Paste a key once | Run a container |

**How complete the free data is** — measured on the 2026-09 release:

| Search | Found | With phone | With website | With email |
|---|---|---|---|---|
| Dentists, Kraków | 280 | 274 | 247 | 218 |
| Dentists, New York (first 400 shown of 6,405) | 400 | 399 | 356 | 150 |
| Plumbers, Manhattan (3 km) | 62 | 61 | 51 | 7 |
| "Solar panel installer", Lagos | 89 | 88 | 68 | 79 |

## How it works

1. **Search.** Pick a kind of business (from cafés to roofers) — or, with a
   Google source, type any kind (*solar panel installer*, *wedding
   photographer*) — and a place. You get name, category, address, phone,
   website, opening hours, and from Google a rating and review count.
2. **Check websites.** Select results and press *Check websites*. RunButter
   reads up to three pages of each business's **own** website — the homepage and
   its Contact page — for a published email address, phone number and social
   links, and says what is wrong with the site itself: **down**, **invalid SSL
   certificate**, **no HTTPS**, **not mobile-friendly**, **slow**, and what it
   was built with (Wix, WordPress, Squarespace…). *Needs a website* then shows
   the businesses with no site or a broken one — the list to call if you sell
   websites, SEO or hosting.
3. **Save.** *Save to Leads* adds the selected businesses to **Leads**, a list
   under Sales with a Status (New, Contacted, Interested, Won, Not interested).
   A business already saved is marked and never saved twice. The website check,
   and a Google rating and review count where there is one, are saved with it.

After that, Leads is an ordinary record type: a table, a board grouped by
status, filters, CSV export, automations (*when a lead is created…*), and mail
merge — write one offer letter in Docs with `{{name}}` and `{{address}}`, and
get a copy for every lead.

The first time, an owner or admin presses **Set up Leads**, which creates that
list. Until then anyone can search and download results as CSV.

The Copilot can search too: *"find dentists in Kraków and save the ones with a
phone number as leads"* uses the `find_businesses` tool and then creates the
records. Reading websites for emails stays a button a person presses.

## Google · live (the official Places API)

The most complete, current data there is — and because it is an official API
called with a key, no server gets blocked for using it. Each workspace connects
its **own** Google key (owners and admins, on the Find leads screen), and Google
bills that key directly:

1. In [Google Cloud console](https://console.cloud.google.com/apis/library/places.googleapis.com),
   turn on **Places API (New)**. Google asks for a billing account even for the
   free monthly allowance.
2. Create an API key under *Credentials* and restrict it to the Places API.
   Don't restrict it to websites — the search runs on the server.
3. Paste it into Find leads → *Google · live*. RunButter checks it with one
   cheap call before saving it, encrypted. Nobody sees it again; the screen
   shows its last four characters.

**Getting past 60.** Google returns at most 60 places per search. *How far to
go* decides what happens when an area has more: **Top 60** is one search (up to
3 billed calls); **Whole area** and **Every street** split any area that comes
back full into quarters and search each one again, up to 30 or 90 calls. The
result says how many calls it used. Google's price list is at
[Google Maps Platform pricing](https://mapsplatform.google.com/pricing/) — the
phone and website fields put these calls in the *Text Search Enterprise* tier.

Google's terms let you show Places results to the person searching, and limit
**storing** them beyond the place id. Saving a lead is your decision; the screen
says so next to the choice.

A self-hoster can also set `GOOGLE_PLACES_API_KEY` on the server, which every
workspace without its own key then uses — and the server's owner pays for.

The **Copilot** uses Google too when the workspace has a key: *"find solar
installers in Lagos"* runs one *Top 60* search. Going wider stays a button a
person presses.

## Free · open data (Overture Maps)

The [Overture Maps Foundation](https://overturemaps.org) — Amazon, Meta,
Microsoft, TomTom and others — publishes about 70 million places worldwide as
open data, refreshed monthly, under the
[CDLA Permissive 2.0](https://cdla.dev/permissive-2-0/) licence: **free, no key,
and yours to keep** with attribution (the screen shows it). Most of it comes
from Meta's and Microsoft's business listings, so it carries a phone, a website,
an email and a Facebook page far more often than a volunteer-made map.

It is published as files on a public Amazon S3 bucket, not as a service. There
is nothing to be throttled by — the reason the OpenStreetMap servers kept
refusing a busy host. RunButter reads the files directly, fetching only the
part that covers the place you searched: Kraków is 5 of about 4,900 blocks,
New York 37. The first search after a restart reads the files' index (~7 s);
after that a city takes a few seconds. A whole country is too big and asks for
a city or a distance.

Each result links to the same business on **Google Maps** — one click to look
at its reviews and photos before you call. Nothing is sent to Google to make
that link.

If the open data cannot be reached, or has nothing of that kind in that place,
the search falls back to **OpenStreetMap** and says so. OpenStreetMap is ODbL —
free and storable with attribution — and strongest in Europe and in cities.

## Google Maps, through your own scraper (optional)

OpenStreetMap is thin in some places. If you run a server yourself, Find leads
can also search **Google Maps** through
[gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper) (MIT),
which **you** run as a separate service. RunButter never scrapes Google itself:
it sends that service a job (*"dentist in Kraków"*), comes back for it every few
seconds, and reads the results — with ratings and review counts — into the same
list. A search takes a few minutes; you can leave the page and the results wait
for you.

**Scraping Google Maps is against Google's terms of service.** That is why this
is off unless the operator switches it on, and why the screen says so next to
the choice. Whoever runs the scraper takes that on.

With the bundled `docker-compose.yml` it is one profile — set
`GMAPS_SCRAPER_URL=http://gmaps:8080` in `.env`, then
`docker compose --profile gmaps up`. Anywhere else:

```
# gosom's own web-mode command (its README, "Web UI"):
docker run -d --name gmaps -v "$PWD/gmapsdata:/gmapsdata" -p 8080:8080 \
  gosom/google-maps-scraper -data-folder /gmapsdata

# then, in RunButter's environment:
GMAPS_SCRAPER_URL=http://gmaps:8080
# Optional, if you put it behind a proxy that checks a bearer token:
GMAPS_SCRAPER_TOKEN=
```

Keep the scraper on a private network: its own API has no authentication. Jobs
are tied to the person who started them, so a job id in someone else's hands
shows them nothing. Email extraction is left off on the scraper — *Check
websites* does that, robots.txt and all.

## Importing a list you already have

**Import** on Leads (or Companies, or People) recognises the column names that
Google Maps scrapers and other tools export — `title`, `link`, `review_rating`,
`review_count`, `emails` from gosom; `totalScore`, `reviewsCount`,
`categoryName` from Apify — and maps them for you. A cell with several emails
keeps the first valid one, `4,6` becomes 4.6, and a value that is not one of a
pick-list's options (a scraper's `status: Open`) is left blank rather than
losing the whole row.

## Being a good citizen

- The website reader **obeys robots.txt** (for `RunButterBot` and for `*`), reads
  at most three pages per site, and identifies itself with a link to this page.
- It never follows a website to a private network address, including through a
  redirect: anyone can edit OpenStreetMap, so a website there is untrusted.
- Searches are rate-limited per account, and Nominatim requests are spaced to
  its one-per-second rule.

## Before you contact anyone

Finding a business is one thing; sending it an offer is regulated, and the rules
differ by country:

- **Poland** (and several other EU countries): sending an offer by email, or
  calling to sell, needs the recipient's **prior consent — even when the
  recipient is a business**.
- **US**, and the **UK for limited companies**: business email is allowed if each
  message says who you are and offers a clear way to opt out.
- A **printed letter** is allowed almost everywhere.

A sole trader's name and contact details are personal data under the GDPR. Each
saved lead carries a note saying where it was found and which page its email
was published on, so *"where did you get my details?"* has an answer.

This is a summary, not legal advice.

## Anywhere in the world

Overture and OpenStreetMap cover every country, and the search takes a place in any
language — *Kraków*, *Lagos*, *İstanbul*, a district, a street or a postcode. A
city too large to search whole in one go (Istanbul, Sydney, Tokyo) is searched
within 15 km of its centre, and the screen says so; pick a district, or a
distance from an address, to search elsewhere in it. A whole country or region
asks for something smaller.

## Self-hosting

Nothing to configure: none of the free sources needs a key. Overture's files
are read from its public S3 bucket; to read them from a mirror (another region,
Azure, your own copy) or to pin a release:

```
OVERTURE_BASE_URL=https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com
OVERTURE_RELEASE=2026-09-23.1   # default: the newest, re-checked daily
```

The search reads one column of one block at a time, so it stays at roughly
50 MB of memory however big the city.

Place names go to
Nominatim, with Photon as the fallback; businesses come from Overpass, tried
across three public servers in turn (overpass-api.de, Kumi Systems,
private.coffee), so one busy server no longer fails a search. They have
fair-use rules (one Nominatim request a second; under about 10,000 Overpass
queries a day), so a busy deployment should run its own or use a provider:

```
OSM_NOMINATIM_URL=https://nominatim.example.com
OSM_PHOTON_URL=https://photon.example.com
# One or more, comma-separated, tried in order:
OSM_OVERPASS_URL=https://overpass.example.com/api/interpreter
```
