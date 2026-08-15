# The team vault

Every company has a handful of logins that belong to nobody in particular — the
domain registrar, the analytics account, the shared social inbox. They end up in
a spreadsheet called `passwords.xlsx`, or in a pinned chat message, because
buying a fifth subscription to hold six passwords is a worse trade than the
spreadsheet.

The vault is at **Team → Vault**. It is that spreadsheet with real encryption, an
access-controlled home, and the rest of the company's records beside it.

## The one thing worth understanding

**Your RunButter server cannot read the vault, and neither can we.**

That is not a policy — it is a property of how it is built. The encryption key
is derived in your browser from a workspace passphrase that is never
transmitted. What reaches the database is a salt, an initialisation vector and
ciphertext.

Look at what the table stores:

| Column | What it is |
|---|---|
| `workspace_id` | which workspace |
| `ct` | the encrypted item |
| `iv` | a fresh 96-bit IV for that item |
| `created_by` / `updated_by` | who touched it |
| timestamps | when |

**There is no title column.** Knowing that a workspace holds a login called
"Stripe production admin" is most of what an attacker wants before they start,
so the title is inside the ciphertext with the username, password, URL and
notes. Searching and sorting happen in your browser after decryption.

This is the opposite decision from the rest of the product's secret handling.
`lib/crypto/secrets.ts` seals OAuth tokens with a **server-held** key, and that
is correct there: the server has to use those tokens to post to LinkedIn at 9am.
Nothing on the server ever needs to read a vault item, so nothing on the server
can.

## What it protects against, and what it does not

**It protects against:** a database leak, a stolen backup, a compromised host at
rest, an operator reading rows, and every server-side log. Someone with a full
dump of your Postgres has ciphertext and no key.

**It does not protect against a compromised server serving modified
JavaScript.** A page that is replaced with a malicious one could capture the
passphrase as you type it. This is true of every browser-delivered vault,
including the web clients of the dedicated ones, and it is stated here because
the difference between a security claim and marketing is whether the limits are
written down.

Use it for shared team logins. Do not use it for the keys to your bank.

## There is no recovery

If the passphrase is lost, the rows are noise. Nobody can recover them, because
nobody ever held the key.

The only honest option is to delete the vault and start again, which is what
**Lost the passphrase?** does — owner or admin only. A reset that *worked* would
prove the server could decrypt, and then none of the above would be true.

Share the passphrase with your team the way you already share things that matter,
and keep a copy somewhere that is not this application.

## How it works, precisely

- **Key derivation** — PBKDF2-HMAC-SHA256, 600,000 iterations, over a random
  16-byte salt. That is OWASP's current figure for PBKDF2. Argon2id would be
  better and needs a WASM dependency on a page whose whole value is that it is
  small; WebCrypto ships PBKDF2 natively and nothing else suitable.
- **The iteration count is stored per vault**, so raising it later upgrades new
  vaults without locking anyone out of an old one. A vault cannot be created
  below 100,000 — a weak count is a weak vault forever.
- **Encryption** — AES-GCM-256, with a fresh 96-bit IV per item. GCM
  authenticates, so a tampered ciphertext and a wrong key fail identically and
  the item is shown as unreadable rather than as approximate text.
- **The key is non-extractable.** Even code running on the page cannot read the
  key material back out; it can only ask WebCrypto to use it.
- **A verifier** — a known string encrypted under the vault key — is stored
  alongside the salt. Without it a wrong passphrase would decrypt every item to
  nothing, which is indistinguishable from an empty vault at the exact moment
  somebody is deciding whether their passwords are gone.
- **The passphrase is held in the page's memory only** — not `localStorage`, not
  `sessionStorage`, not a cookie. You type it again after a reload. Persisting
  it would mean the vault is open to anyone who gets the laptop, which is the
  threat this is far likelier to meet than a database leak.

## Changing the passphrase

**Change the vault passphrase** decrypts everything under the old key,
re-encrypts under the new one, and writes the new salt, the new verifier and
every item **in a single transaction**.

That transaction is the reason it is safe to offer. A sequence of calls from the
browser cannot be atomic, and failing after the salt was replaced would leave
every remaining item permanently unreadable. It also refuses if the item count
has changed since your page loaded — otherwise a colleague's newly added login
would be silently orphaned under the old key.

## What it is not

It is not a replacement for 1Password or Bitwarden. There are no per-user keys,
no browser extension, no autofill and no audit of who read what. One passphrase
per workspace, shared out of band — which is exactly the model the spreadsheet
already has.

## The password generator

Available at **Team → Vault → Generate**, from `⌘K` anywhere in the app, and
publicly at [runbutter.app/password](https://runbutter.app/password) with no
account.

Two things it gets right that are invisible in the output:

1. **It uses `crypto.getRandomValues`, not `Math.random()`.** `Math.random` is
   seeded and predictable, and passwords built on it look exactly as random as
   real ones. If no secure source is available the generator throws rather than
   falling back — a silent downgrade is worse than an error, because the user
   keeps the password.
2. **No modulo bias.** Mapping a random byte with `% alphabet.length` makes the
   first characters of the alphabet more likely unless the length divides the
   range evenly — with 26 letters the first four come up about 11% more often,
   quietly removing bits from every password. This rejects and redraws instead.

The strength figure is `log₂(alphabet^length)` for exactly the settings on
screen — the true entropy of a uniform draw, which is what these are. Not a
five-colour meter: one that calls `Password1!` strong is worse than none, and
one that cannot tell 60 bits from 120 is not measuring the thing that decides
whether a leaked hash survives.

## Self-hosting notes

Nothing extra to configure. The vault needs no environment variable, no key and
no external service — `SECRETS_MASTER_KEY` is not involved, deliberately.

Apply migration `0118_vault.sql` with `npm run migrate`. Until it is applied the
Vault screen says the feature is not enabled on this server; the password
generator on the same page keeps working, because it never touches the server at
all.
