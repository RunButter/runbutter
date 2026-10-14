# Scan receipts

**Finance → Expenses → Scan receipts.** Take a photo of a receipt on your phone, or
drop PDFs from your inbox, and each one comes back as an expense to check: vendor,
date, amount and category filled in, the receipt filed with it.

## How a receipt is read

1. **A PDF with text** (most emailed receipts and e-invoices) is parsed on the
   server with plain pattern matching — totals in any number format, dates, VAT
   numbers, invoice numbers. No AI, no cost.
2. **A photo** is read by your server's OCR when one is set up (`OCR_API_URL` or
   `MINERU_URL`, see [Files](file-extraction.md)).
3. Otherwise, by **your workspace's own AI key** (Settings → AI) — Claude, Gemini
   and OpenAI-compatible models that take images. Claude and Gemini also read
   scanned PDFs. The words it reads are stored on the file, so Files search finds
   the receipt later. Usage shows under AI costs as *receipts*.
4. With none of those, the form is empty beside the picture and you type it in.

The **category** is the one your workspace used for that vendor before; for a new
vendor, a keyword guess (fuel and taxis → travel, SaaS → software…).

Nothing is saved until you press **Save expense**. Saving creates the expense the
same way the form does (plan limits apply) and links the receipt to it in one
step. A receipt already filed as an expense is refused, and a likely duplicate —
same vendor and amount within three days — is flagged before you save.

## Security notes

- Receipts are stored in the private Files bucket; opening one mints a two-minute
  link after checking you are a member.
- What a model reads off a receipt is untrusted: every value is re-checked (dates,
  amounts, currency codes) and shown to you before it becomes a row.
