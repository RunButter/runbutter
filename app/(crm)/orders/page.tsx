'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Plus, Trash2, AlertTriangle, Package } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import AppLoading from '@/components/ui/AppLoading';
import EmptyState from '@/components/ui/EmptyState';
import { useDialog } from '@/components/ui/Dialog';
import { getWorkspace, loadRecords } from '@/lib/crm/data';
import { rpc } from '@/lib/rpc';

/**
 * Orders, and what they do to the shelf.
 *
 * ── THE STATUS IS THE STOCK CONTROL ─────────────────────────────────────────
 * Moving an order to paid takes its units; cancelling gives them back. That is
 * enforced in SQL (0124), so this screen changes a status and reloads rather
 * than doing arithmetic of its own — a second implementation of "how much is
 * left" is how a shop ends up with two answers and no way to tell which is real.
 *
 * A draft deliberately holds nothing, which is what makes a quote safe to build
 * without reserving inventory somebody else can still buy.
 */

interface Row {
  id: string; number: string | null; status: string; currency: string;
  customer: string | null; items: number; total: number; stock_applied: boolean;
}
interface Low { id: string; name: string; stock: number; out: boolean }
interface Item { product_id: string | null; name: string; quantity: number; unit_price: number }

const STATUSES = ['draft', 'pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded'] as const;
const TONE: Record<string, string> = {
  draft: 'text-tertiary', pending: 'text-warning', paid: 'text-success',
  shipped: 'text-accent', delivered: 'text-success',
  cancelled: 'text-danger', refunded: 'text-danger',
};
const blank = (): Item => ({ product_id: null, name: '', quantity: 1, unit_price: 0 });

const money = (n: any, cur: string) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(Number(n || 0)); }
  catch { return `${Number(n || 0).toFixed(2)} ${cur}`; }
};

export default function OrdersPage() {
  const { ready, authenticated, user } = usePrivy();
  const { confirm } = useDialog();
  const privy = authenticated && user ? user.id : null;

  const [wsId, setWsId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [low, setLow] = useState<Low[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState<null | { customer: string; items: Item[] }>(null);

  const load = useCallback(async (ws: string, p: string) => {
    const [o, l, pr] = await Promise.all([
      rpc('get_orders', { p_privy: p, p_workspace: ws }, { quiet: true }),
      rpc('get_low_stock', { p_privy: p, p_workspace: ws }, { quiet: true }),
      loadRecords(p, 'products'),
    ]);
    if (o.error?.code === 'PGRST202' || /get_orders/.test(o.error?.message || '')) {
      setUnavailable(true); setLoading(false); return;
    }
    setRows(Array.isArray(o.data) ? o.data : []);
    setLow(Array.isArray(l.data) ? l.data : []);
    setProducts(Array.isArray(pr) ? pr : (pr as any)?.rows ?? []);
    setLoading(false);
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

  const setStatus = async (r: Row, status: string) => {
    if (!privy || !wsId) return;
    const { error } = await rpc('set_order_status', { p_privy: privy, p_workspace: wsId, p_id: r.id, p_status: status });
    if (error) { setErr(error.message); return; }
    load(wsId, privy);
  };

  const save = async () => {
    if (!privy || !wsId || !draft) return;
    const items = draft.items.filter((i) => i.product_id || i.name.trim());
    if (!items.length) { setErr('An order needs at least one line.'); return; }
    const { error } = await rpc('save_order', {
      p_privy: privy, p_workspace: wsId, p_id: null,
      p_data: {
        status: 'draft',
        placed_at: new Date().toISOString().slice(0, 10),
        ship_to: draft.customer || null,
        items: items.map((i) => ({
          product_id: i.product_id, name: i.name,
          quantity: String(i.quantity), unit_price: i.unit_price ? String(i.unit_price) : null,
        })),
      },
    });
    if (error) { setErr(error.message); return; }
    setDraft(null); setErr('');
    load(wsId, privy);
  };

  const remove = async (r: Row) => {
    if (!privy || !wsId) return;
    if (!(await confirm({
      title: `Delete ${r.number || 'this order'}?`,
      body: r.stock_applied
        ? 'It is holding stock, which goes back on the shelf.'
        : 'It holds no stock, so nothing changes on the shelf.',
      confirmLabel: 'Delete', danger: true,
    }))) return;
    await rpc('delete_order', { p_privy: privy, p_workspace: wsId, p_id: r.id });
    load(wsId, privy);
  };

  const setItem = (i: number, patch: Partial<Item>) => {
    if (!draft) return;
    const next = [...draft.items];
    next[i] = { ...next[i], ...patch };
    setDraft({ ...draft, items: next });
  };

  if (!ready || loading) return <AppLoading label="Reading orders…" />;

  return (
    <>
      <PageHeader title="Orders">
        <button onClick={() => setDraft({ customer: '', items: [blank()] })} disabled={!privy || unavailable}
          className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm disabled:opacity-40">
          <Plus className="w-3.5 h-3.5" /> New order
        </button>
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="page-body p-6 2xl:p-8 flex flex-col gap-5">

          {unavailable && <EmptyState title="Not enabled on this server yet" description="Migration 0124 has not been applied." />}
          {err && <p className="text-2xs text-danger">{err}</p>}

          {low.length > 0 && (
            <div className="rounded-xl bg-warning/10 ring-1 ring-warning/30 px-4 py-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-2xs text-secondary">
                <b className="text-primary">Running low: </b>
                {low.map((l, i) => (
                  <span key={l.id} className={l.out ? 'text-danger' : ''}>
                    {i > 0 && ', '}{l.name} ({Number(l.stock)}{l.out ? ' — out' : ''})
                  </span>
                ))}
              </p>
            </div>
          )}

          {draft && (
            <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-5">
              <h2 className="text-sm font-medium text-primary">New order</h2>
              <p className="mt-0.5 text-2xs text-tertiary">
                It starts as a draft, which holds no stock. Mark it paid when it is, and the units come off.
              </p>
              <label className="mt-3 block">
                <span className="text-2xs text-secondary">Ship to</span>
                <input value={draft.customer} onChange={(e) => setDraft({ ...draft, customer: e.target.value })}
                  aria-label="Ship to" placeholder="Name and address"
                  className="mt-1 w-full h-9 px-3 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary" />
              </label>

              <div className="mt-3 flex flex-col gap-2">
                {draft.items.map((it, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <select value={it.product_id ?? ''} aria-label="Product"
                      onChange={(e) => {
                        const p = products.find((x) => x.id === e.target.value);
                        setItem(i, {
                          product_id: e.target.value || null,
                          name: p?.name ?? it.name,
                          unit_price: p ? Number(p.unit_price || 0) : it.unit_price,
                        });
                      }}
                      className="h-9 px-2 flex-1 min-w-[10rem] rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary">
                      <option value="">— a one-off line —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.stock != null ? ` · ${Number(p.stock)} left` : ''}
                        </option>
                      ))}
                    </select>
                    {!it.product_id && (
                      <input value={it.name} placeholder="Description" aria-label="Line description"
                        onChange={(e) => setItem(i, { name: e.target.value })}
                        className="h-9 px-2 w-40 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary" />
                    )}
                    <input type="number" value={it.quantity} min={1} aria-label="Quantity"
                      onChange={(e) => setItem(i, { quantity: Number(e.target.value) || 1 })}
                      className="h-9 px-2 w-20 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary tabular-nums" />
                    <input type="number" value={it.unit_price} step="0.01" aria-label="Unit price"
                      onChange={(e) => setItem(i, { unit_price: Number(e.target.value) || 0 })}
                      className="h-9 px-2 w-24 rounded-lg bg-surface-sunken ring-1 ring-subtle text-sm text-primary tabular-nums" />
                    <button onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })}
                      aria-label="Remove line" className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-surface-hover">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button onClick={() => setDraft({ ...draft, items: [...draft.items, blank()] })}
                  className="self-start h-7 px-2.5 rounded-md text-2xs text-secondary ring-1 ring-subtle hover:bg-surface-hover">
                  Add a line
                </button>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <span className="text-sm font-medium text-primary tabular-nums mr-auto">
                  {money(draft.items.reduce((a, i) => a + i.quantity * i.unit_price, 0), 'USD')}
                </span>
                <button onClick={() => { setDraft(null); setErr(''); }}
                  className="h-8 px-3 rounded-lg text-sm text-secondary hover:bg-surface-hover">Cancel</button>
                <button onClick={save}
                  className="h-8 px-3 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">Create</button>
              </div>
            </div>
          )}

          {!unavailable && rows.length === 0 && !draft && (
            <EmptyState title="No orders yet"
              description="Create one from your product catalogue. A draft holds no stock; marking it paid takes the units off the shelf." />
          )}

          {rows.length > 0 && (
            <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-2xs">
                  <thead>
                    <tr className="h-10 border-b border-subtle text-tertiary">
                      <th className="text-left font-medium px-5">Order</th>
                      <th className="text-left font-medium px-2">Customer</th>
                      <th className="text-right font-medium px-2">Lines</th>
                      <th className="text-right font-medium px-2">Total</th>
                      <th className="text-left font-medium px-2">Status</th>
                      <th className="px-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="h-11 border-b border-subtle last:border-0 tabular-nums">
                        <td className="px-5">
                          <span className="text-primary">{r.number || 'Order'}</span>
                          {r.stock_applied && (
                            <span title="This order is holding stock"
                              className="ml-1.5 text-3xs text-tertiary inline-flex items-center gap-0.5">
                              <Package className="w-3 h-3" /> held
                            </span>
                          )}
                        </td>
                        <td className="px-2 text-secondary">{r.customer || '—'}</td>
                        <td className="px-2 text-right text-secondary">{r.items}</td>
                        <td className="px-2 text-right font-semibold text-primary">{money(r.total, r.currency)}</td>
                        <td className="px-2">
                          <select value={r.status} onChange={(e) => setStatus(r, e.target.value)}
                            aria-label={`Status of ${r.number || 'order'}`}
                            className={`h-7 px-2 rounded-md text-2xs capitalize bg-surface-sunken ring-1 ring-subtle ${TONE[r.status] || ''}`}>
                            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td className="px-3 text-right">
                          <button onClick={() => remove(r)} aria-label="Delete order"
                            className="p-1 rounded-md text-tertiary hover:text-danger hover:bg-surface-hover">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-5 py-2 text-3xs text-tertiary border-t border-subtle">
                Paid, shipped and delivered hold stock. Draft, pending, cancelled and refunded do not — moving
                between them takes or returns the units exactly once, however many times you change your mind.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
