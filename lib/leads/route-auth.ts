// Who may run a lead search. A signed-in person, verified — not a claimed id.
//
// Nothing here is a workspace's data (OpenStreetMap and public websites), so
// membership is not the question; the question is that the caller is a real
// account we can rate-limit, because the website reader fetches URLs on our
// servers and must not be an anonymous proxy for anyone on the internet.
import { verifyPrivyToken } from '@/lib/auth/privy-verify';

export async function leadsCaller(req: Request): Promise<{ user: string } | Response> {
  const v = await verifyPrivyToken(req);
  if (v.status === 'verified') return { user: v.userId };
  const json = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });
  return v.status === 'unavailable'
    ? json(503, 'Sign-in could not be checked just now. Try again in a moment.')
    : json(401, 'Sign in again to search for leads.');
}
