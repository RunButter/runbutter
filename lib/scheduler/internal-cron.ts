// The built-in ticker — automations and scheduled agents run with NO cron.
//
// Every scheduled thing in this product used to need an external cron job hitting
// a secret-authed route, and "set up the crons" sat at the bottom of an ops list
// most people never reach. The symptom was silence: a daily automation that
// never ran, a weekly agent that never woke, nothing saying why.
//
// A long-lived Node server (Render, Docker, `next start` anywhere) can just
// tick. Every minute this drains the automation queue — which also enqueues
// due schedules — and every ten minutes it runs due agents. The external crons
// still work and are still the answer on serverless hosts; running both is
// safe, because every claim underneath is SKIP LOCKED (automations, 0132) or
// stamped at claim time (agents, 0084), so two tickers never run the same thing.
//
// Off when: RUNBUTTER_INTERNAL_CRON=off, on Vercel (no long-lived process), in
// development unless RUNBUTTER_INTERNAL_CRON=on, or without a service key.
// Newsletters, posts and sequences are deliberately NOT here: they send to real
// audiences, and switching that on for everyone who upgrades is a decision for
// the person running the server, not a side effect of deploying.

const g = globalThis as any;

export function startInternalCron(): void {
  if (g.__runbutterCron) return;
  const flag = (process.env.RUNBUTTER_INTERNAL_CRON || '').toLowerCase();
  if (flag === 'off' || flag === '0' || flag === 'false') return;
  if (process.env.VERCEL) return;
  if (process.env.NODE_ENV !== 'production' && flag !== 'on' && flag !== '1') return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !url || /placeholder/.test(url)) return;
  g.__runbutterCron = true;

  let running = false;
  let minute = 0;
  const warned = new Set<string>();
  const warnOnce = (what: string, e: any) => {
    const msg = `${what}: ${e?.message || e}`;
    if (warned.has(msg)) return;
    warned.add(msg);
    console.warn(`[runbutter] built-in scheduler — ${msg}`);
  };

  const tick = async () => {
    if (running) return;
    running = true;
    minute++;
    try {
      const { createAdminClient } = await import('@/lib/supabase');
      const admin = createAdminClient();
      try {
        const { runDispatcher } = await import('@/lib/automations/dispatcher');
        await runDispatcher(admin, 25);
      } catch (e) { warnOnce('automations', e); }
      // Agents: every ten minutes, like the documented cron. The coarsest agent
      // schedule is hourly and each run spends the workspace's own AI credit.
      if (minute % 10 === 1) {
        try {
          const { runScheduledAgents } = await import('@/lib/agents/scheduled');
          await runScheduledAgents(admin, 5);
        } catch (e) { warnOnce('agents', e); }
      }
    } finally {
      running = false;
    }
  };

  console.log('[runbutter] built-in scheduler on — automations every minute, scheduled agents every 10 minutes (RUNBUTTER_INTERNAL_CRON=off to disable)');
  // First tick after the server has settled, then every minute.
  setTimeout(() => { void tick(); }, 20_000).unref?.();
  setInterval(() => { void tick(); }, 60_000).unref?.();
}
