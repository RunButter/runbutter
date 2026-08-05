import Stripe from 'stripe';

/**
 * The Stripe client, created on first use — never at module scope.
 *
 * `new Stripe(undefined)` THROWS ("Neither apiKey nor config.authenticator
 * provided"), and Next evaluates a route module while collecting page data, so
 * a top-level client turned "no billing configured" into **a build that fails**.
 * Every self-hoster who does not sell anything hit that, and the only reason it
 * was not obvious is that the Dockerfile passed a fake key to get past it — the
 * workaround hid the bug from us and left it in place for everyone else.
 *
 * Returns null when billing is not configured. Callers answer 503 rather than
 * pretending: a checkout that silently does nothing is worse than one that says
 * it is switched off.
 */
let client: Stripe | null = null;

export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!client) client = new Stripe(key, { apiVersion: '2023-10-16' as any });
  return client;
}

/** True when this instance can actually take a payment. */
export const billingConfigured = () => !!process.env.STRIPE_SECRET_KEY;
