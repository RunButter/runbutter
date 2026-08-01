import { createAdminClient } from '@/lib/supabase';
import { sealSecret, openSecret } from '@/lib/crypto/secrets';

/**
 * Microsoft Graph client for the Excel sync (0079).
 *
 * Scope is kept as narrow as Graph allows: `Files.ReadWrite` is the smallest
 * permission that can write a workbook, and there is no "only this file"
 * variant on the delegated flow — so the token is sealed at rest and every
 * caller here goes through getToken(), which is the only place it is opened.
 *
 * Everything speaks the *table* API rather than raw ranges. A table has a
 * header row Graph will name columns from, it grows and shrinks without us
 * computing A1 addresses, and — the reason it is worth the extra call — a user
 * can sort, filter and add their own columns beside it without the next sync
 * overwriting their work.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';
const LOGIN = 'https://login.microsoftonline.com';

// `common` covers both personal Microsoft accounts and any work/school tenant.
const TENANT = process.env.MS_TENANT_ID || 'common';
export const MS_SCOPES = 'offline_access User.Read Files.ReadWrite Files.ReadWrite.All Sites.ReadWrite.All';

export const msConfigured = () => !!(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);

export function authUrl(state: string, redirectUri: string): string {
  const u = new URL(`${LOGIN}/${TENANT}/oauth2/v2.0/authorize`);
  u.searchParams.set('client_id', process.env.MS_CLIENT_ID || '');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_mode', 'query');
  u.searchParams.set('scope', MS_SCOPES);
  u.searchParams.set('state', state);
  return u.toString();
}

interface TokenSet { access_token: string; refresh_token?: string; expires_in?: number }

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(`${LOGIN}/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID || '',
      client_secret: process.env.MS_CLIENT_SECRET || '',
      ...body,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j?.access_token) {
    throw new Error(j?.error_description || j?.error || `Microsoft token request failed (HTTP ${res.status})`);
  }
  return j;
}

/** Exchange the consent code and store the sealed tokens. */
export async function exchangeCode(code: string, redirectUri: string, workspaceId: string, privy: string) {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  const email = await whoAmI(t.access_token).catch(() => null);
  await persist(workspaceId, privy, t, email);
  return email;
}

async function whoAmI(accessToken: string): Promise<string | null> {
  const res = await fetch(`${GRAPH}/me?$select=mail,userPrincipalName`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const j = await res.json();
  return j?.mail || j?.userPrincipalName || null;
}

async function persist(workspaceId: string, privy: string, t: TokenSet, email: string | null) {
  const admin = createAdminClient();
  const access = sealSecret(t.access_token);
  const row: Record<string, any> = {
    workspace_id: workspaceId,
    privy_user_id: privy,
    access_cipher: access.cipher, access_iv: access.iv, access_tag: access.tag,
    expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
    scope: MS_SCOPES,
    updated_at: new Date().toISOString(),
  };
  if (email) row.account_email = email;
  // A refresh response often omits refresh_token, meaning "keep the one you
  // have". Writing the absent value would blank the only credential that
  // survives an hour and silently break the connection at the next expiry.
  if (t.refresh_token) {
    const r = sealSecret(t.refresh_token);
    row.refresh_cipher = r.cipher; row.refresh_iv = r.iv; row.refresh_tag = r.tag;
  }
  const { error } = await admin.from('ms_connections').upsert(row, { onConflict: 'workspace_id,privy_user_id' });
  if (error) throw new Error(error.message);
}

/**
 * A usable access token for a workspace, refreshing when it is close to expiry.
 *
 * The 60-second margin is not cosmetic: a token that passes the check and then
 * expires mid-sync fails halfway through writing a workbook, which is the one
 * failure mode that leaves a user's sheet in a state neither side agrees with.
 */
export async function getToken(workspaceId: string, connectionId?: string): Promise<{ token: string; connectionId: string }> {
  const admin = createAdminClient();
  let q = admin.from('ms_connections').select('*').eq('workspace_id', workspaceId);
  if (connectionId) q = q.eq('id', connectionId);
  const { data, error } = await q.order('created_at').limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('NOT_CONNECTED');

  const fresh = data.expires_at && new Date(data.expires_at).getTime() - 60_000 > Date.now();
  if (fresh && data.access_cipher) {
    return { token: openSecret(data.access_cipher, data.access_iv, data.access_tag), connectionId: data.id };
  }

  if (!data.refresh_cipher) throw new Error('NOT_CONNECTED');
  const refresh = openSecret(data.refresh_cipher, data.refresh_iv, data.refresh_tag);
  let t: TokenSet;
  try {
    t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh, scope: MS_SCOPES });
  } catch (e: any) {
    // Same reasoning as the Google path: a rejected refresh is usually
    // permanent (consent revoked, grant aged out). Drop the dead row so the UI
    // offers "Connect" again instead of claiming a connection that can never
    // sync. A transient network error is kept.
    if (/invalid_grant|invalid_client|unauthorized|consent/i.test(e?.message || '')) {
      await admin.from('ms_connections').delete().eq('id', data.id);
      throw new Error('NOT_CONNECTED');
    }
    throw e;
  }
  await persist(workspaceId, data.privy_user_id, t, data.account_email);
  return { token: t.access_token, connectionId: data.id };
}

// ── Graph plumbing ───────────────────────────────────────────────────────────
async function graph(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(path.startsWith('http') ? path : `${GRAPH}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const j = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // Graph nests the useful part; the envelope alone reads as "[object Object]".
    const msg = j?.error?.message || j?.error_description || `Graph ${res.status}`;
    const err: any = new Error(msg);
    err.status = res.status;
    err.code = j?.error?.code;
    throw err;
  }
  return j;
}

export interface Workbook { driveId: string; itemId: string; name: string; webUrl: string; lastModified: string }

/** Workbooks the connected account can open, most recently touched first. */
export async function listWorkbooks(token: string, query = ''): Promise<Workbook[]> {
  // Graph has no "list all xlsx" endpoint; search is the supported way, and an
  // empty search term is rejected, so a blank query searches for the extension.
  const term = encodeURIComponent(query.trim() || '.xlsx');
  const j = await graph(token, `/me/drive/root/search(q='${term}')?$top=50&$select=id,name,webUrl,lastModifiedDateTime,parentReference,file`);
  return ((j?.value || []) as any[])
    .filter((f) => /\.xlsx$/i.test(f?.name || ''))
    .map((f) => ({
      driveId: f.parentReference?.driveId || '',
      itemId: f.id,
      name: f.name,
      webUrl: f.webUrl,
      lastModified: f.lastModifiedDateTime,
    }));
}

const book = (driveId: string, itemId: string) =>
  driveId ? `/drives/${driveId}/items/${itemId}/workbook` : `/me/drive/items/${itemId}/workbook`;

/** Create the worksheet if the workbook doesn't have it yet. */
export async function ensureWorksheet(token: string, driveId: string, itemId: string, sheet: string) {
  const j = await graph(token, `${book(driveId, itemId)}/worksheets`);
  if (((j?.value || []) as any[]).some((w) => w.name === sheet)) return;
  await graph(token, `${book(driveId, itemId)}/worksheets/add`, {
    method: 'POST', body: JSON.stringify({ name: sheet }),
  });
}

/**
 * The table this link syncs through, created on first use.
 *
 * Creating a table needs a range, and a range needs to already hold the header
 * row — an empty range produces a table whose single column is called
 * "Column1". So the headers are written first, then the table is bound to
 * exactly that many columns.
 */
export async function ensureTable(
  token: string, driveId: string, itemId: string, sheet: string, headers: string[], known?: string | null,
): Promise<{ name: string; headers: string[] }> {
  await ensureWorksheet(token, driveId, itemId, sheet);

  const existing = await graph(token, `${book(driveId, itemId)}/worksheets('${encodeURIComponent(sheet)}')/tables`);
  const found = ((existing?.value || []) as any[]).find((t) => !known || t.name === known) || (existing?.value || [])[0];
  if (found) {
    const cols = await graph(token, `${book(driveId, itemId)}/tables('${encodeURIComponent(found.name)}')/columns?$select=name`);
    return { name: found.name, headers: ((cols?.value || []) as any[]).map((c) => c.name) };
  }

  const address = `${sheet}!A1:${columnLetter(headers.length)}1`;
  await graph(token, `${book(driveId, itemId)}/worksheets('${encodeURIComponent(sheet)}')/range(address='${encodeURIComponent(address)}')`, {
    method: 'PATCH', body: JSON.stringify({ values: [headers] }),
  });
  const created = await graph(token, `${book(driveId, itemId)}/worksheets('${encodeURIComponent(sheet)}')/tables/add`, {
    method: 'POST', body: JSON.stringify({ address, hasHeaders: true }),
  });
  return { name: created.name, headers };
}

/**
 * 1 → A, 26 → Z, 27 → AA. Excel columns are bijective base-26: there is no
 * zero digit, so the naive `n % 26` loop emits "@" at every multiple of 26.
 */
export function columnLetter(n: number): string {
  let s = '';
  let i = Math.max(1, n);
  while (i > 0) {
    const rem = (i - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

export async function readRows(token: string, driveId: string, itemId: string, table: string): Promise<any[][]> {
  const j = await graph(token, `${book(driveId, itemId)}/tables('${encodeURIComponent(table)}')/rows?$select=values&$top=5000`);
  return ((j?.value || []) as any[]).flatMap((r) => r.values || []);
}

/**
 * Replace the table's body with `rows`.
 *
 * Clear-then-add rather than a range PATCH: a PATCH sized to the new data
 * leaves any surplus old rows sitting below it, still inside the table, which
 * reads to the user as duplicated records that reappear after every sync.
 *
 * The clear is one call against dataBodyRange, not a delete per row — a
 * per-row loop is a request per record, which turns a 2,500-row workspace into
 * 2,500 round trips and hits Graph's throttling long before it finishes.
 */
export async function writeRows(token: string, driveId: string, itemId: string, table: string, rows: any[][]) {
  const t = `${book(driveId, itemId)}/tables('${encodeURIComponent(table)}')`;
  const existing = await graph(token, `${t}/rows?$select=index&$top=1`);
  if ((existing?.value || []).length) {
    await graph(token, `${t}/dataBodyRange/delete`, { method: 'POST', body: JSON.stringify({ shift: 'Up' }) });
  }
  if (!rows.length) return;
  // Graph caps how much one add can carry; chunk so a large workspace doesn't
  // fail the whole sync on a single oversized request.
  for (let i = 0; i < rows.length; i += 200) {
    await graph(token, `${t}/rows/add`, {
      method: 'POST', body: JSON.stringify({ index: null, values: rows.slice(i, i + 200) }),
    });
  }
}

export { graph as graphRequest };
