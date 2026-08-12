import { NextResponse } from 'next/server';
import { ISSUER, MCP_RESOURCE, SUPPORTED_SCOPES } from '@/lib/oauth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * RFC 9728 — protected-resource metadata.
 *
 * The first thing a connector fetches after a 401 tells it where to
 * authenticate. Without this document and the `WWW-Authenticate` header that
 * points at it, a client that gets a 401 from /api/mcp has nowhere to go and
 * the connector flow fails with nothing to explain it.
 */
export async function GET() {
  return NextResponse.json({
    resource: MCP_RESOURCE,
    authorization_servers: [ISSUER],
    scopes_supported: SUPPORTED_SCOPES,
    bearer_methods_supported: ['header'],
    resource_documentation: `${ISSUER}/developers/api`,
  }, { headers: { 'cache-control': 'public, max-age=3600' } });
}
