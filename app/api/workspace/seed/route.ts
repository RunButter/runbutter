import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { DEMO_ROWS, DEMO_LINKS, DEMO_DOCS } from '@/lib/workspace/demo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/workspace/seed  { privyUserId, workspaceId }
 *
 * Fills an EMPTY workspace with linked sample data, so a fresh install shows
 * what the product is instead of an empty pipeline beside an empty ledger.
 *
 * REFUSES ON A WORKSPACE THAT ALREADY HAS RECORDS, and there is no force flag.
 * The whole point of the data is that it is obviously fake, which means it is
 * indistinguishable from real data once it is mixed in with some — and a button
 * that quietly adds "Northwind Freight" to a customer list nobody could then
 * safely bulk-delete is a worse outcome than a button that says no.
 *
 * Everything goes through create_record, the same path the UI uses, so tenancy,
 * validation and automations behave exactly as they would for a typed row.
 * There is no privileged bulk insert, because a privileged bulk insert is a
 * second place for the rules to be wrong.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`seed:${clientIp(req)}`, 5);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { privyUserId, workspaceId } = b || {};
  if (!privyUserId || !workspaceId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

  const admin = createAdminClient();

  // Membership is enforced by list_records itself — it raises NOT_A_MEMBER —
  // so the emptiness check doubles as the authorisation check.
  const busy: string[] = [];
  for (const object of ['companies', 'people', 'invoices']) {
    const { data, error } = await admin.rpc('list_records', {
      p_privy: privyUserId, p_workspace: workspaceId, p_object: object,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: /NOT_A_MEMBER/.test(error.message) ? 403 : 500 });
    }
    if (Array.isArray(data) && data.length) busy.push(`${data.length} ${object}`);
  }
  if (busy.length) {
    return NextResponse.json({
      error: `This workspace already has data (${busy.join(', ')}). Sample data is only for an empty one — otherwise you cannot tell it apart from the real thing later.`,
    }, { status: 409 });
  }

  const ids = new Map<string, string>();
  const failures: string[] = [];
  let created = 0;

  for (const row of DEMO_ROWS) {
    const { data, error } = await admin.rpc('create_record', {
      p_privy: privyUserId, p_workspace: workspaceId, p_object: row.object, p_data: row.data,
    });
    if (error) { failures.push(`${row.object}: ${error.message}`); continue; }
    created++;
    if (row.ref && data) ids.set(row.ref, data as string);
  }

  // The links, now that the ids exist. A missing target is skipped rather than
  // reported: the row it would have pointed at already failed and said so.
  for (const link of DEMO_LINKS) {
    const from = ids.get(link.ref);
    const to = ids.get(link.toRef);
    if (!from || !to) continue;
    await admin.rpc('update_record', {
      p_privy: privyUserId, p_object: link.object, p_id: from, p_data: { [link.field]: to },
    });
  }

  // Docs go through save_doc, which is where kinds and tags are validated. A
  // workspace whose Docs tab is empty looks half-installed.
  let docs = 0;
  for (const d of DEMO_DOCS) {
    const { error } = await admin.rpc('save_doc', {
      p_privy: privyUserId, p_workspace: workspaceId, p_id: null,
      p_title: d.title, p_body: d.body, p_kind: d.kind, p_tags: d.tags,
    });
    // Tags and kinds arrived in 0085/0086. On a database that has not run them
    // the doc is still worth having, so retry without them rather than
    // reporting a failure nobody can act on.
    if (error) {
      const { error: retry } = await admin.rpc('save_doc', {
        p_privy: privyUserId, p_workspace: workspaceId, p_id: null,
        p_title: d.title, p_body: d.body,
      });
      if (retry) { failures.push(`doc "${d.title}": ${retry.message}`); continue; }
    }
    docs++;
  }

  return NextResponse.json({ ok: true, created, docs, failures });
}
