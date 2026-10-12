# Find leads

**Sales → Find leads** finds businesses of one kind in one place — dentists in
Kraków, restaurants within 2 km of an address, every accountant in a postcode —
and saves the ones you choose as **Leads**, ready to call, write to or send an
offer.

## How it works

1. **Search.** Pick a kind of business (from cafés to roofers) and a
   place. Results come from [OpenStreetMap](https://www.openstreetmap.org): name,
   category, address, phone, website, opening hours and, where mapped, email.
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

## Why OpenStreetMap, not Google Maps

Google's terms forbid scraping Maps, and its Places API forbids storing what it
returns beyond a place id — so a lead list built from Google is a breach of
those terms the moment it is saved, and a scraper is blocked within days.
OpenStreetMap's data is published under the
[Open Database License](https://www.openstreetmap.org/copyright): free, no key,
and you may keep it, provided the attribution is shown (the screen shows it).

Coverage is good in most of Europe and in cities, thinner in rural areas and in
some countries, because the map is made by volunteers. A business missing from
the results can always be added to Leads by hand.

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

OpenStreetMap covers every country, and the search takes a place in any
language — *Kraków*, *Lagos*, *İstanbul*, a district, a street or a postcode. A
city too large to search whole in one go (Istanbul, Sydney, Tokyo) is searched
within 15 km of its centre, and the screen says so; pick a district, or a
distance from an address, to search elsewhere in it. A whole country or region
asks for something smaller.

## Self-hosting

Nothing to configure: the public services need no key. Place names go to
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
