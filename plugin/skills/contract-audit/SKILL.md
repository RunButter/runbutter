---
name: contract-audit
description: Search uploaded contracts and documents for clauses such as auto-renewal, notice periods, liability caps and payment terms, and cross-reference them with the client's finances. Use when asked what a contract says, which agreements renew, or to review terms across clients.
---

# Contract audit

## The point of this

Files and the ledger are in the same database, so "which contracts auto-renew,
for clients who owe us money" is one question rather than an afternoon. That
join is the reason to use these tools rather than reading PDFs by hand.

## Search

`search_files` runs full-text search and returns snippets with the matched terms
delimited by `«»`. `get_file_text` returns a whole document when you need
surrounding context; `list_files` shows what exists.

**Check the warning `search_files` returns.** If nothing is indexed, an empty
result means nothing was searched — not that the clause is absent. Reporting "no
auto-renewal clauses found" from an empty index is a false negative on exactly
the question that was asked. Say the index is empty instead.

Extraction can also be marked `skipped`, with a reason: a scanned PDF with no
text layer has no words to find. Those files are invisible to search and must be
named as unread, not silently omitted.

## Search terms

Search for the language, not the concept. "Auto-renewal" appears as *renew*,
*renewal term*, *evergreen*, *unless terminated*, *automatically extend*. Run
several searches and merge.

## Cross-reference

Once you have the contracts, `list_records` on invoices and `get_record` on each
client turns a list of clauses into a decision: a renewal in six weeks for a
client with an overdue balance is the one that needs attention this week.

## Quote, do not summarise

Give the clause text and the file it came from. A summary of a liability cap is
not something anyone can act on, and this is the kind of question where being
approximately right is being wrong.
