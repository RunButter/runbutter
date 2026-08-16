'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Plus, Trash2, TrendingDown } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import AppLoading from '@/components/ui/AppLoading';
import EmptyState from '@/components/ui/EmptyState';
import { useDialog } from '@/components/ui/Dialog';
import { getWorkspace } from '@/lib/crm/data';
import { rpc } from '@/lib/rpc';

/**
 * Who owns the company, and what a round would do to that.
 *
 * ── THE TWO PERCENTAGES ARE BOTH SHOWN, ALWAYS ──────────────────────────────
 * "Of issued shares" is what a founder means; "fully diluted" — including every
 * granted option AND the unissued pool — is what an investor means. They differ
 * by a lot, and a screen showing one unlabelled number is how two people leave a
 * conversation believing different things.
 *
 * ── A SAFE HAS NO PERCENTAGE HERE, AND THAT IS DELIBERATE ───────────────────
 * It converts at a price that does not exist until a round does. The homemade
 * cap table's classic lie is a percentage beside a SAFE; this lists them
 * separately with their cap and discount, and only the round simulator — which
 * has a real pre-money to convert against — turns them into shares.
 */

interface Holder {
  id: string; name: string; kind: string; email: string | null;
  shares: number; options: number; options_vested: number;
  pct_outstanding: number | null; pct_diluted: number | null;
}
interface Convertible {
  id: string; holder: string; kind: string; amount: number;
  valuation_cap: number | null; discount_pct: number | null; issued_on: string | null;
}
interface CapTable {
  as_of: string; outstanding: number; options_granted: number;
  pool_authorised: number; pool_unissued: number; fully_diluted: number;
  holders: Holder[]; convertibles: Convertible[];
}
interface Sim {
  round_price: number; pre_shares: number; pool_added: number;
  converted_shares: number; new_shares: number; post_shares: number;
  new_investors_pct: number | null; safe_holders_pct: number | null;
  conversions: { holder: string; amount: number; price: number; shares: number; converted_at: string }[];
  holders: { name: string; before_pct: number | null; after_pct: number | null }[];
  note: string;
}

const n = (v: any) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const pct = (v: any) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(2)}%`);
const usd = (v: any) => `$${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const KIND_LABEL: Record<string, string> = {
  founder: 'Founder', investor: 'Investor', employee: 'Employee', advisor: 'Advisor', entity: 'Entity',
};

export default function CapTablePage() {
  const { ready, authenticated, user } = usePrivy();
  const { confirm } = useDialog();
  const privy = authenticated && user ? user.id : null;

  const [wsId, setWsId] = useState<string | null>(null);
  const [t, setT] = useState<CapTable | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [err, setErr] = useState('');

  const [pre, setPre] = useState(12_000_000);
  const [raise, setRaise] = useState(3_000_000);
  const [pool, setPool] = useState(0);
  const [sim, setSim] = useState<Sim | null>(null);

  const [adding, setAdding] = useState<null | {
    name: string; kind: string; secKind: string;
    quantity: string; amount: string; cap: string; discount: string;
    vest_months: string; cliff_months: string; vest_start: string;
  }>(null);

  const load = useCallback(async (ws: string, p: string) => {
    const { data, error } = await rpc('get_cap_table', { p_privy: p, p_workspace: ws }, { quiet: true });
    if (error?.code === 'PGRST202' || /get_cap_table/.test(error?.message || '')) {
      setUnavailable(true); setLoading(false); return;
    }
    setT((data as CapTable) ?? null); setLoading(false);
  }, []);

  useEffect(() => {
    if (!privy) { setLoading(false); return; }
    let dead = false;
    getWorkspace(privy).then((w) => {
      if (!w || dead) { setLoading(false); return; }
      setWsId(w.id); load(w.id, privy);
    });
    return () => { dead = true; };
  }, [privy, load]);

  // The simulation re-runs on every keystroke because it is a model somebody is
  // pushing on, not a report they submit.
  useEffect(() => {
    if (!privy || !wsId || !t || t.fully_diluted <= 0 || pre <= 0) { setSim(null); return; }
    let dead = false;
    rpc('simulate_round', {
      p_privy: privy, p_workspace: wsId, p_premoney: pre, p_new_money: raise, p_pool_pct: pool,
    }, { quiet: true }).then(({ data }) => { if (!dead) setSim((data as Sim) ?? null); });
    return () => { dead = true; };
  }, [privy, wsId, t, pre, raise, pool]);

  const add = async () => {
    if (!privy || !wsId || !adding) return;
    if (!adding.name.trim()) { setErr('A holder needs a name.'); return; }
    setErr('');
    const h = await rpc('save_cap_holder', {
      p_privy: privy, p_workspace: wsId, p_id: null,
      p_name: adding.name.trim(), p_kind: adding.kind, p_email: null,
    });
    if (h.error) { setErr(h.error.message); return; }
    const data: Record<string, any> = { holder_id: h.data, kind: adding.secKind };
    if (adding.secKind === 'safe') {
      data.amount = adding.amount || null;
      data.valuation_cap = adding.cap || null;
      data.discount_pct = adding.discount || null;
    } else {
      data.quantity = adding.quantity || null;
      if (adding.secKind === 'option') {
        data.vest_start = adding.vest_start || null;
        data.vest_months = adding.vest_months || null;
        data.cliff_months = adding.cliff_months || null;
      }
    }
    const s = await rpc('save_cap_security', { p_privy: privy, p_workspace: wsId, p_id: null, p_data: data });
    if (s.error) { setErr(s.error.message); return; }
    setAdding(null);
    load(wsId, privy);
  };

  const removeHolder = async (h: Holder) => {
    if (!privy || !wsId) return;
    if (!(await confirm({
      title: `Remove ${h.name}?`,
      body: 'Their shares and options go too, so everyone else’s percentage changes.',
      confirmLabel: 'Remove', danger: true,
    }))) return;
    await rpc('delete_cap_holder', { p_privy: privy, p_workspace: wsId, p_id: h.id });
    load(wsId, privy);
  };

  const setPoolShares = async (v: number) => {
    if (!privy || !wsId) return;
    await rpc('set_option_pool', { p_privy: privy, p_workspace: wsId, p_shares: v });
    load(wsId, privy);
  };

  const empty = useMemo(() => !t || (t.holders.length === 0 && t.convertibles.length === 0), [t]);

  if (!ready || loading) return <AppLoading label="Reading the cap table…" />;

  return (
    <>
      <PageHeader title="Cap table">
        <button onClick={() => setAdding({
          name: '', kind: 'founder', secKind: 'shares', quantity: '', amount: '', cap: '', discount: '',
          vest_months: '48', cliff_months: '12', vest_start: new Date().toISOString().slice(0, 10),
        })} disabled={!privy || unavailable}
          className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm disabled:opacity-40">
          <Plus className="w-3.5 h-3.5" /> Add holder
        </button>
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="page-body p-6 2xl:p-8 flex flex-col gap-5">

          {unavailable && (
            <EmptyState title="Not enabled on this server yet"
              description="Migration 0122 has not been applied." />
          )}

          {!unavailable && empty && !adding && (
            <EmptyState title="Nothing on the cap table yet"
              description="Add the founders and their shares, set the option pool, and the dilution model below starts working." />
          )}

          {err && <p className="text-2xs text-danger">{err}</p>}

          {adding && <AddForm v={adding} set={setAdding} onSave={add} onCancel={() => { setAdding(null); setErr(''); }} />}

          {!unavailable && t && !empty && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Shares issued" value={n(t.outstanding)} />
                <Stat label="Options granted" value={n(t.options_granted)} />
                <Stat label="Pool unissued" value={n(t.pool_unissued)}
                  sub={`of ${n(t.pool_authorised)} authorised`} />
                <Stat label="Fully diluted" value={n(t.fully_diluted)} sub="issued + granted + pool" />
              </div>

              <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card overflow-hidden">
                <div className="px-5 pt-5 flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="text-sm font-medium text-primary">Ownership</h2>
                    <p className="mt-0.5 text-2xs text-tertiary">
                      <b>Of issued</b> is what a founder usually means. <b>Fully diluted</b> includes granted
                      options and the unissued pool, which is what an investor means.
                    </p>
                  </div>
                  <label className="flex items-center gap-1.5">
                    <span className="text-2xs text-tertiary">Option pool</span>
                    <input type="number" defaultValue={t.pool_authorised} aria-label="Authorised option pool"
                      onBlur={(e) => setPoolShares(Number(e.target.value) || 0)}
                      className="h-7 w-32 px-2 rounded-md bg-surface-sunken ring-1 ring-subtle text-2xs text-primary tabular-nums" />
                  </label>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-2xs">
                    <thead>
                      <tr className="h-10 border-b border-subtle text-tertiary">
                        <th className="text-left font-medium px-5">Holder</th>
                        <th className="text-right font-medium px-2">Shares</th>
                        <th className="text-right font-medium px-2">Options</th>
                        <th className="text-right font-medium px-2">Vested</th>
                        <th className="text-right font-medium px-2">Of issued</th>
                        <th className="text-right font-medium px-2">Fully diluted</th>
                        <th className="px-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {t.holders.map((h) => (
                        <tr key={h.id} className="h-11 border-b border-subtle last:border-0 tabular-nums">
                          <td className="px-5">
                            <span className="text-primary">{h.name}</span>
                            <span className="ml-2 text-3xs text-tertiary">{KIND_LABEL[h.kind] || h.kind}</span>
                          </td>
                          <td className="px-2 text-right text-secondary">{h.shares ? n(h.shares) : '—'}</td>
                          <td className="px-2 text-right text-secondary">{h.options ? n(h.options) : '—'}</td>
                          <td className="px-2 text-right text-tertiary">{h.options ? n(h.options_vested) : '—'}</td>
                          <td className="px-2 text-right text-secondary">{pct(h.pct_outstanding)}</td>
                          <td className="px-2 text-right font-semibold text-primary">{pct(h.pct_diluted)}</td>
                          <td className="px-3 text-right">
                            <button onClick={() => removeHolder(h)} aria-label={`Remove ${h.name}`}
                              className="p-1 rounded-md text-tertiary hover:text-danger hover:bg-surface-hover">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {t.pool_unissued > 0 && (
                        <tr className="h-11 border-b border-subtle last:border-0 tabular-nums bg-surface-sunken/40">
                          <td className="px-5 text-tertiary">Unissued option pool</td>
                          <td className="px-2 text-right text-tertiary">—</td>
                          <td className="px-2 text-right text-secondary">{n(t.pool_unissued)}</td>
                          <td className="px-2 text-right text-tertiary">—</td>
                          <td className="px-2 text-right text-tertiary">—</td>
                          <td className="px-2 text-right text-secondary">
                            {pct(t.fully_diluted > 0 ? (100 * t.pool_unissued) / t.fully_diluted : null)}
                          </td>
                          <td />
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {t.convertibles.length > 0 && (
                <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-5">
                  <h2 className="text-sm font-medium text-primary">SAFEs and notes</h2>
                  <p className="mt-0.5 text-2xs text-tertiary">
                    No percentage shown, on purpose: these convert at a price that does not exist until a
                    round does. The model below turns them into shares at a real pre-money.
                  </p>
                  <div className="mt-3 divide-y divide-subtle">
                    {t.convertibles.map((c) => (
                      <div key={c.id} className="flex items-center gap-3 py-2 text-2xs tabular-nums">
                        <span className="text-primary flex-1 min-w-0 truncate">{c.holder}</span>
                        <span className="text-secondary font-semibold">{usd(c.amount)}</span>
                        <span className="text-tertiary">{c.valuation_cap ? `${usd(c.valuation_cap)} cap` : 'no cap'}</span>
                        <span className="text-tertiary">{c.discount_pct ? `${c.discount_pct}% disc` : 'no discount'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-5">
                <h2 className="text-sm font-medium text-primary inline-flex items-center gap-1.5">
                  <TrendingDown className="w-4 h-4 text-tertiary" /> What a round does
                </h2>
                <p className="mt-0.5 text-2xs text-tertiary">
                  Nothing is saved. A SAFE converts at the better of its cap and its discount — the holder
                  gets the lower price and therefore more shares.
                </p>

                <div className="mt-4 grid sm:grid-cols-3 gap-3">
                  <Num label="Pre-money" value={pre} onChange={setPre} />
                  <Num label="Raising" value={raise} onChange={setRaise} />
                  <div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-2xs text-secondary">New option pool</span>
                      <span className="text-2xs font-semibold text-primary tabular-nums">{pool}%</span>
                    </div>
                    <input type="range" min={0} max={25} value={pool} aria-label="New option pool percent"
                      onChange={(e) => setPool(Number(e.target.value))}
                      className="mt-1.5 w-full h-1.5 accent-[hsl(var(--accent))] cursor-pointer" />
                    <p className="mt-0.5 text-3xs text-tertiary">Created pre-money, so it dilutes existing holders.</p>
                  </div>
                </div>

                {sim && (
                  <>
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <Stat label="Price per share" value={`$${Number(sim.round_price).toFixed(4)}`} />
                      <Stat label="New investors" value={pct(sim.new_investors_pct)} sub={`${n(sim.new_shares)} shares`} />
                      <Stat label="SAFEs convert to" value={pct(sim.safe_holders_pct)} sub={`${n(sim.converted_shares)} shares`} />
                      <Stat label="Shares after" value={n(sim.post_shares)} />
                    </div>

                    {sim.conversions.length > 0 && (
                      <div className="mt-3 rounded-lg bg-surface-sunken ring-1 ring-subtle p-3 flex flex-col gap-1">
                        {sim.conversions.map((c, i) => (
                          <p key={`${c.holder}-${i}`} className="text-2xs text-secondary tabular-nums">
                            <b className="text-primary">{c.holder}</b> — {usd(c.amount)} converts at
                            {' '}${Number(c.price).toFixed(4)} (the <b>{c.converted_at}</b>) into {n(c.shares)} shares
                          </p>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 flex flex-col gap-1.5">
                      {sim.holders.map((h) => {
                        const before = Number(h.before_pct || 0);
                        const after = Number(h.after_pct || 0);
                        return (
                          <div key={h.name} className="flex items-center gap-2 text-2xs tabular-nums">
                            <span className="text-primary flex-1 min-w-0 truncate">{h.name}</span>
                            <span className="text-tertiary w-14 text-right">{pct(h.before_pct)}</span>
                            <span className="text-tertiary">→</span>
                            <span className="font-semibold text-primary w-14 text-right">{pct(h.after_pct)}</span>
                            <span className={`w-16 text-right ${after < before ? 'text-danger' : 'text-success'}`}>
                              {after < before ? '−' : '+'}{Math.abs(after - before).toFixed(2)}pp
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <p className="mt-3 text-3xs text-tertiary">{sim.note}</p>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-surface-sunken ring-1 ring-subtle p-3">
      <p className="text-2xs text-tertiary">{label}</p>
      <p className="mt-0.5 text-base font-medium text-primary tabular-nums">{value}</p>
      {sub && <p className="text-3xs text-tertiary">{sub}</p>}
    </div>
  );
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-2xs text-secondary">{label}</span>
      <input type="number" value={value} aria-label={label} step={100000}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="mt-1 w-full h-9 px-3 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary tabular-nums" />
    </label>
  );
}

function AddForm({ v, set, onSave, onCancel }: {
  v: NonNullable<Parameters<typeof Object>[0]> & any;
  set: (x: any) => void; onSave: () => void; onCancel: () => void;
}) {
  const f = (k: string) => (e: any) => set({ ...v, [k]: e.target.value });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(); }}
      className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-5 flex flex-col gap-3">
      <h2 className="text-sm font-medium text-primary">Add a holder</h2>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-2xs text-secondary">Name</span>
          <input value={v.name} onChange={f('name')} autoFocus aria-label="Holder name"
            className="mt-1 w-full h-9 px-3 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary" />
        </label>
        <label className="block">
          <span className="text-2xs text-secondary">They are a</span>
          <select value={v.kind} onChange={f('kind')} aria-label="Holder type"
            className="mt-1 w-full h-9 px-2 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary">
            {['founder', 'investor', 'employee', 'advisor', 'entity'].map((k) =>
              <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-2xs text-secondary">They hold</span>
          <select value={v.secKind} onChange={f('secKind')} aria-label="Security type"
            className="mt-1 w-full h-9 px-2 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary">
            <option value="shares">Shares</option>
            <option value="option">Options</option>
            <option value="safe">A SAFE</option>
            <option value="note">A convertible note</option>
          </select>
        </label>
      </div>

      {v.secKind === 'safe' || v.secKind === 'note' ? (
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Amount" value={v.amount} onChange={f('amount')} placeholder="500000" />
          <Field label="Valuation cap" value={v.cap} onChange={f('cap')} placeholder="8000000" />
          <Field label="Discount %" value={v.discount} onChange={f('discount')} placeholder="20" />
        </div>
      ) : (
        <div className="grid sm:grid-cols-4 gap-3">
          <Field label={v.secKind === 'option' ? 'Options' : 'Shares'} value={v.quantity}
            onChange={f('quantity')} placeholder="1000000" />
          {v.secKind === 'option' && (
            <>
              <Field label="Vest start" value={v.vest_start} onChange={f('vest_start')} type="date" />
              <Field label="Vest months" value={v.vest_months} onChange={f('vest_months')} placeholder="48" />
              <Field label="Cliff months" value={v.cliff_months} onChange={f('cliff_months')} placeholder="12" />
            </>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-8 px-3 rounded-lg text-sm text-secondary hover:bg-surface-hover">Cancel</button>
        <button type="submit" className="h-8 px-3 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">Add</button>
      </div>
    </form>
  );
}

function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-2xs text-secondary">{label}</span>
      <input {...rest} aria-label={label}
        className="mt-1 w-full h-9 px-3 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary tabular-nums" />
    </label>
  );
}
