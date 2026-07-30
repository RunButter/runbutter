import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase';
import Logo from '@/components/Logo';
import Signer from './Signer';

export const dynamic = 'force-dynamic';

// Public signing page. The token in the URL is the only credential — no session.
// Resolved server-side so the signer sees the document and who is asking before
// doing anything. get_sign_request returns null for an unknown token.
export default async function SignPage({ params }: { params: { token: string } }) {
  const token = (params.token || '').trim();
  const admin = createAdminClient();

  let req: any = null;
  let docUrl: string | null = null;
  if (/^[0-9a-f-]{36}$/i.test(token)) {
    const { data } = await admin.rpc('get_sign_request', { p_token: token });
    req = data ?? null;
    if (req?.storage_path) {
      const { data: signed } = await admin.storage.from('documents').createSignedUrl(req.storage_path, 900);
      docUrl = signed?.signedUrl ?? null;
    }
  }

  const active = req && req.doc_status === 'sent';

  return (
    <div className="min-h-screen bg-canvas text-primary flex flex-col">
      <header className="h-14 shrink-0 border-b border-subtle flex items-center px-6">
        <Link href="/"><Logo /></Link>
      </header>

      {!req ? (
        <Centered title="This signing link isn't valid" body="It may have been voided or already completed. Ask the sender for a fresh link." />
      ) : req.already_signed ? (
        <Centered title="You've already signed this" body="Thanks — nothing more to do. You'll get the completed copy by email once everyone has signed." />
      ) : !active ? (
        <Centered title="This document is no longer active" body="It was voided or cancelled by the sender." />
      ) : (
        <Signer token={token} title={req.title} signerName={req.signer_name} docUrl={docUrl} />
      )}
    </div>
  );
}

function Centered({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex-1 flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-xl bg-surface border border-subtle p-8 text-center">
        <h1 className="text-lg font-medium text-primary">{title}</h1>
        <p className="mt-2 text-sm text-secondary leading-relaxed">{body}</p>
        <Link href="/" className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-inverse px-5 text-sm font-medium text-inverse-fg hover:opacity-90">Go to RunButter</Link>
      </div>
    </div>
  );
}
