'use client';

import { useEffect, useState } from 'react';
import { getAccessToken } from '@privy-io/react-auth';
import { Bell, BellOff, Loader2 } from 'lucide-react';

/**
 * Turn on notifications for THIS device.
 *
 * ── PERMISSION IS ASKED ON A CLICK, NEVER ON LOAD ───────────────────────────
 * A permission prompt fired on page load is the single most-blocked dialog on
 * the web: people dismiss it reflexively, and a dismissal on most browsers is
 * permanent-ish and cannot be re-prompted. Asking only after somebody presses a
 * button that says what it does is the difference between a working feature and
 * one nobody can ever turn on again.
 *
 * ── PER DEVICE, NOT PER ACCOUNT ─────────────────────────────────────────────
 * Every browser mints its own endpoint, so this reflects the browser it is
 * rendered in. A laptop showing "off" while the phone is on is correct, not a
 * bug.
 *
 * On iPhone this only works from an installed home-screen app (iOS 16.4+), so
 * the unsupported case says that rather than failing silently.
 */

// The VAPID public key travels to the browser by design; it identifies the
// server to the push service and is useless without the private half.
const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

/**
 * The key is published base64url; PushManager wants raw bytes.
 *
 * Returns an ArrayBuffer rather than a Uint8Array because the DOM types pin
 * applicationServerKey to a buffer backed by a real ArrayBuffer, and a
 * Uint8Array's `buffer` is only ArrayBufferLike. Handing over the buffer itself
 * is both correct and what the spec accepts.
 */
function vapidKeyBytes(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

export default function PushToggle({ privy, workspaceId }: { privy: string | null; workspaceId: string | null }) {
  const [state, setState] = useState<'checking' | 'unsupported' | 'off' | 'on' | 'denied'>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      if (typeof window === 'undefined') return;
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID) {
        setState('unsupported'); return;
      }
      if (Notification.permission === 'denied') { setState('denied'); return; }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setState(sub ? 'on' : 'off');
      } catch {
        setState('off');
      }
    })();
  }, []);

  async function enable() {
    if (!privy || !workspaceId || !VAPID) return;
    setBusy(true); setError('');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setState(permission === 'denied' ? 'denied' : 'off'); return; }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyBytes(VAPID),
      });

      const token = await getAccessToken().catch(() => null);
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
        // `test: true` sends one straight back. Finding out now beats wondering
        // for a week whether it worked.
        body: JSON.stringify({
          privyUserId: privy, workspaceId, subscription: sub.toJSON(),
          label: navigator.userAgent.slice(0, 80), test: true,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j?.error || 'Could not register this device.'); return; }
      setState('on');
    } catch (e: any) {
      setError(e?.message || 'Could not enable notifications.');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!privy) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const token = await getAccessToken().catch(() => null);
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
          body: JSON.stringify({ privyUserId: privy, endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState('off');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'checking') return null;

  return (
    <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-4">
      <div className="flex items-center gap-2">
        {state === 'on' ? <Bell className="w-4 h-4 text-accent" /> : <BellOff className="w-4 h-4 text-tertiary" />}
        <div className="min-w-0">
          <p className="text-sm font-medium text-primary">Notifications on this device</p>
          <p className="text-2xs text-tertiary">
            {state === 'on' ? 'This browser will be notified.'
              : state === 'denied' ? 'Blocked in your browser settings — you will need to allow them there first.'
              : state === 'unsupported' ? 'This browser cannot receive them. On iPhone, add RunButter to your home screen first.'
              : 'Each device is separate, so turn it on wherever you want them.'}
          </p>
        </div>
        {(state === 'on' || state === 'off') && (
          <button onClick={state === 'on' ? disable : enable} disabled={busy || !privy}
            className={`ml-auto h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold shrink-0 disabled:opacity-40 ${
              state === 'on' ? 'text-secondary hover:bg-surface-sunken' : 'bg-inverse text-inverse-fg'}`}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {state === 'on' ? 'Turn off' : 'Turn on'}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-2xs text-danger">{error}</p>}
    </div>
  );
}
