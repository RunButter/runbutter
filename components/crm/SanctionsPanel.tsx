'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, RefreshCw, ChevronDown, ChevronRight,
} from 'lucide-react';
import {
  screenName, loadSanctionsStatus, refreshSanctionsList,
  type ScreeningResult, type SanctionsStatus, type SanctionsMatch,
} from '@/lib/crm/sanctions';

interface Props {
  privyUserId: string | null;
  workspaceId: string | null;
  /** The name to screen — a company or person's legal name. */
  name: string;
  object: string;
  recordId: string;
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : 'never');

function MatchRow({ m }: { m: SanctionsMatch }) {
  const [open, setOpen] = useState(false);
  const pct = Math.round((Number(m.score) || 0) * 100);
  return (
    <li className="py-2">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-start gap-2 text-left group">
        {open ? <ChevronDown className="w-3.5 h-3.5 mt-0.5 text-tertiary shrink-0" />
              : <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-tertiary shrink-0" />}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-primary truncate group-hover:underline">{m.name}</span>
          <span className="block text-2xs text-tertiary truncate">
            {[m.entity_type, ...(m.programs || [])].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="text-2xs font-semibold text-warning tabular-nums shrink-0">{pct}%</span>
      </button>
      {open && (
        <dl className="mt-1.5 ml-5 space-y-1 text-2xs">
          {m.aliases?.length > 0 && (
            <div><dt className="inline text-tertiary">Also known as: </dt><dd className="inline text-secondary">{m.aliases.join(' · ')}</dd></div>
          )}
          {m.countries?.length > 0 && (
            <div><dt className="inline text-tertiary">Countries: </dt><dd className="inline text-secondary">{m.countries.join(', ')}</dd></div>
          )}
          {m.addresses?.length > 0 && (
            <div><dt className="inline text-tertiary">Addresses: </dt><dd className="inline text-secondary">{m.addresses.slice(0, 3).join(' | ')}</dd></div>
          )}
          {m.remarks && (
            <div><dt className="inline text-tertiary">Remarks: </dt><dd className="inline text-secondary">{m.remarks}</dd></div>
          )}
          <div><dt className="inline text-tertiary">Source: </dt><dd className="inline text-secondary uppercase">{m.source.replace(/_/g, ' ')}</dd></div>
        </dl>
      )}
    </li>
  );
}

/**
 * Screen a counterparty against the imported OFAC lists.
 *
 * Three states, and the distinction between them is the whole point:
 *   review  — names came back; a human decides whether any of them IS this party
 *   clear   — screened against a list we actually hold, nothing matched
 *   no data — no list imported, so we know nothing. Never shown as "clear".
 */
export default function SanctionsPanel({ privyUserId, workspaceId, name, object, recordId }: Props) {
  const [status, setStatus] = useState<SanctionsStatus | null>(null);
  const [result, setResult] = useState<ScreeningResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const reloadStatus = useCallback(async () => {
    if (!privyUserId || !workspaceId) return;
    setStatus(await loadSanctionsStatus(privyUserId, workspaceId));
  }, [privyUserId, workspaceId]);

  useEffect(() => { reloadStatus(); }, [reloadStatus]);

  const run = async () => {
    if (!privyUserId || !workspaceId) return;
    setBusy(true); setError(''); setResult(null);
    const { result: r, error: e } = await screenName(privyUserId, workspaceId, name, object, recordId);
    if (e) setError(e); else setResult(r!);
    setBusy(false);
  };

  const refresh = async () => {
    setRefreshing(true); setError('');
    const res = await refreshSanctionsList();
    if (res.error) setError(res.error);
    else {
      const failed = (res.sources || []).filter((s: any) => s.error);
      if (failed.length) setError(failed.map((s: any) => `${s.source}: ${s.error}`).join(' · '));
    }
    await reloadStatus();
    setRefreshing(false);
  };

  const empty = !status || status.total === 0;
  const lastSync = status?.sources?.reduce<string | null>(
    (acc, s) => (s.synced_at && (!acc || s.synced_at > acc) ? s.synced_at : acc), null) ?? null;

  return (
    <section className="mt-5 pt-4 border-t border-subtle">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-3xs font-semibold uppercase tracking-widest text-tertiary">Sanctions screening</h3>
        <button onClick={refresh} disabled={refreshing || !privyUserId}
          title="Re-download the OFAC lists"
          className="h-6 px-1.5 inline-flex items-center gap-1 rounded-md text-2xs font-medium text-tertiary hover:bg-surface-hover disabled:opacity-40">
          {refreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Update list
        </button>
      </div>

      <p className="text-2xs text-tertiary mb-2.5">
        {empty
          ? 'No list imported yet. Update the list to screen against OFAC.'
          : `${status!.total.toLocaleString()} OFAC entries · list updated ${fmtDate(lastSync)}`}
      </p>

      <button onClick={run} disabled={busy || !privyUserId || !workspaceId}
        className="w-full h-8 inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-semibold text-accent ring-1 ring-accent/30 bg-accent/10 hover:bg-accent/20 disabled:opacity-50">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
        Screen “{name}”
      </button>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {result?.status === 'no_data' && (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-warning/10 p-2.5">
          <ShieldQuestion className="w-4 h-4 text-warning shrink-0 mt-px" />
          <p className="text-xs text-warning">
            No sanctions list is loaded, so this name has <strong>not</strong> been checked. Update the list first.
          </p>
        </div>
      )}

      {result?.status === 'clear' && (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-success/10 p-2.5">
          <ShieldCheck className="w-4 h-4 text-success shrink-0 mt-px" />
          <p className="text-xs text-success">
            No match in the OFAC lists as of {fmtDate(lastSync)}. Screened as “{result.normalized}”.
          </p>
        </div>
      )}

      {result?.status === 'review' && (
        <div className="mt-3 rounded-md bg-warning/10 p-2.5">
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-warning shrink-0 mt-px" />
            <p className="text-xs text-warning">
              {result.match_count} possible {result.match_count === 1 ? 'match' : 'matches'} — a name resemblance is not
              proof of identity. Review each before trading.
            </p>
          </div>
          <ul className="mt-1.5 ml-6 divide-y divide-warning/20">
            {result.matches.map((m) => <MatchRow key={m.id} m={m} />)}
          </ul>
        </div>
      )}
    </section>
  );
}
