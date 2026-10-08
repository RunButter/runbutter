// Invite somebody into the workspace — the ONE way an invitation is made.
//
// Settings → Members (through /api/team/invite) and the Copilot's
// `invite_member` tool both come here, so the owner/admin check, the
// owner-only-grants-owner rule and the seat limit cannot be skipped by taking
// the other road. The route keeps authentication; this keeps authorisation.
import { randomUUID } from 'crypto';
import { Resend } from 'resend';
import { checkLimit, limitDeniedBody } from '@/lib/plans-server';
import { resolveHrCompanyServer } from '@/lib/hr/company-server';

export const INVITE_ROLES = ['owner', 'admin', 'member', 'recruiter', 'viewer'] as const;
const ROLES = new Set<string>(INVITE_ROLES);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export type InviteResult =
  | { ok: true; emailed: boolean }
  | { ok: false; status: number; error: string; body?: any };

export async function createInvite(
  admin: any,
  privyUserId: string,
  input: { email: string; fullName: string; role: string },
  /** When set, the caller's company must be THIS workspace (an agent run is scoped to one). */
  workspace?: string,
): Promise<InviteResult> {
  const email = String(input.email || '').toLowerCase().trim();
  const fullName = String(input.fullName || '').trim();
  const role = String(input.role || '');
  if (!email || !fullName || !role) return { ok: false, status: 400, error: 'Name, email and role are required.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, status: 400, error: 'That email address does not look right.' };
  if (!ROLES.has(role)) return { ok: false, status: 400, error: 'That role is not recognised.' };

  const caller = await resolveHrCompanyServer(privyUserId);
  if (!caller || (caller.role !== 'owner' && caller.role !== 'admin')) {
    return { ok: false, status: 403, error: 'Only owners and admins can invite people.' };
  }
  if (workspace && caller.companyId !== workspace) {
    return { ok: false, status: 403, error: 'Switch to this workspace before inviting people into it.' };
  }
  if (role === 'owner' && caller.role !== 'owner') {
    return { ok: false, status: 403, error: 'Only an owner can invite another owner.' };
  }
  const companyId = caller.companyId;

  const seatDenial = await checkLimit(privyUserId, companyId, 'maxSeats');
  if (seatDenial) return { ok: false, status: 402, error: seatDenial.message, body: limitDeniedBody(seatDenial) };

  const { data: existing } = await admin
    .from('company_users').select('id').eq('email', email).eq('company_id', companyId).maybeSingle();
  if (existing) return { ok: false, status: 400, error: 'That person is already part of this organisation.' };

  const { data: company } = await admin.from('companies').select('name').eq('id', companyId).single();

  const inviteToken = randomUUID();
  const { error: insertError } = await admin.from('company_users').insert({
    company_id: companyId,
    email,                       // stored normalised; lookups were case-sensitive before
    full_name: fullName,
    role,
    invite_token: inviteToken,
    invited_at: new Date().toISOString(),
    invited_by: privyUserId,
  });
  if (insertError) return { ok: false, status: 500, error: insertError.message };

  // The link's host comes from configuration, NEVER from the request. It used
  // to be built from X-Forwarded-Host, so a forged header decided where the
  // "Accept invitation" button in a real email pointed.
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://runbutter.app').replace(/\/+$/, '');
  const acceptUrl = `${origin}/auth/accept?token=${inviteToken}`;

  if (!process.env.RESEND_API_KEY) return { ok: true, emailed: false };
  const name = esc(String(company?.name || 'your team'));
  await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: 'RunButter <no-reply@runbutter.app>',
    to: email,
    subject: `You've been invited to join ${company?.name || 'a team'} on RunButter`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333; padding: 20px;">
        <h2 style="color:#111;">You've been invited to ${name}</h2>
        <p style="line-height:1.6;">You have been invited to collaborate with your team at <b>${name}</b> on RunButter.</p>
        <p style="line-height:1.6;">Your role: <b>${esc(role.toUpperCase())}</b></p>
        <div style="text-align:center; margin:28px 0;">
          <a href="${acceptUrl}" style="background-color:#18181b; color:#fff; padding:12px 28px; text-decoration:none; border-radius:999px; font-weight:600; display:inline-block;">Accept invitation</a>
        </div>
        <p style="font-size:12px; color:#6B7280; line-height:1.6;">
          This link is unique to you and can only be used once. You can sign in with any
          method — the invitation is tied to the link, not to how you sign in.
          If the button doesn't work, paste this into your browser:<br/>
          <span style="word-break:break-all;">${acceptUrl}</span>
        </p>
      </div>`,
  });
  return { ok: true, emailed: true };
}
