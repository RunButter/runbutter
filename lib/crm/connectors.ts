/**
 * The connector catalogue: apps you can wire up in one click.
 *
 * ── EVERY ONE OF THESE IS ALREADY POSSIBLE, AND NOBODY KNEW ─────────────────
 * `connections` has accepted any HTTPS URL since it shipped, and automations
 * have been able to POST a signed payload to it the whole time. So Slack,
 * Discord, Zapier, Make and n8n all worked — provided you already knew that,
 * knew where each of them hides its Incoming Webhook screen, and typed the URL
 * correctly. The Integrations page said "Add a Slack / Zapier / Make webhook
 * URL" and stopped there.
 *
 * This is that knowledge, written down: where the URL comes from, what shape
 * arrives, and what it is good for. It creates the SAME `connections` row the
 * manual form does — there is no second write path, no per-vendor code, and no
 * OAuth dance to maintain per app.
 *
 * ── WHY WEBHOOKS AND NOT PER-APP OAUTH ──────────────────────────────────────
 * A "one-click Slack integration" in the marketing sense means registering an
 * app with Slack, holding a client secret, running an OAuth callback and
 * storing a token per workspace — per vendor, forever, and impossible for a
 * self-hoster who has not registered their own app with each of them. An
 * Incoming Webhook is ten seconds of the user's time, works identically on
 * every install, and cannot leak more than the channel it points at.
 *
 * Where a real OAuth integration already exists (Google Calendar, Microsoft for
 * the Excel sync, LinkedIn and X for publishing) it stays where it is. This is
 * for the long tail.
 *
 * ── `verified` MEANS WE HAVE CHECKED THE PAYLOAD SHAPE ──────────────────────
 * Slack and Discord both want a specific JSON body and will reject ours; the
 * automation sender posts our own envelope, so those two work as a *trigger*
 * into a relay (Zapier, Make, n8n) rather than as a direct post. Saying so is
 * the difference between a directory and a list of promises — a connector that
 * silently 400s is worse than one that is not offered.
 *
 * Zero imports so both a route handler and a client component can read it.
 */

export interface Connector {
  id: string;
  name: string;
  group: 'Automation' | 'Chat' | 'Data' | 'Custom';
  /** What it does for you, in one line. */
  blurb: string;
  /** Exactly where to find the URL. This is the part people get stuck on. */
  where: string;
  /** A URL fragment we can sanity-check a paste against. Empty = anything. */
  expect?: string;
  /**
   * true  — our signed JSON envelope is accepted as-is.
   * false — the app wants its own body shape, so point it at a relay instead.
   */
  direct: boolean;
  note?: string;
}

export const CONNECTORS: Connector[] = [
  {
    id: 'zapier', name: 'Zapier', group: 'Automation',
    blurb: 'Fan out to 6,000+ apps. RunButter fires, Zapier does the rest.',
    where: 'Create a Zap → trigger "Webhooks by Zapier" → Catch Hook → copy the URL.',
    expect: 'hooks.zapier.com', direct: true,
  },
  {
    id: 'make', name: 'Make', group: 'Automation',
    blurb: 'Visual scenarios, same idea as Zapier and cheaper at volume.',
    where: 'New scenario → Webhooks → Custom webhook → Copy address.',
    expect: 'hook.', direct: true,
  },
  {
    id: 'n8n', name: 'n8n', group: 'Automation',
    blurb: 'Self-hosted automation. Nothing leaves your infrastructure.',
    where: 'Add a Webhook node → copy its Production URL.',
    direct: true,
    note: 'A self-hosted n8n on a private address will be refused — the outbound guard blocks internal hosts, deliberately. Give it a public hostname.',
  },
  {
    id: 'activepieces', name: 'Activepieces', group: 'Automation',
    blurb: 'Open-source automation, MIT. Self-host it beside RunButter.',
    where: 'New flow → Trigger → Catch Webhook → copy the URL.',
    direct: true,
  },
  {
    id: 'slack', name: 'Slack', group: 'Chat',
    blurb: 'Post to a channel when something happens.',
    where: 'api.slack.com/apps → your app → Incoming Webhooks → Add New Webhook to Workspace.',
    expect: 'hooks.slack.com', direct: false,
    note: 'Slack requires its own {"text": …} body, and we send a signed RunButter envelope. Point Slack at Zapier, Make or n8n and have that post the message — or use the Slack node in n8n.',
  },
  {
    id: 'discord', name: 'Discord', group: 'Chat',
    blurb: 'Same, for a Discord channel.',
    where: 'Channel → Edit Channel → Integrations → Webhooks → New Webhook → Copy URL.',
    expect: 'discord.com/api/webhooks', direct: false,
    note: 'Discord wants {"content": …}. Append /slack to the webhook URL and relay through an automation tool, as with Slack.',
  },
  {
    id: 'teams', name: 'Microsoft Teams', group: 'Chat',
    blurb: 'Post into a Teams channel.',
    where: 'Channel → … → Connectors → Incoming Webhook → Create → copy the URL.',
    direct: false,
    note: 'Teams expects a MessageCard or an Adaptive Card. Relay it.',
  },
  {
    id: 'telegram', name: 'Telegram', group: 'Chat',
    blurb: 'Send to a chat or a channel through a bot.',
    where: 'Talk to @BotFather → /newbot → then https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>',
    expect: 'api.telegram.org', direct: false,
    note: 'The bot token is IN the URL, so treat this connection as a credential — anyone who can read it can post as your bot.',
  },
  {
    id: 'webhooksite', name: 'Webhook.site', group: 'Custom',
    blurb: 'See exactly what we send, before you wire anything up.',
    where: 'Open webhook.site and copy the unique URL it shows you.',
    expect: 'webhook.site', direct: true,
    note: 'The best first connection: send a test and read the real payload and signature rather than guessing at them.',
  },
  {
    id: 'generic', name: 'Your own endpoint', group: 'Custom',
    blurb: 'Any HTTPS URL. Signed, so you can verify it really came from here.',
    where: 'Whatever your server exposes. Verify the X-RunButter-Signature header.',
    direct: true,
  },
];

export const CONNECTOR_GROUPS = ['Automation', 'Chat', 'Data', 'Custom'] as const;

export const connectorsByGroup = () =>
  CONNECTOR_GROUPS.map((g) => ({ group: g, items: CONNECTORS.filter((c) => c.group === g) }))
    .filter((s) => s.items.length);

/**
 * Does this URL look like the app the user picked?
 *
 * A HINT, never a block. Self-hosted n8n, a Zapier proxy and a corporate relay
 * are all legitimate and none of them match a hostname we could hard-code, so
 * refusing on a mismatch would break real setups to catch a typo. The actual
 * safety check is `isSafeOutboundUrl` on the server, which is a different
 * question and is not optional.
 */
export function looksWrong(c: Connector, url: string): string | null {
  if (!c.expect || !url) return null;
  if (url.includes(c.expect)) return null;
  return `That does not look like a ${c.name} URL — they usually contain "${c.expect}". Save it anyway if you know it is right.`;
}
