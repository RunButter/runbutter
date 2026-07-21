// Thin Telegram Bot API helpers (server-only). No SDK — two REST calls.

const API = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

export async function tgSend(token: string, chatId: number | string, text: string): Promise<void> {
  // Telegram caps messages at 4096 chars.
  const body = { chat_id: chatId, text: text.slice(0, 4096), disable_web_page_preview: true };
  await fetch(API(token, 'sendMessage'), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
}

// Point Telegram at our inbound webhook, and set the secret_token it will echo
// back in the X-Telegram-Bot-Api-Secret-Token header so we can verify calls.
export async function tgSetWebhook(token: string, url: string, secret: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(API(token, 'setWebhook'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, secret_token: secret, allowed_updates: ['message'] }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await res.json().catch(() => null);
    if (!j?.ok) return { ok: false, error: j?.description || `Telegram rejected the webhook (HTTP ${res.status})` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not reach Telegram' };
  }
}
