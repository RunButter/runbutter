# Fill in a company from its tax number, website or name

When you add a company, type what you know — its **tax number** (a Polish NIP,
or an EU VAT number like `DE123456789`), its **website**, or its **name** — and
press **Enter** (or *Fill in*). The form fills itself, and says where each
value came from.

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
| Name, address, website, invoicing contact — by VAT number, incl. **Germany and Spain** | the **Peppol directory** (the e-invoicing register) | No |
| Name, website, LEI — by VAT number, larger companies | **Wikidata** (then **GLEIF** for the registered address) | No |
| Legal name, address, VAT ID, register no. (HRB), phone, email, managing directors | the company website's **legal notice** (Impressum, mentions légales, aviso legal…) | No |
| Legal name, registered address, register no. — by name, any country | **GLEIF**, the global LEI register | No |

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

A hit is used only when the record carries exactly the number typed. Whatever
website they give is then read for its **Impressum** — every German commercial
site must show the legal name, address, register court and number, VAT ID and
a way to reach them — which fills the rest and checks the VAT ID printed there.

When none of them knows the number, the form says so and offers **Search the
web for DE…**: open it, copy the company's website into *Website* and press
*Fill in* again. With only a name, the LEI register finds larger companies.

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
it — the name and address; the Peppol directory and Wikidata are asked too, for
the countries that do not share it and for contact details.

## Copilot

*"Add the company with NIP 526-025-09-95"* works too: the Copilot's
`lookup_company` tool returns the same facts with their sources, and it then
creates the company (and, if asked, its board as people).

## Self-hosting

Nothing to configure for companies (KRS) and EU numbers. For Polish **sole
traders**, get a free CEIDG API token at biznes.gov.pl and set
`CEIDG_API_TOKEN` — without it they still get the white-list data, but no phone
or email. Phone, email, website, REGON, KRS and bank account need migration
**0133**; on a database without it the form saves everything else and says
which fields were not kept.
