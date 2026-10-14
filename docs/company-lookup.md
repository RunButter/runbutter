# Fill in a company from its tax number, website or name

When you add a company, type what you know — its **tax number**, its
**website**, or its **name** — and press **Enter** (or *Fill in*). The form
fills itself, and says where each value came from.

Tax numbers it understands: a Polish **NIP**, any **EU VAT number**
(`DE123456789`, `FR27552032534`…), a French **SIREN/SIRET**, a Czech **IČO**,
an Estonian registry code, a Swiss **UID** (`CHE-105.909.036`), a Norwegian
**org.nr** (`NO 923 609 016 MVA`), a **UK** VAT number, a US **EIN**
(`94-2404110`) and a Brazilian **CNPJ**. Every source below is free and needs
no key.

Spaces, dashes and a country prefix are all fine (`PL 526-025-09-95`). Leave
Country empty for a NIP — a valid NIP is Polish — or type the prefix and the
country follows it. A NIP with a typo is caught by its checksum before anything
is looked up.

## What fills in, and from where

| | Where it comes from | Needs a key? |
|---|---|---|
| Legal name, registered address | Ministry of Finance **white list** | No |
| REGON, KRS number | white list | No |
| VAT status | white list (or EU VIES) | No |
| Bank account | white list — the account you may safely pay | No |
| Email, website | **KRS** court register (companies) | No |
| Legal form, industry (main PKD) | KRS | No |
| Board — who may sign | KRS | No |
| Phone, email, website, industry | **CEIDG** (sole traders) | Free token |
| Phone, contact email | the company's **own website** | No |
| Name, address (other EU) | **VIES** | No |
| Name, address, directors, activity — France | **recherche-entreprises** (INSEE/INPI) | No |
| Name, address — Czechia · Finland (+ website, industry) · Romania (+ phone, VAT payer, inactive flag) · Estonia | **ARES** · **PRH/YTJ** · **ANAF** · **e-Business Register** | No |
| Name, address, website, phone, email, VAT register — Norway | **Brønnøysund** | No |
| Name, address, register no. — Switzerland | the federal **UID register** | No |
| Name, address, phone — US public companies (by EIN or name); nonprofits (by EIN) | **SEC EDGAR**; IRS data via **ProPublica** | No |
| Name, address, phone, partners — Brazil | **Receita Federal** via BrasilAPI | No |
| Name, address, website, invoicing contact — by VAT number, incl. **Germany and Spain** | the **Peppol directory** (the e-invoicing register) | No |
| Name, website, LEI — by VAT number, larger companies | **Wikidata** (then **GLEIF** for the registered address) | No |
| Legal name, address, VAT ID, register no. (HRB), phone, email, managing directors | the company website's **legal notice** (Impressum, mentions légales, aviso legal…) | No |
| Legal name, registered address, register no. — by name, any country | the national register (FR, CZ, NO, FI, EE, US), then **GLEIF**, the global LEI register | No |
| The company's own website, from its tax number | a **web search in your browser**, used only when the site's legal notice prints that exact number | No |

## Germany (and Spain)

Germany's tax office confirms a VAT number through VIES but never says whose
it is. So a German (or Spanish) number is also looked up, at the same time, in:

1. **The Peppol directory** — the public register of businesses that receive
   e-invoices, keyed by VAT number (`9930:de123456789` is DE123456789). It
   gives the registered name, usually the address, and often a website and an
   invoicing contact. Germany's e-invoicing obligation (2025) keeps adding
   companies to it.
2. **Wikidata** — VAT number → name, website and LEI for larger companies; the
   LEI then gives the registered address from GLEIF.

A hit is used only when the record carries exactly the number typed.

Then, if the name or the address is still missing, **your browser searches the
web for the number** — every German business must print its VAT ID in its
**Impressum**, so the company's own site is usually among the results. The
directories that copied the number (North Data, Kompass…) are skipped; when
only directories turn up, their titles give the company's name and the search
runs again for that name with "Impressum". A site is read only when its legal
notice prints **exactly the number you typed** — so a search result can lead to
a company but never invent one. The Impressum then fills the legal name,
address, register court and HRB number, phone, email and managing directors.

The search runs in your browser (Firecrawl's keyless search, a free allowance
per person), so nothing about it passes through our server. When even that
finds nothing, the form lists what the search found — unconfirmed, for you to
open — and offers **Search the web for DE…**: copy the company's website into
*Website* and press *Fill in* again. The same steps work for Spanish, British
and other numbers whose register does not name the company.

If VIES itself is down (it often is for one country at a time), a company named
by another register is still filled in, with a note that the number could not
be confirmed; a German number is then at least checked against its check digit.

Registers decide the **official** values (name, address, REGON, KRS, bank
account) and replace what was typed. Contact details only fill **empty** boxes,
so a phone number you already know is never overwritten.

**The board.** For a company in KRS the form lists the people who can sign for
it. Leave *Add them to People at this company* ticked and each becomes a person
linked to the company, with their role as the title.

**Warnings worth reading.** Not an active VAT payer ("Zwolniony") is flagged
before you invoice; so is a company missing from the white list, and a register
that could not be reached (the Ministry of Finance limits daily lookups).

**Outside Poland**, VIES confirms the VAT number and — where the country shares
it — the name and address; the national register is the authority where one is
free (France, Czechia, Finland, Romania, Estonia), and the Peppol directory and
Wikidata are asked too. A company its national register knows but VIES does
not is filled in with a warning that it is not registered for intra-EU VAT.

**Outside the EU:** Switzerland, Norway, the US and Brazil each have a free
register; the UK does not (HMRC's VAT check and Companies House both need an
app key), so a UK number goes straight to the web step. Anywhere else, the name
finds larger companies in the LEI register, and the website finds the rest.

## Copilot

*"Add the company with NIP 526-025-09-95"* works too: the Copilot's
`lookup_company` tool returns the same facts with their sources, and it then
creates the company (and, if asked, its board as people).

## Self-hosting

Nothing to configure for companies (KRS), EU numbers or the other countries.
Optional: `FIRECRAWL_API_KEY` raises the server's web-search allowance (the
Copilot's lookups — the form searches from the browser), and `SEC_USER_AGENT`
names you to SEC EDGAR if it ever asks. For Polish **sole
traders**, get a free CEIDG API token at biznes.gov.pl and set
`CEIDG_API_TOKEN` — without it they still get the white-list data, but no phone
or email. Phone, email, website, REGON, KRS and bank account need migration
**0133**; on a database without it the form saves everything else and says
which fields were not kept.
