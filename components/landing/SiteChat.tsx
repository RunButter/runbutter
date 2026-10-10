'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';

/**
 * The support chat bubble on OUR marketing site — the same `support.js` a
 * customer pastes into theirs, answered from the Inbox (0131).
 *
 * Which widget: `NEXT_PUBLIC_SUPPORT_WIDGET_ID` if set (`off` disables it), else
 * the hosted site's widget — but ONLY on the hosted site's own hostname. This
 * repo is public, and a fork deployed somewhere else must never greet its
 * visitors with RunButter's support chat. A widget id is public by design (it
 * sits in every page's HTML), so keeping it here costs nothing.
 *
 * Mounted by MarketingFooter and the contact page, and nowhere else: careers
 * pages, public forms and the apply flow belong to customers, and a RunButter
 * bubble on them would be talking over somebody else's brand.
 *
 * `lazyOnload` because the landing page's whole performance budget went on TBT
 * once already; a chat button can wait for the browser to be idle. The script
 * survives client-side navigation, so leaving a marketing page HIDES the button
 * rather than letting it follow the visitor into the app.
 */
const HOSTED = { hosts: ['runbutter.app', 'www.runbutter.app'], widget: 'cbb43f22-37c1-499d-8c3e-5da95b22d932' };

export function siteWidgetId(hostname: string): string | null {
  const env = (process.env.NEXT_PUBLIC_SUPPORT_WIDGET_ID || '').trim();
  if (env.toLowerCase() === 'off') return null;
  if (/^[0-9a-f-]{36}$/i.test(env)) return env;
  return HOSTED.hosts.includes(hostname) ? HOSTED.widget : null;
}

export default function SiteChat() {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    const w = siteWidgetId(window.location.hostname);
    if (!w) return;
    setId(w);
    const chat = () => (window as any).RunButterChat;
    chat()?.show?.();
    return () => { chat()?.hide?.(); };
  }, []);

  if (!id) return null;
  return <Script id="runbutter-support" src="/support.js" strategy="lazyOnload" data-widget={id} />;
}
