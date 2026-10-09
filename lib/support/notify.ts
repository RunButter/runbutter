// Support emails — SERVER ONLY. Both directions, one place.
//
// Chat on a website is only half a channel: the visitor closes the tab, and the
// reply has to reach them somewhere. So a team reply is emailed to the visitor
// when they have not looked at the thread for a couple of minutes, with a link
// that reopens it; and a new conversation (or a customer writing back to one the
// team thought was handled) is emailed to the widget's notify address.
//
// Everything here is best-effort: no RESEND_API_KEY, no email, and the inbox is
// still the record. A failed send never fails the message it was about.
import { Resend } from 'resend';
import { conversationLink, siteOrigin } from '@/lib/support/token';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const para = (s: string) => esc(s).replace(/\n/g, '<br/>');
const from = () => process.env.RESEND_FROM || 'RunButter <notifications@runbutter.app>';

function shell(inner: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18181b;line-height:1.55">${inner}</div>`;
}

async function send(to: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY || !to) return false;
  try {
    await new Resend(process.env.RESEND_API_KEY).emails.send({ from: from(), to, subject, html, text });
    return true;
  } catch { return false; }
}

/** A visitor wrote — tell the team. */
export async function notifyTeam(p: {
  to: string | null | undefined; company: string; conversationId: string;
  name?: string | null; email?: string | null; body: string; isNew: boolean;
}): Promise<boolean> {
  if (!p.to) return false;
  const who = p.name || p.email || 'A visitor';
  const url = `${siteOrigin()}/inbox?c=${p.conversationId}`;
  const subject = p.isNew ? `New conversation from ${who}` : `${who} replied`;
  return send(p.to, subject,
    shell(`<p style="margin:0 0 12px;color:#52525b;font-size:14px">${esc(who)}${p.email && p.name ? ` · ${esc(p.email)}` : ''}</p>
      <div style="padding:14px 16px;border-radius:12px;background:#f4f4f5;font-size:15px">${para(p.body)}</div>
      <p style="margin:20px 0 0"><a href="${url}" style="background:#18181b;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-size:14px">Open in the inbox</a></p>`),
    `${who} wrote:\n\n${p.body}\n\nOpen in the inbox: ${url}`);
}

/** The team replied — tell the visitor, with a link back into the thread. */
export async function notifyVisitor(p: {
  to: string | null | undefined; company: string; author: string; body: string;
  widgetId: string; conversationId: string;
}): Promise<boolean> {
  if (!p.to) return false;
  const url = conversationLink(p.widgetId, p.conversationId);
  return send(p.to, `${p.company} replied to your message`,
    shell(`<p style="margin:0 0 12px;color:#52525b;font-size:14px">${esc(p.author)} from ${esc(p.company)}</p>
      <div style="padding:14px 16px;border-radius:12px;background:#f4f4f5;font-size:15px">${para(p.body)}</div>
      <p style="margin:20px 0 0"><a href="${url}" style="background:#18181b;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-size:14px">Reply</a></p>
      <p style="margin:16px 0 0;font-size:12px;color:#71717a">This link opens your conversation — keep it to yourself.</p>`),
    `${p.author} from ${p.company}:\n\n${p.body}\n\nReply: ${url}`);
}

/**
 * Whether a team reply should also go by email: the visitor left an address and
 * has not looked at the thread in two minutes. Somebody watching the widget
 * sees the reply arrive; emailing them too is how a chat becomes spam.
 */
export function shouldEmailVisitor(email: string | null | undefined, seenAt: string | null | undefined): boolean {
  if (!email) return false;
  if (!seenAt) return true;
  return Date.now() - new Date(seenAt).getTime() > 2 * 60 * 1000;
}
