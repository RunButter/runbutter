// Next calls register() once when a server starts. It is the hook for the
// built-in scheduler (lib/scheduler/internal-cron.ts) — Node runtime only.
//
// The import MUST sit inside `if (NEXT_RUNTIME === 'nodejs') { … }`. Next
// compiles this file for the edge runtime too, and webpack only drops a branch
// whose condition it can evaluate; an early `return` is not one, so the edge
// build tried to bundle the dispatcher and failed on `crypto`.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startInternalCron } = await import('@/lib/scheduler/internal-cron');
    startInternalCron();
  }
}
