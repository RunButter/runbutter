import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase';
import Logo from '@/components/Logo';
import AcceptInvite from './AcceptInvite';

// Landing page for an invite link. Resolved server-side so the invitee sees who
// invited them and to what role BEFORE being asked to sign in — a bare login
// screen gives no clue why they are there, which is how people ended up
// creating a brand new workspace instead of joining the one they were invited
// to. The token in the URL is the only credential; get_invite_by_token returns
// null for anything unknown or already redeemed.

export const dynamic = 'force-dynamic';

interface Invite { company_name: string; role: string; full_name: string | null; email: string | null }

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = typeof searchParams.token === 'string' ? searchParams.token.trim() : '';
  let invite: Invite | null = null;

  if (/^[0-9a-f-]{36}$/i.test(token)) {
    const { data } = await createAdminClient().rpc('get_invite_by_token', { p_token: token });
    invite = (data as Invite) ?? null;
  }

  return (
    <div className="min-h-screen bg-canvas text-primary flex flex-col items-center justify-center px-6 py-16">
      <Link href="/" className="mb-10"><Logo /></Link>

      {invite ? (
        <AcceptInvite token={token} companyName={invite.company_name} role={invite.role} />
      ) : (
        <div className="w-full max-w-md rounded-xl bg-surface border border-subtle p-8 text-center">
          <h1 className="text-lg font-medium text-primary">This invitation isn&rsquo;t valid</h1>
          <p className="mt-2 text-[13px] text-secondary leading-relaxed">
            The link may have already been used, or it was cancelled. Ask whoever invited you to send a new one.
          </p>
          <Link
            href="/auth/login"
            className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-inverse px-5 text-sm font-medium text-inverse-fg hover:opacity-90 transition-opacity"
          >
            Go to sign in
          </Link>
        </div>
      )}
    </div>
  );
}
