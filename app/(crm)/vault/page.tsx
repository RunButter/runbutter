'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Lock, Plus, Copy, Check, Eye, EyeOff, Trash2, RefreshCw, ShieldAlert, KeyRound, ExternalLink } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import AppLoading from '@/components/ui/AppLoading';
import EmptyState from '@/components/ui/EmptyState';
import { useDialog } from '@/components/ui/Dialog';
import { getWorkspace } from '@/lib/crm/data';
import { rpc } from '@/lib/rpc';
import PasswordGenerator from '@/components/crm/PasswordGenerator';
import {
  deriveKey, randomSalt, sealItem, openItem, makeVerifier, checkVerifier,
  DEFAULT_ITERATIONS, type VaultItem,
} from '@/lib/vault/crypto';

/**
 * The shared logins every company has and nowhere good to put.
 *
 * ── THE PASSPHRASE LIVES IN THIS COMPONENT'S STATE AND NOWHERE ELSE ─────────
 * Not localStorage, not sessionStorage, not a cookie. Persisting it would mean
 * the vault is open for anyone who gets the laptop, which is the threat this is
 * most likely to actually meet — far likelier than the database leak the
 * encryption is aimed at. The cost is retyping it after a reload, and that is
 * the correct trade for a screen somebody opens twice a week.
 *
 * ── WHAT IS AND IS NOT PROMISED ─────────────────────────────────────────────
 * The server stores a salt, an IV and ciphertext, and holds no key — so a
 * database leak, a stolen backup or a curious operator gets nothing. It does
 * NOT defend against this page being replaced by a malicious one, which is true
 * of every browser-delivered vault and is said plainly on screen rather than
 * left for someone to assume otherwise.
 */

interface Row { id: string; ct: string; iv: string; updated_at: string; item: VaultItem | null }

export default function VaultPage() {
  const { ready, authenticated, user } = usePrivy();
  const { confirm } = useDialog();
  const privy = authenticated && user ? user.id : null;

  const [wsId, setWsId] = useState<string | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; item: VaultItem } | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    if (!privy) { setLoading(false); return; }
    let dead = false;
    getWorkspace(privy).then(async (w) => {
      if (!w || dead) { setLoading(false); return; }
      setWsId(w.id);
      const { data } = await rpc('get_vault_meta', { p_privy: privy, p_workspace: w.id });
      if (!dead) { setMeta(data ?? { exists: false }); setLoading(false); }
    });
    return () => { dead = true; };
  }, [privy]);

  const loadItems = useCallback(async (k: CryptoKey, ws: string, p: string) => {
    const { data } = await rpc('list_vault_items', { p_privy: p, p_workspace: ws });
    const list = Array.isArray(data) ? data : [];
    setRows(await Promise.all(list.map(async (r: any) => ({ ...r, item: await openItem(k, { ct: r.ct, iv: r.iv }) }))));
  }, []);

  /** Derive, check the verifier, then load. A wrong passphrase stops here. */
  const unlock = async () => {
    if (!wsId || !privy || !pass) return;
    setBusy(true); setErr('');
    try {
      const k = await deriveKey(pass, meta.salt, meta.iterations);
      if (!(await checkVerifier(k, { ct: meta.verifier_ct, iv: meta.verifier_iv }))) {
        setErr('That passphrase does not open this vault.'); setBusy(false); return;
      }
      setKey(k); setPass('');
      await loadItems(k, wsId, privy);
    } catch (e: any) { setErr(e?.message || 'Could not open the vault.'); }
    setBusy(false);
  };

  const create = async () => {
    if (!wsId || !privy) return;
    if (pass.length < 12) { setErr('Use at least 12 characters. This is the only thing protecting the vault.'); return; }
    if (pass !== pass2) { setErr('The two passphrases do not match.'); return; }
    setBusy(true); setErr('');
    try {
      const salt = randomSalt();
      const k = await deriveKey(pass, salt, DEFAULT_ITERATIONS);
      const v = await makeVerifier(k);
      const { data, error } = await rpc('init_vault', {
        p_privy: privy, p_workspace: wsId, p_salt: salt,
        p_iterations: DEFAULT_ITERATIONS, p_verifier_ct: v.ct, p_verifier_iv: v.iv,
      });
      if (error) { setErr(error.message); setBusy(false); return; }
      setMeta(data); setKey(k); setRows([]); setPass(''); setPass2('');
    } catch (e: any) { setErr(e?.message || 'Could not create the vault.'); }
    setBusy(false);
  };

  const save = async (item: VaultItem, id: string | null) => {
    if (!key || !wsId || !privy) return;
    const sealed = await sealItem(key, item);
    const { error } = await rpc('save_vault_item', {
      p_privy: privy, p_workspace: wsId, p_id: id, p_ct: sealed.ct, p_iv: sealed.iv,
    });
    if (error) { setErr(error.message); return; }
    setEditing(null);
    await loadItems(key, wsId, privy);
  };

  const remove = async (id: string, title: string) => {
    if (!wsId || !privy || !key) return;
    if (!(await confirm({ title: 'Delete this login?', body: `“${title}” will be gone. There is no copy on the server that anyone can read.`, confirmLabel: 'Delete', danger: true }))) return;
    await rpc('delete_vault_item', { p_privy: privy, p_workspace: wsId, p_id: id });
    await loadItems(key, wsId, privy);
  };

  /**
   * Change the passphrase: decrypt everything under the old key, re-encrypt
   * under a new one, and send the salt, the verifier and every item TOGETHER.
   *
   * rotate_vault writes them in one transaction, and that is the only reason
   * this is safe to offer. Replacing the salt and then failing partway through
   * the items would leave every remaining row permanently unreadable — a
   * sequence of calls from here cannot be atomic, so the atomicity lives in
   * SQL. An item that will not decrypt under the current key aborts the whole
   * thing rather than being written back as garbage or quietly dropped.
   */
  const rotate = async (next: string) => {
    if (!key || !wsId || !privy) return;
    setBusy(true); setErr('');
    try {
      const items = [];
      for (const r of rows) {
        if (!r.item) { setErr('One item cannot be decrypted, so the passphrase cannot be changed. Delete or fix it first.'); setBusy(false); return; }
        items.push({ id: r.id, item: r.item });
      }
      const salt = randomSalt();
      const k = await deriveKey(next, salt, DEFAULT_ITERATIONS);
      const v = await makeVerifier(k);
      const payload = await Promise.all(items.map(async (x) => {
        const sealed = await sealItem(k, x.item);
        return { id: x.id, ct: sealed.ct, iv: sealed.iv };
      }));
      const { data, error } = await rpc('rotate_vault', {
        p_privy: privy, p_workspace: wsId, p_salt: salt, p_iterations: DEFAULT_ITERATIONS,
        p_verifier_ct: v.ct, p_verifier_iv: v.iv, p_items: payload,
      });
      if (error) {
        // STALE_VAULT means somebody added an item since this tab loaded, and
        // rotating would have left it encrypted under the old key with no way
        // back. Reloading is the fix, and saying so is better than retrying.
        setErr(error.message === 'STALE_VAULT'
          ? 'Someone changed the vault while this was open. Reload and try again.'
          : error.message);
        setBusy(false); return;
      }
      setMeta(data); setKey(k); setRotating(false);
      await loadItems(k, wsId, privy);
    } catch (e: any) { setErr(e?.message || 'Could not change the passphrase.'); }
    setBusy(false);
  };

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    // Filtering happens over DECRYPTED values, in memory — the server has no
    // title column to search, which is the point.
    return rows.filter((r) => r.item && [r.item.title, r.item.username, r.item.url]
      .some((v) => String(v || '').toLowerCase().includes(s)));
  }, [rows, q]);

  if (!ready || loading) return <AppLoading label="Checking for a vault…" />;

  return (
    <>
      <PageHeader title="Vault">
        {key && (
          <>
            <button onClick={() => setGenOpen(true)}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-secondary ring-1 ring-subtle hover:bg-surface-sunken">
              <KeyRound className="w-3.5 h-3.5" /> Generate
            </button>
            <button onClick={() => setEditing({ id: null, item: { title: '' } })}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm">
              <Plus className="w-3.5 h-3.5" /> New login
            </button>
          </>
        )}
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="page-body p-6 2xl:p-8 flex flex-col gap-5">

          {!privy && <EmptyState title="Sign in to open the vault" description="A vault belongs to a workspace." />}

          {privy && !meta?.exists && (
            <SetUp pass={pass} pass2={pass2} setPass={setPass} setPass2={setPass2}
              onCreate={create} busy={busy} err={err} />
          )}

          {privy && meta?.exists && !key && (
            <Unlock pass={pass} setPass={setPass} onUnlock={unlock} busy={busy} err={err}
              onReset={async () => {
                if (!wsId) return;
                if (!(await confirm({
                  title: 'Delete the vault and everything in it?',
                  body: 'There is no recovery — the server has never had the key. Every stored login is destroyed and a new vault can be created afterwards.',
                  confirmLabel: 'Delete the vault', danger: true,
                }))) return;
                const { error } = await rpc('reset_vault', { p_privy: privy, p_workspace: wsId });
                if (error) { setErr(error.message === 'NOT_ALLOWED' ? 'Only an owner or admin can delete the vault.' : error.message); return; }
                setMeta({ exists: false }); setRows([]); setErr('');
              }} />
          )}

          {key && (
            <>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this vault…"
                aria-label="Search the vault"
                className="h-9 px-3 rounded-lg bg-surface ring-1 ring-subtle shadow-sm text-sm text-primary placeholder:text-tertiary" />

              {visible.length === 0 ? (
                <EmptyState title={rows.length ? 'Nothing matches' : 'The vault is empty'}
                  description={rows.length ? 'Try a different word.' : 'Add the logins your team shares — the registrar, the analytics account, the social inbox.'} />
              ) : (
                <div className="flex flex-col gap-2">
                  {visible.map((r) => (
                    <ItemCard key={r.id} row={r}
                      onEdit={() => r.item && setEditing({ id: r.id, item: r.item })}
                      onDelete={() => remove(r.id, r.item?.title || 'this login')} />
                  ))}
                </div>
              )}

              <button onClick={() => { setRotating(true); setErr(''); }}
                className="self-start text-2xs text-tertiary hover:text-primary underline underline-offset-2">
                Change the vault passphrase
              </button>

              <p className="text-2xs text-tertiary">
                Encrypted in this browser. The server holds a salt and ciphertext and has never had the key,
                so a database leak reveals nothing — but a vault delivered as a web page cannot defend against
                the page itself being tampered with. Use it for shared team logins, not for your bank.
              </p>
            </>
          )}
        </div>
      </div>

      {editing && <ItemEditor initial={editing.item} onCancel={() => setEditing(null)}
        onSave={(it) => save(it, editing.id)} />}
      {genOpen && <PasswordGenerator onClose={() => setGenOpen(false)} />}
      {rotating && <Rotate count={rows.length} busy={busy} err={err}
        onCancel={() => { setRotating(false); setErr(''); }} onRotate={rotate} />}
    </>
  );
}

function SetUp({ pass, pass2, setPass, setPass2, onCreate, busy, err }: {
  pass: string; pass2: string; setPass: (v: string) => void; setPass2: (v: string) => void;
  onCreate: () => void; busy: boolean; err: string;
}) {
  return (
    <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-6 max-w-xl">
      <div className="flex items-center gap-2"><Lock className="w-4 h-4 text-accent" />
        <h2 className="text-sm font-medium text-primary">Create the team vault</h2></div>
      <p className="mt-2 text-2xs text-secondary">
        Pick one passphrase for the workspace and share it with your team however you already
        share things that matter. It is never sent to the server — the encryption key is built
        from it in your browser.
      </p>
      <div className="mt-3 rounded-lg bg-warning/10 ring-1 ring-warning/30 p-3 flex gap-2">
        <ShieldAlert className="w-4 h-4 text-warning shrink-0 mt-0.5" />
        <p className="text-2xs text-secondary">
          <strong className="text-primary">There is no reset.</strong> Nobody here can recover it,
          because nobody here has ever held it. If it is lost, the vault has to be deleted and rebuilt.
        </p>
      </div>
      <label className="mt-4 block">
        <span className="text-2xs text-secondary">Passphrase</span>
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password"
          className="mt-1 w-full h-9 px-3 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary" />
      </label>
      <label className="mt-3 block">
        <span className="text-2xs text-secondary">Again</span>
        <input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password"
          className="mt-1 w-full h-9 px-3 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary" />
      </label>
      {err && <p className="mt-2 text-2xs text-danger">{err}</p>}
      <button onClick={onCreate} disabled={busy || !pass}
        className="mt-4 h-9 px-4 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
        {busy ? 'Creating…' : 'Create vault'}
      </button>
    </div>
  );
}

function Unlock({ pass, setPass, onUnlock, busy, err, onReset }: {
  pass: string; setPass: (v: string) => void; onUnlock: () => void;
  busy: boolean; err: string; onReset: () => void;
}) {
  return (
    <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-6 max-w-md">
      <div className="flex items-center gap-2"><Lock className="w-4 h-4 text-accent" />
        <h2 className="text-sm font-medium text-primary">Unlock</h2></div>
      <p className="mt-1 text-2xs text-tertiary">Held in this tab only — you will type it again after a reload.</p>
      <form onSubmit={(e) => { e.preventDefault(); onUnlock(); }}>
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus
          aria-label="Vault passphrase" autoComplete="off"
          className="mt-3 w-full h-9 px-3 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary" />
        {err && <p className="mt-2 text-2xs text-danger">{err}</p>}
        <button type="submit" disabled={busy || !pass}
          className="mt-3 h-9 px-4 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
          {busy ? 'Deriving key…' : 'Unlock'}
        </button>
      </form>
      <button onClick={onReset} className="mt-4 text-2xs text-tertiary hover:text-danger underline underline-offset-2">
        Lost the passphrase? Delete the vault and start again.
      </button>
    </div>
  );
}

function ItemCard({ row, onEdit, onDelete }: { row: Row; onEdit: () => void; onDelete: () => void }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState('');
  const it = row.item;

  const copy = async (what: string, v?: string) => {
    if (!v) return;
    try { await navigator.clipboard.writeText(v); setCopied(what); setTimeout(() => setCopied(''), 1400); } catch { /* denied */ }
  };

  if (!it) {
    // Never silently dropped: a row that will not decrypt is a row somebody
    // needs to know about, not one that quietly disappears from the list.
    return (
      <div className="rounded-xl bg-danger/5 ring-1 ring-danger/30 p-3">
        <p className="text-2xs text-danger">One item could not be decrypted. It was saved under a different passphrase, or it is damaged.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-surface ring-1 ring-subtle shadow-card p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-primary truncate">{it.title || 'Untitled'}</p>
          {it.username && (
            <button onClick={() => copy('user', it.username)} className="mt-0.5 text-2xs text-secondary hover:text-primary">
              {it.username} {copied === 'user' ? <Check className="inline w-3 h-3 text-success" /> : <Copy className="inline w-3 h-3 opacity-50" />}
            </button>
          )}
          {it.url && (
            <a href={/^https?:\/\//i.test(it.url) ? it.url : `https://${it.url}`} target="_blank" rel="noopener noreferrer"
              className="mt-0.5 block text-2xs text-tertiary hover:text-accent truncate">
              {it.url} <ExternalLink className="inline w-3 h-3" />
            </a>
          )}
          {it.notes && <p className="mt-1 text-2xs text-tertiary whitespace-pre-wrap line-clamp-3">{it.notes}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {it.password && (
            <>
              <code className="text-2xs text-secondary bg-surface-sunken rounded px-1.5 py-1 max-w-[14rem] truncate">
                {show ? it.password : '••••••••••••'}
              </code>
              <button onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
                className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover">
                {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => copy('pw', it.password)} aria-label="Copy password"
                className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover">
                {copied === 'pw' ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </>
          )}
          <button onClick={onEdit} className="px-2 h-7 rounded-md text-2xs text-secondary hover:bg-surface-hover">Edit</button>
          <button onClick={onDelete} aria-label="Delete" className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-surface-hover">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemEditor({ initial, onSave, onCancel }: {
  initial: VaultItem; onSave: (it: VaultItem) => void; onCancel: () => void;
}) {
  const [it, setIt] = useState<VaultItem>(initial);
  const [gen, setGen] = useState(false);
  const f = (k: keyof VaultItem) => (e: any) => setIt((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-surface ring-1 ring-subtle shadow-lg overflow-hidden">
        <div className="h-12 px-4 flex items-center border-b border-subtle">
          <h2 className="text-sm font-medium text-primary">{initial.title ? 'Edit login' : 'New login'}</h2>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <Field label="Name" value={it.title || ''} onChange={f('title')} placeholder="Domain registrar" autoFocus />
          <Field label="Username" value={it.username || ''} onChange={f('username')} />
          <div>
            <div className="flex items-center justify-between">
              <span className="text-2xs text-secondary">Password</span>
              <button onClick={() => setGen(true)} className="text-2xs text-accent hover:underline">Generate</button>
            </div>
            <input value={it.password || ''} onChange={f('password')} aria-label="Password"
              className="mt-1 w-full h-9 px-3 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary font-mono" />
          </div>
          <Field label="URL" value={it.url || ''} onChange={f('url')} placeholder="https://…" />
          <div>
            <span className="text-2xs text-secondary">Notes</span>
            <textarea value={it.notes || ''} onChange={f('notes')} rows={3} aria-label="Notes"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary" />
          </div>
        </div>
        <div className="h-12 px-4 flex items-center justify-end gap-2 border-t border-subtle">
          <button onClick={onCancel} className="h-8 px-3 rounded-lg text-sm text-secondary hover:bg-surface-hover">Cancel</button>
          <button onClick={() => onSave(it)} disabled={!it.title?.trim()}
            className="h-8 px-3 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
            Save
          </button>
        </div>
      </div>
      {gen && <PasswordGenerator onClose={() => setGen(false)}
        onUse={(pw) => { setIt((p) => ({ ...p, password: pw })); setGen(false); }} />}
    </div>
  );
}

function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-2xs text-secondary">{label}</span>
      <input {...rest} aria-label={label}
        className="mt-1 w-full h-9 px-3 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary" />
    </label>
  );
}

function Rotate({ count, busy, err, onCancel, onRotate }: {
  count: number; busy: boolean; err: string; onCancel: () => void; onRotate: (p: string) => void;
}) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const bad = a.length < 12 ? 'Use at least 12 characters.' : a !== b ? 'The two do not match.' : '';
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl bg-surface ring-1 ring-subtle shadow-lg p-5">
        <h2 className="text-sm font-medium text-primary">Change the vault passphrase</h2>
        <p className="mt-1 text-2xs text-secondary">
          All {count} item{count === 1 ? '' : 's'} will be re-encrypted in this browser and written in one
          go. Everyone on the team needs the new passphrase before they can open the vault again.
        </p>
        <label className="mt-3 block">
          <span className="text-2xs text-secondary">New passphrase</span>
          <input type="password" value={a} onChange={(e) => setA(e.target.value)} autoComplete="new-password"
            className="mt-1 w-full h-9 px-3 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary" />
        </label>
        <label className="mt-2 block">
          <span className="text-2xs text-secondary">Again</span>
          <input type="password" value={b} onChange={(e) => setB(e.target.value)} autoComplete="new-password"
            className="mt-1 w-full h-9 px-3 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary" />
        </label>
        {(err || (a && bad)) && <p className="mt-2 text-2xs text-danger">{err || bad}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="h-8 px-3 rounded-lg text-sm text-secondary hover:bg-surface-hover">Cancel</button>
          <button onClick={() => onRotate(a)} disabled={busy || !!bad}
            className="h-8 px-3 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
            {busy ? 'Re-encrypting…' : 'Change it'}
          </button>
        </div>
      </div>
    </div>
  );
}
