# Fill in a company from its tax number

When you add a company, type its **tax number** — a Polish NIP, or an EU VAT
number like `DE123456789` — and press **Enter** (or *Fill in from the tax
number*). The form fills itself, and says where each value came from.

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
it — the name and address. Several countries (Germany and Spain among them)
confirm the number but not the name; the form says so.

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
