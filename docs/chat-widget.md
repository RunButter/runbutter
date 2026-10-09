# Chat widget & support inbox

A chat bubble for your own website, and an inbox for the team that answers it —
in the same database as your CRM. Somebody who writes in becomes a contact in
**People**, their deals and invoices are one click away, and the Copilot can read
the thread.

## Turn it on

1. **Support → Inbox → Chat widget.** It starts **off**: nothing appears on any
   website until an owner or admin presses *Turn on*.
2. Set the title, greeting and colour. The preview on the right is the real
   visitor view.
3. Paste the snippet before `</body>` on every page of your site:

   ```html
   <script defer src="https://YOUR-DOMAIN/support.js" data-widget="WIDGET-ID"></script>
   ```

   Optional: `data-position="left"`, or `data-open="true"` on a contact page.
   From your own code: `RunButterChat.open()` / `RunButterChat.close()`.

No website? The same screen gives you a link (`/support/<widget id>`) that opens
the chat as its own page — put it in an email signature or a QR code.

Turning the widget off removes the button from every site at once: the script
asks the server before it draws anything.

## How a conversation moves

| State | Means | Moves when |
|---|---|---|
| **To do** | The customer is waiting on you | They write |
| **Waiting** | You replied, they have not | You reply |
| **Done** | Handled | You press *Done* (a new message reopens it) |

Nobody has to file anything — the state follows who spoke last.

- **Notes** are internal. They are never sent to the visitor; that filter is in
  SQL, in the one function a visitor can read through.
- **Draft** writes a reply with your own AI key and puts it in the composer. It
  never sends — a person reads it first.
- **Agents and the Copilot** have `list_conversations`, `get_conversation` and
  `reply_conversation`. A reply written by a model is marked *AI* in the thread,
  and on `suggest` autonomy it waits for approval like any other write.

## Email

Needs `RESEND_API_KEY` (and `RESEND_FROM`). Without it the inbox still works; it
just cannot reach anybody who closed the tab.

- **To the visitor:** a team reply is emailed when they left an address and have
  not looked at the chat for two minutes. The email links straight back into the
  conversation, on any device.
- **To the team:** set *Email the team about new conversations* to get a message
  for every new conversation, and whenever a customer writes back to one you had
  replied to or closed. Not for every line of a live chat.

## How it is kept safe

- The chat runs in an **iframe on your RunButter domain**. The host website never
  sees the conversation, and no CSS crosses in either direction. `/support/*` is
  the only path allowed in someone else's frame.
- A visitor has no account. Their conversation opens with a key the server
  derives (HMAC of the conversation id with the server secret); the database
  stores only its SHA-256. Rotating `SECRETS_MASTER_KEY` closes every open
  visitor link — they can simply start again.
- Every visitor request goes through `/api/support/visitor`, which is rate
  limited per IP; a conversation holds at most 500 visitor messages.
- Everything anyone types is rendered as text, never HTML.
- A visitor who gives an email becomes a person in People with source `chat`,
  within your plan's record limit. Over the limit the conversation still
  happens; it is just not linked.

## Why not Chatwoot?

Chatwoot is MIT-licensed (outside its `enterprise/` folder) and good. Running it
next to RunButter means a Rails app, Redis and Sidekiq per install, and a second
copy of every customer. It was read as a feature reference; nothing was copied.
