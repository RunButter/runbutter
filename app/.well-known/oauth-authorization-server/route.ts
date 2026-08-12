import { NextResponse } from 'next/server';
import { ISSUER, SUPPORTED_SCOPES } from '@/lib/oauth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * RFC 8414 — authorization-server metadata.
 *
 * Note what is NOT advertised, because each omission is a decision:
 *   • no `implicit` and no `password` — removed by OAuth 2.1
 *   • `code_challenge_methods_supported` is S256 ONLY. `plain` is legal and
 *     worthless: a verifier identical to its challenge protects against nobody
 *     who could read the authorization request.
 *   • `token_endpoint_auth_methods_supported` is `none`, i.e. public clients.
 *     A desktop app or a browser cannot keep a secret, and shipping one that
 *     pretends otherwise is how OAuth 2.0 public clients got a bad name. PKCE
 *     is what binds a code to the client that requested it.
 */
export async function GET() {
  return NextResponse.json({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    registration_endpoint: `${ISSUER}/oauth/register`,
    revocation_endpoint: `${ISSUER}/oauth/revoke`,
    scopes_supported: SUPPORTED_SCOPES,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    service_documentation: `${ISSUER}/developers/api`,
  }, { headers: { 'cache-control': 'public, max-age=3600' } });
}
