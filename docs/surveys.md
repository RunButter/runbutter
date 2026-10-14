# Customer surveys (NPS & CSAT)

**Support → Surveys.** Ask your customers how you are doing — and see the answer on
the customer it came from.

- **NPS**: "How likely are you to recommend us to a friend or colleague?" 0–10.
  9–10 are promoters, 7–8 passives, 0–6 detractors; the score is % promoters −
  % detractors.
- **CSAT**: "How satisfied are you with us?" 1–5 (faces). 4–5 count as satisfied.

## Sending

Open a survey → **Send by email** → pick people (search, or filter by company).
Each person gets an email with the question and the scale: **one tap answers**,
then a page asks for the reason (which updates the same answer — clicking again
changes it, never adds a second one).

Skipped automatically, and counted on screen: people without an email, anyone
who pressed *Don't send me surveys* (in every email), addresses the newsletter
side knows bounced, complained or unsubscribed, and anyone asked in the last 30
days (tick *Ask again* to override that one only). Up to 500 per send.

Email needs `RESEND_API_KEY`. The **share link** (`/survey/<id>`) and the iframe
snippet work without it — for your website, an invoice footer or a QR code; an
answer that gives a known email is matched to that person.

## Where answers go

- The survey's **Results**: score, the 0–10 / 1–5 split, month by month, and every
  answer with the person, the company and the comment — filter to detractors.
- A **note on the person and on their company** ("NPS 4/10 (detractor) — 'slow
  support lately'", source *survey: name*) — visible where the account is worked.
- **Automations**: *when a survey answer is added*, with `{{bucket}}`, `{{score}}`,
  `{{comment}}`, `{{name}}`, `{{company}}` — e.g. a detractor → post in chat and
  make a task.
- **Copilot**: `survey_results` ("what is our NPS?", "what do detractors say?").
  Sending stays a person's click.
