// Wake the automation dispatcher shortly after a write made in the app.
//
// A record edited in the browser goes /api/rpc → SQL, and the SQL trigger only
// QUEUES an automation event. Until this existed nothing drained that queue but
// a cron job — so on an install without one, "when an invoice becomes paid,
// post in chat" simply never happened, while the docs said event triggers fire
// instantly. The REST API and incoming webhooks already kicked the dispatcher;
// the app itself, where nearly every edit happens, did not.
//
// Coalesced: every write in a 1.5 s window shares one run, so a bulk import is
// one dispatch rather than a thousand. Safe beside the built-in scheduler and
// any cron, because the claim underneath is SKIP LOCKED (0132).
//
// Not on Vercel: work scheduled after a serverless response is frozen with the
// function, so there the cron (or the built-in ticker elsewhere) is the answer.

const g = globalThis as any;

export function kickDispatcher(admin: any): void {
  if (process.env.VERCEL || g.__rbKick) return;
  g.__rbKick = setTimeout(async () => {
    g.__rbKick = null;
    try {
      const { runDispatcher } = await import('@/lib/automations/dispatcher');
      await runDispatcher(admin, 25);
    } catch { /* queued; the next tick or cron picks it up */ }
  }, 1500);
  g.__rbKick.unref?.();
}

/** Reads never queue an event, so they never need to wake anything. */
export const isWrite = (fn: string) => !/^(get|list|search|load|count|check|resolve|is|my)_/.test(fn);
