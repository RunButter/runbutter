import webpush from 'web-push';
import { createAdminClient } from '@/lib/supabase';

/**
 * Send a web push, to a workspace or to one person in it.
 *
 * ONE SENDER, the way lib/ai/usage.ts is the one recorder. Every future trigger
 * — an overdue invoice, a data room opened, an e-signature completed — calls
 * this rather than talking to web-push itself, so dead-endpoint reaping and the
 * "are keys even configured" check live in exactly one place.
 *
 * ── IT NEVER THROWS ─────────────────────────────────────────────────────────
 * A notification is a courtesy on top of something that already happened. If
 * pushing fails, the invoice was still saved and the document was still signed;
 * taking the request down over it would be absurd. Failures are counted and
 * returned so a caller can log them, never raised.
 *
 * ── DEAD ENDPOINTS ARE REAPED ON THE SPOT ───────────────────────────────────
 * Uninstalling the app or clearing site data makes a push service answer 404 or
 * 410 forever. Those are marked disabled immediately: the error is unambiguous,
 * and a subscription table that only grows makes every later send slower.
 */

export interface PushMessage {
  title: string;
  body?: string;
  /** Where clicking it should land. Relative; the service worker resolves it. */
  url?: string;
  /** Same tag collapses repeats in the notification shade. */
  tag?: string;
}

let configured: boolean | null = null;

/**
 * VAPID keys identify THIS SERVER to the push services, and are generated once
 * with `npx web-push generate-vapid-keys`. Without them push is simply off,
 * which is the right default for a self-hoster who has not set it up — and why
 * this reports a reason rather than throwing.
 */
function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const raw = process.env.VAPID_SUBJECT || process.env.NEXT_PUBLIC_SITE_URL || 'https://runbutter.app';
  if (!pub || !priv) { configured = false; return false; }
  const subject = raw.startsWith('http') || raw.startsWith('mailto:') ? raw : `https://${raw}`;
  try {
    webpush.setVapidDetails(subject, pub, priv);
    configured = true;
  } catch {
    configured = false;
  }
  return configured;
}

export interface PushResult { sent: number; failed: number; disabled: number; skipped?: string }

export async function sendPush(
  workspaceId: string, message: PushMessage, privyUserId?: string | null,
): Promise<PushResult> {
  if (!ensureConfigured()) return { sent: 0, failed: 0, disabled: 0, skipped: 'VAPID keys not configured' };
  if (!workspaceId) return { sent: 0, failed: 0, disabled: 0, skipped: 'no workspace' };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('push_targets', {
    p_workspace: workspaceId, p_privy: privyUserId ?? null,
  });
  if (error || !Array.isArray(data) || data.length === 0) {
    return { sent: 0, failed: 0, disabled: 0, skipped: error ? error.message : 'no subscriptions' };
  }

  const payload = JSON.stringify({
    title: message.title,
    body: message.body || '',
    url: message.url || '/home',
    tag: message.tag || 'runbutter',
  });

  let sent = 0, failed = 0, disabled = 0;
  await Promise.all((data as any[]).map(async (t) => {
    try {
      await webpush.sendNotification(
        { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
        payload,
      );
      sent++;
    } catch (e: any) {
      const code = e?.statusCode;
      if (code === 404 || code === 410) {
        disabled++;
        try { await admin.rpc('disable_push_subscription', { p_endpoint: t.endpoint }); } catch { /* best effort */ }
      } else {
        failed++;
      }
    }
  }));

  return { sent, failed, disabled };
}
