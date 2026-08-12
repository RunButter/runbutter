'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePrivy, getAccessToken } from '@privy-io/react-auth';
import { ShieldCheck, Loader2, AlertTriangle, ArrowRight, Check } from 'lucide-react';
import { listMyWorkspaces, type WorkspaceOption } from '@/lib/crm/data';
import Logo from '@/components/Logo';
import Button from '@/components/ui/Button';

/**
 * The consent screen: "<app> wants to connect to <workspace>".
 *
 * This is what makes runbutter.app addable to Claude with a URL instead of a
 * config file and a pasted API key. Claude discovers the authorization server,
 * sends the person here, and gets back a code.
 *
 * THE SCREEN IS THE SECURITY BOUNDARY, not decoration. Dynamic client
 * registration is open — any client can obtain a client_id without an admin —
 * and what stops that mattering is that a client can do nothing until a
 * signed-in human picks a workspace here and presses a button. So this screen
 * has to be honest and specific: which app, which workspace, what it will be
 * able to do, and where it will be sent afterwards.
 *
 * ERRORS ARE SHOWN, NOT REDIRECTED, when the redirect_uri has not been proven
 * to belong to the client. Bouncing an error to an unverified URL is how an
 * open redirector is built.
 */

interface ClientInfo {
  client_id: string; client_name: string;
  client_uri: string | null; logo_uri: string | null; redirect_ok: boolean;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-primary flex items-center justify-center p-5">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6"><Logo /></div>
        <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-6">{children}</div>
        <p className="mt-4 text-center text-2xs text-tertiary leading-relaxed">
          You can disconnect this at any time in Settings → Integrations.
        </p>
      </div>
    </div>
  );
}

function Fail({ title, detail }: { title: string; detail: string }) {
  return (
    <Shell>
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
        <div>
          <h1 className="text-base font-medium text-primary">{title}</h1>
          <p className="mt-1.5 text-xs text-secondary leading-relaxed">{detail}</p>
        </div>
      </div>
    </Shell>
  );
}

export default function AuthorizePage() {
  const { ready, authenticated, user, login } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [params, setParams] = useState<URLSearchParams | null>(null);
  useEffect(() => { setParams(new URLSearchParams(window.location.search)); }, []);

  const q = useMemo(() => ({
    clientId: params?.get('client_id') || '',
    redirectUri: params?.get('redirect_uri') || '',
    responseType: params?.get('response_type') || 'code',
    state: params?.get('state') || '',
    scope: params?.get('scope') || 'mcp:full',
    codeChallenge: params?.get('code_challenge') || '',
    codeChallengeMethod: params?.get('code_challenge_method') || 'S256',
  }), [params]);

  const [client, setClient] = useState<ClientInfo | null>(null);
  const [clientError, setClientError] = useState('');
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[] | null>(null);
  const [chosen, setChosen] = useState<string>('');
  const [scope, setScope] = useState<'full' | 'read'>(q.scope.includes('mcp:read') ? 'read' : 'full');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!params || !q.clientId) return;
    fetch(`/api/oauth/authorize?client_id=${encodeURIComponent(q.clientId)}&redirect_uri=${encodeURIComponent(q.redirectUri)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { setClientError(j?.error || 'Could not look up that application.'); return; }
        setClient(j);
      })
      .catch(() => setClientError('Could not look up that application.'));
  }, [params, q.clientId, q.redirectUri]);

  useEffect(() => {
    if (!privy) return;
    listMyWorkspaces(privy).then((ws) => {
      setWorkspaces(ws);
      if (ws.length && !chosen) setChosen(ws[0].id);
    }).catch(() => setWorkspaces([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privy]);

  /** Back to the client, carrying the code and echoing `state` unchanged. */
  const finish = (code: string) => {
    const u = new URL(q.redirectUri);
    u.searchParams.set('code', code);
    // `state` is the client's CSRF protection and must come back byte-identical
    // — including absent when it was absent.
    if (q.state) u.searchParams.set('state', q.state);
    window.location.replace(u.toString());
  };

  const approve = async () => {
    if (!privy || !chosen) return;
    setBusy(true); setErr('');
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch('/api/oauth/authorize', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
        body: JSON.stringify({
          privyUserId: privy, workspaceId: chosen, clientId: q.clientId,
          redirectUri: q.redirectUri, codeChallenge: q.codeChallenge,
          codeChallengeMethod: q.codeChallengeMethod,
          scope: scope === 'read' ? 'mcp:read' : 'mcp:full',
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.code) { setErr(j?.error || 'Could not authorise.'); setBusy(false); return; }
      finish(j.code);
    } catch (e: any) {
      setErr(e?.message || 'Could not authorise.'); setBusy(false);
    }
  };

  const deny = () => {
    if (!client?.redirect_ok) { window.location.href = '/'; return; }
    const u = new URL(q.redirectUri);
    u.searchParams.set('error', 'access_denied');
    if (q.state) u.searchParams.set('state', q.state);
    window.location.replace(u.toString());
  };

  if (!params) return <Shell><div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-tertiary" /></div></Shell>;

  // Request validation, before anything is rendered that looks approvable.
  if (!q.clientId || !q.redirectUri) return <Fail title="Incomplete request" detail="This link is missing the application id or its return address. Start the connection again from the app you were using." />;
  if (q.responseType !== 'code') return <Fail title="Unsupported request" detail={`This server issues authorization codes only; the app asked for “${q.responseType}”.`} />;
  if (!q.codeChallenge) return <Fail title="Insecure request" detail="The application did not send a PKCE challenge. RunButter requires one, so an authorization code cannot be used by anyone who intercepts it." />;
  if (q.codeChallengeMethod !== 'S256') return <Fail title="Insecure request" detail="The application asked for a PKCE method other than S256, which offers no real protection." />;
  if (clientError) return <Fail title="Unknown application" detail={clientError} />;
  if (!client) return <Shell><div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-tertiary" /></div></Shell>;
  if (!client.redirect_ok) {
    return <Fail title="Return address not recognised"
      detail={`“${client.client_name}” asked to be sent back to a URL it has not registered. Nothing has been shared. This is the check that stops an authorization code being delivered to someone else.`} />;
  }

  if (!ready) return <Shell><div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-tertiary" /></div></Shell>;

  if (!privy) {
    return (
      <Shell>
        <h1 className="text-base font-medium">Sign in to continue</h1>
        <p className="mt-1.5 text-xs text-secondary leading-relaxed">
          <span className="text-primary font-medium">{client.client_name}</span> wants to connect to a RunButter
          workspace. Sign in and you will choose which one.
        </p>
        <Button variant="primary" className="mt-4 w-full justify-center" onClick={() => login()}>Sign in</Button>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-accent shrink-0 mt-0.5" />
        <div className="min-w-0">
          <h1 className="text-base font-medium text-primary">
            Connect <span className="whitespace-nowrap">{client.client_name}</span>?
          </h1>
          <p className="mt-1 text-xs text-secondary leading-relaxed">
            It will be able to read and write records in the workspace you choose, through the same tools
            your own agents use.
          </p>
        </div>
      </div>

      <div className="mt-5">
        <span className="text-2xs text-tertiary block mb-1.5">Workspace</span>
        {workspaces === null ? (
          <div className="h-9 flex items-center"><Loader2 className="w-4 h-4 animate-spin text-tertiary" /></div>
        ) : workspaces.length === 0 ? (
          <p className="text-xs text-warning">You are not a member of any workspace yet.</p>
        ) : (
          <div className="space-y-1">
            {workspaces.map((w) => (
              <label key={w.id}
                className={`flex items-center gap-2.5 rounded-lg border p-2.5 cursor-pointer transition-colors ${
                  chosen === w.id ? 'border-accent bg-accent/5' : 'border-subtle hover:border-strong'}`}>
                <input type="radio" name="ws" checked={chosen === w.id} onChange={() => setChosen(w.id)}
                  className="accent-accent" />
                <span className="text-sm text-primary flex-1 truncate">{w.name}</span>
                {chosen === w.id && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <span className="text-2xs text-tertiary block mb-1.5">Access</span>
        <div className="flex gap-1.5">
          <button onClick={() => setScope('full')}
            className={`h-7 px-2.5 rounded-md text-2xs font-medium ${scope === 'full' ? 'bg-inverse text-inverse-fg' : 'text-secondary ring-1 ring-subtle hover:bg-surface-sunken'}`}>
            Read and write
          </button>
          <button onClick={() => setScope('read')}
            className={`h-7 px-2.5 rounded-md text-2xs font-medium ${scope === 'read' ? 'bg-inverse text-inverse-fg' : 'text-secondary ring-1 ring-subtle hover:bg-surface-sunken'}`}>
            Read only
          </button>
        </div>
        <p className="mt-1.5 text-3xs text-tertiary leading-relaxed">
          {scope === 'read'
            ? 'It can look at your records and never change them.'
            : 'It can create, update and delete records — the same as a member of the workspace.'}
        </p>
      </div>

      {/* Where the code is going, in full. Somebody who reads one thing on this
          screen should be able to read this. */}
      <p className="mt-4 text-3xs text-tertiary break-all leading-relaxed">
        You will be returned to <span className="font-mono text-secondary">{q.redirectUri}</span>
      </p>

      {err && <p className="mt-3 text-xs text-danger leading-relaxed">{err}</p>}

      <div className="mt-5 flex gap-2">
        <Button variant="primary" className="flex-1 justify-center"
          onClick={approve} disabled={busy || !chosen || !workspaces?.length}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
          Connect
        </Button>
        <Button variant="ghost" onClick={deny} disabled={busy}>Cancel</Button>
      </div>
    </Shell>
  );
}
