// A team reply — the ONE way one is written, SERVER ONLY.
//
// The inbox (through /api/support/reply) and the Copilot's `reply_conversation`
// tool both come here, so a reply from either gets the same membership check in
// SQL, the same author attribution and the same email to a visitor who has left.
// `kind` is 'agent' when a model wrote it, so the thread always says so.
import { notifyVisitor, shouldEmailVisitor } from '@/lib/support/notify';

export async function sendSupportReply(admin: any, p: {
  privy: string; workspace: string; conversation: string; body: string; kind: 'team' | 'agent' | 'note';
}): Promise<{ ok: true; id: string; emailed: boolean } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc('reply_support', {
    p_privy: p.privy, p_workspace: p.workspace, p_id: p.conversation, p_body: p.body, p_kind: p.kind,
  });
  if (error) return { ok: false, error: error.message };
  const d = data as any;
  let emailed = false;
  if (d?.kind !== 'note' && d?.widget && shouldEmailVisitor(d?.email, d?.visitor_seen_at)) {
    emailed = await notifyVisitor({
      to: d.email, company: d.company || '', author: d.author || 'Team',
      body: p.body, widgetId: d.widget, conversationId: p.conversation,
    }).catch(() => false);
  }
  return { ok: true, id: d?.id, emailed };
}
