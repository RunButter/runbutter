'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import {
  Loader2, Plus, Upload, Download, Search, Landmark, Link2, X, Check, Trash2,
  Tag, Ban, ArrowDownRight, ArrowUpRight, Sparkles, ArrowLeft,
} from 'lucide-react';
import { OBJECTS } from '@/lib/crm/registry';
import {
  loadLedger, loadBankAccounts, createBankAccount, deleteBankAccount,
  reconcileTransaction, suggestMatches, bulkUpdateTransactions,
  updateRecord, deleteRecord, importRecords,
  type LedgerTxn, type BankAccount, type LedgerSummary, type MatchSuggestion,
} from '@/lib/crm/data';
import { toCSV, downloadCSV, parseCSV, autoMatch } from '@/lib/crm/csv';
import RecordForm from '@/components/crm/RecordForm';
import { useDialog } from '@/components/ui/Dialog';

const PERIODS = [{ label: '1M', months: 1 }, { label: '3M', months: 3 }, { label: '6M', months: 6 }, { label: '12M', months: 12 }];
const OBJ = OBJECTS.transactions;

const money = (n: number) => (n < 0 ? '−' : '') + '$' + Math.abs(Math.round(n)).toLocaleString();
const fmtDate = (s?: string | null) => {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en', { day: '2-digit', month: 'short' });
};

const STATUS_PILL: Record<string, string> = {
  posted: 'bg-success/10 text-success ring-success/30',
  pending: 'bg-warning/10 text-warning ring-warning/30',
  excluded: 'bg-surface-hover text-tertiary ring-subtle',
};

export default function TransactionsPage() {
  const { confirm: confirmDialog, notify } = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const canEdit = !!privy;

  const [months, setMonths] = useState(12);
  const [account, setAccount] = useState<string | null>(null);   // null = all accounts
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [rows, setRows] = useState<LedgerTxn[]>([]);
  const [summary, setSummary] = useState<LedgerSummary>({ inflow: 0, outflow: 0, net: 0, count: 0, unreconciled: 0 });
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<LedgerTxn | null>(null);
  const [form, setForm] = useState<{ initial: any } | null>(null);
  const [importing, setImporting] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);

  const reloadAccounts = useCallback(() => {
    loadBankAccounts(privy).then((r) => setAccounts(r.accounts));
  }, [privy]);

  const reload = useCallback(() => {
    setLoading(true);
    loadLedger(privy, account, months).then((r) => {
      setRows(r.rows); setSummary(r.summary); setLive(r.live); setLoading(false);
    });
  }, [privy, account, months]);

  useEffect(() => { if (ready) reloadAccounts(); }, [ready, reloadAccounts]);
  useEffect(() => { if (ready) reload(); }, [ready, reload]);
  useEffect(() => { setSelected(new Set()); }, [account, months]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.description, r.category, r.account, r.match].some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [rows, query]);

  const categorySuggestions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.category).filter(Boolean))) as string[],
    [rows],
  );

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allShownSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allShownSelected ? new Set() : new Set(filtered.map((r) => r.id)));

  const exportCsv = (subset: LedgerTxn[]) => {
    const cols = ['Date', 'Description', 'Category', 'Account', 'Method', 'Status', 'Amount', 'Matched'];
    const csv = toCSV(cols, subset.map((r) => [r.txn_date, r.description, r.category, r.account, r.method, r.status, r.amount, r.match]));
    downloadCSV(`transactions-${new Date().toISOString().slice(0, 10)}`, csv);
  };

  const bulk = async (patch: Record<string, any>) => {
    if (!privy || selected.size === 0) return;
    const res = await bulkUpdateTransactions(privy, [...selected], patch);
    if (res.error) { notify(res.error); return; }
    setSelected(new Set()); reload(); reloadAccounts();
  };

  const bulkDelete = async () => {
    if (!privy || selected.size === 0) return;
    if (!await confirmDialog(`Delete ${selected.size} transaction${selected.size === 1 ? '' : 's'}? This can’t be undone.`)) return;
    const results = await Promise.all([...selected].map((id) => deleteRecord(privy, 'transactions', id)));
    setSelected(new Set()); reload(); reloadAccounts();
    const failed = results.filter((r) => r.error);
    if (failed.length) notify(failed[0].error?.includes('FORBIDDEN') ? 'Deleting requires an owner/admin role.' : `${failed.length} could not be deleted.`);
  };

  // New transaction: create via the generic form, then attach the active account.
  const activeAccountId = account || accounts[0]?.id || null;
  const onCreated = async (newId?: string) => {
    setForm(null);
    if (newId && activeAccountId && privy) await updateRecord(privy, 'transactions', newId, { bank_account_id: activeAccountId });
    reload(); reloadAccounts();
  };

  const totalCash = accounts.reduce((s, a) => s + a.balance, 0);

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-subtle">
        <h1 className="text-sm font-semibold text-primary">Transactions</h1>
        <span className={`text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>{live ? 'Live' : 'Sample'}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-tertiary" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…"
              className="h-7 w-40 pl-7 pr-2 text-[12px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none" />
          </div>
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-hover ring-1 ring-subtle">
            {PERIODS.map((p) => (
              <button key={p.label} onClick={() => setMonths(p.months)}
                className={`h-6 px-2 rounded-md text-[11px] font-semibold transition-colors ${months === p.months ? 'bg-surface text-primary shadow-sm' : 'text-tertiary hover:text-secondary'}`}>{p.label}</button>
            ))}
          </div>
          <button onClick={() => exportCsv(filtered)} disabled={filtered.length === 0}
            className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-secondary ring-1 ring-subtle hover:bg-surface-sunken disabled:opacity-40"><Download className="w-3.5 h-3.5" /> Export</button>
          <button onClick={() => setImporting(true)} disabled={!canEdit}
            className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-secondary ring-1 ring-subtle hover:bg-surface-sunken disabled:opacity-40" title={!canEdit ? 'Sign in to import' : ''}><Upload className="w-3.5 h-3.5" /> Import</button>
          <button onClick={() => setForm({ initial: { txn_date: new Date().toISOString().slice(0, 10), status: 'posted', method: 'transfer' } })} disabled={!canEdit}
            className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm disabled:opacity-40" title={!canEdit ? 'Sign in to add' : ''}><Plus className="w-3.5 h-3.5" /> New</button>
        </div>
      </header>

      {/* Account tabs */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-subtle overflow-x-auto">
        <button onClick={() => setAccount(null)}
          className={`h-9 shrink-0 px-3 rounded-lg text-left ring-1 transition-colors ${account === null ? 'bg-surface ring-strong shadow-sm' : 'ring-subtle hover:bg-surface-sunken'}`}>
          <div className="text-[12px] font-semibold text-primary leading-tight">All accounts</div>
          <div className="text-[11px] tabular-nums text-secondary leading-tight">{money(totalCash)}</div>
        </button>
        {accounts.map((a) => (
          <button key={a.id} onClick={() => setAccount(a.id)}
            className={`h-9 shrink-0 px-3 rounded-lg text-left ring-1 transition-colors ${account === a.id ? 'bg-surface ring-strong shadow-sm' : 'ring-subtle hover:bg-surface-sunken'}`}>
            <div className="text-[12px] font-semibold text-primary leading-tight flex items-center gap-1.5"><Landmark className="w-3 h-3 text-tertiary" /> {a.name}</div>
            <div className={`text-[11px] tabular-nums leading-tight ${a.balance < 0 ? 'text-danger' : 'text-secondary'}`}>{money(a.balance)}</div>
          </button>
        ))}
        <button onClick={() => setAddingAccount(true)} disabled={!canEdit}
          className="h-9 shrink-0 px-2.5 rounded-lg text-[12px] font-semibold text-secondary ring-1 ring-dashed ring-strong hover:bg-surface-sunken disabled:opacity-40 inline-flex items-center gap-1.5" title={!canEdit ? 'Sign in to add' : ''}><Plus className="w-3.5 h-3.5" /> Account</button>
      </div>

      {/* Summary cards */}
      <div className="shrink-0 grid grid-cols-2 lg:grid-cols-4 gap-3 px-4 py-3">
        {[
          { label: 'Money in', value: money(summary.inflow), tone: 'text-success', icon: ArrowUpRight },
          { label: 'Money out', value: money(summary.outflow), tone: 'text-danger', icon: ArrowDownRight },
          { label: 'Net', value: money(summary.net), tone: summary.net >= 0 ? 'text-success' : 'text-danger', icon: ArrowLeftRightGlyph },
          { label: 'To reconcile', value: String(summary.unreconciled), tone: summary.unreconciled > 0 ? 'text-warning' : 'text-tertiary', icon: Link2 },
        ].map((c) => (
          <div key={c.label} className="rounded-xl bg-surface ring-1 ring-subtle shadow-card p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">{c.label}</span>
              <c.icon className="w-4 h-4 text-tertiary" />
            </div>
            <div className={`mt-1 text-xl font-semibold tabular-nums ${c.tone}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Ledger */}
      <div className="flex-1 overflow-auto px-4 pb-6">
        {loading ? (
          <div className="h-40 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <div className="rounded-xl bg-surface ring-1 ring-subtle shadow-card overflow-hidden">
            <table className="w-full text-[13px] border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="w-9 px-3 h-9 bg-surface-sunken/60 border-b border-subtle">
                    <input type="checkbox" checked={allShownSelected} onChange={toggleAll} className="rounded border-subtle accent-accent cursor-pointer" />
                  </th>
                  {['Date', 'Description', 'Category', 'Account', 'Status', 'Reconciled', 'Amount'].map((h, i) => (
                    <th key={h} className={`px-3 h-9 bg-surface-sunken/60 text-[11px] font-semibold uppercase tracking-wider text-tertiary border-b border-subtle ${i === 6 ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const on = selected.has(r.id);
                  const excluded = r.status === 'excluded';
                  return (
                    <tr key={r.id} onClick={() => setDrawer(r)}
                      className={`group cursor-pointer transition-colors ${on ? 'bg-accent/10' : 'hover:bg-surface-sunken/70'} ${excluded ? 'opacity-50' : ''}`}>
                      <td className="px-3 h-[44px] border-b border-subtle" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={on} onChange={() => toggle(r.id)}
                          className={`rounded border-subtle accent-accent cursor-pointer transition-opacity ${on ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                      </td>
                      <td className="px-3 h-[44px] border-b border-subtle text-secondary tabular-nums whitespace-nowrap">{fmtDate(r.txn_date)}</td>
                      <td className="px-3 h-[44px] border-b border-subtle font-semibold text-primary max-w-[280px] truncate">{r.description || '—'}</td>
                      <td className="px-3 h-[44px] border-b border-subtle">
                        {r.category
                          ? <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold ring-1 bg-surface-sunken text-secondary ring-subtle capitalize">{r.category}</span>
                          : <span className="text-[12px] text-tertiary">Uncategorized</span>}
                      </td>
                      <td className="px-3 h-[44px] border-b border-subtle text-secondary truncate max-w-[140px]">{r.account || '—'}</td>
                      <td className="px-3 h-[44px] border-b border-subtle">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold ring-1 capitalize ${STATUS_PILL[r.status] || STATUS_PILL.posted}`}>{r.status}</span>
                      </td>
                      <td className="px-3 h-[44px] border-b border-subtle">
                        {r.match
                          ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent"><Link2 className="w-3 h-3" /> {r.match}</span>
                          : <span className="text-[11px] text-tertiary">—</span>}
                      </td>
                      <td className={`px-3 h-[44px] border-b border-subtle text-right tabular-nums font-semibold ${r.amount < 0 ? 'text-danger' : 'text-success'}`}>{money(r.amount)}</td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-14 text-center text-tertiary">No transactions in this period. Import a bank statement or add one.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bulk-action bar */}
      {selected.size > 0 && (
        <BulkBar count={selected.size} canEdit={canEdit} categorySuggestions={categorySuggestions}
          onClear={() => setSelected(new Set())}
          onCategorize={(c) => bulk({ category: c })}
          onStatus={(s) => bulk({ status: s })}
          onExport={() => exportCsv(filtered.filter((r) => selected.has(r.id)))}
          onDelete={bulkDelete} />
      )}

      {/* Reconcile drawer */}
      {drawer && (
        <ReconcileDrawer txn={drawer} privy={privy} canEdit={canEdit} categorySuggestions={categorySuggestions}
          onClose={() => setDrawer(null)}
          onChanged={() => { setDrawer(null); reload(); reloadAccounts(); }} />
      )}

      {/* New / edit transaction (generic form) */}
      {form && (
        <RecordForm object={OBJ} privyUserId={privy} recordId={null} initial={form.initial}
          suggestions={{ category: categorySuggestions }}
          onClose={() => setForm(null)} onSaved={onCreated} />
      )}

      {/* Dedicated CSV import (account + sign handling) */}
      {importing && (
        <ImportTxns privy={privy} accounts={accounts} defaultAccount={activeAccountId}
          onClose={() => setImporting(false)} onDone={() => { setImporting(false); reload(); reloadAccounts(); }} />
      )}

      {/* Add bank account */}
      {addingAccount && (
        <AddAccount privy={privy} onClose={() => setAddingAccount(false)}
          onSaved={(id) => { setAddingAccount(false); reloadAccounts(); if (id) setAccount(id); }} />
      )}
    </>
  );
}

// A tiny inline glyph for the "Net" card (avoids another lucide import name clash).
function ArrowLeftRightGlyph(props: any) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m16 3 4 4-4 4" /><path d="M20 7H4" /><path d="m8 21-4-4 4-4" /><path d="M4 17h16" />
    </svg>
  );
}

// ── Bulk action bar ───────────────────────────────────────────────────────────
function BulkBar({ count, canEdit, categorySuggestions, onClear, onCategorize, onStatus, onExport, onDelete }: {
  count: number; canEdit: boolean; categorySuggestions: string[];
  onClear: () => void; onCategorize: (c: string) => void; onStatus: (s: string) => void; onExport: () => void; onDelete: () => void;
}) {
  const [cat, setCat] = useState('');
  const [showCat, setShowCat] = useState(false);
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 bg-surface border border-strong text-primary rounded-lg shadow-popover pl-3 pr-1.5 py-1.5 text-[13px] animate-in fade-in slide-in-from-bottom-2 duration-150">
      <span className="font-medium tabular-nums">{count} selected</span>
      <button onClick={onClear} className="text-tertiary hover:text-primary text-[12px] font-medium ml-1 mr-1">clear</button>
      <span className="w-px h-5 bg-subtle" />
      {canEdit && (
        <div className="relative">
          <button onClick={() => setShowCat((s) => !s)} className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md font-medium text-secondary hover:bg-surface-hover hover:text-primary"><Tag className="w-3.5 h-3.5" /> Categorize</button>
          {showCat && (
            <div className="absolute bottom-9 left-0 w-56 bg-surface text-primary rounded-lg border border-subtle shadow-popover p-2" onClick={(e) => e.stopPropagation()}>
              <input autoFocus list="bulk-cats" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="Category…"
                onKeyDown={(e) => { if (e.key === 'Enter' && cat.trim()) { onCategorize(cat.trim()); setShowCat(false); setCat(''); } }}
                className="w-full h-8 px-2 text-[13px] rounded-md border border-subtle bg-surface text-primary placeholder:text-tertiary focus:border-accent focus:ring-2 focus:ring-accent/25 outline-none" />
              <datalist id="bulk-cats">{categorySuggestions.map((c) => <option key={c} value={c} />)}</datalist>
              <button onClick={() => { if (cat.trim()) { onCategorize(cat.trim()); setShowCat(false); setCat(''); } }}
                className="mt-1.5 w-full h-7 rounded-md text-[12px] font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">Apply</button>
            </div>
          )}
        </div>
      )}
      {canEdit && <button onClick={() => onStatus('posted')} className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md font-medium text-secondary hover:bg-surface-hover hover:text-primary"><Check className="w-3.5 h-3.5" /> Posted</button>}
      {canEdit && <button onClick={() => onStatus('excluded')} className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md font-medium text-secondary hover:bg-surface-hover hover:text-primary"><Ban className="w-3.5 h-3.5" /> Exclude</button>}
      <button onClick={onExport} className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md font-medium text-secondary hover:bg-surface-hover hover:text-primary"><Download className="w-3.5 h-3.5" /> Export</button>
      {canEdit && <button onClick={onDelete} className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md font-medium text-danger hover:bg-danger/10"><Trash2 className="w-3.5 h-3.5" /> Delete</button>}
      <button onClick={onClear} aria-label="Close" className="h-7 w-7 inline-flex items-center justify-center rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
    </div>
  );
}

// ── Reconcile drawer ──────────────────────────────────────────────────────────
function ReconcileDrawer({ txn, privy, canEdit, categorySuggestions, onClose, onChanged }: {
  txn: LedgerTxn; privy: string | null; canEdit: boolean; categorySuggestions: string[];
  onClose: () => void; onChanged: () => void;
}) {
  const { notify } = useDialog();
  const [suggestions, setSuggestions] = useState<MatchSuggestion[] | null>(null);
  const [busy, setBusy] = useState('');
  const [cat, setCat] = useState(txn.category || '');
  const [status, setStatus] = useState(txn.status);

  useEffect(() => {
    if (!privy || txn.match) { setSuggestions([]); return; }
    setSuggestions(null);
    suggestMatches(privy, txn.id).then(setSuggestions);
  }, [privy, txn.id, txn.match]);

  const doMatch = async (kind: 'invoice' | 'expense', targetId: string) => {
    if (!privy) return;
    setBusy(targetId);
    const res = await reconcileTransaction(privy, txn.id, kind, targetId);
    setBusy('');
    if (res.error) { notify(res.error); return; }
    onChanged();
  };
  const unmatch = async () => {
    if (!privy) return;
    setBusy('unmatch');
    const res = await reconcileTransaction(privy, txn.id, 'none');
    setBusy('');
    if (res.error) { notify(res.error); return; }
    onChanged();
  };
  const saveEdits = async () => {
    if (!privy) return;
    setBusy('save');
    const res = await updateRecord(privy, 'transactions', txn.id, { category: cat, status });
    setBusy('');
    if (res.error) { notify(res.error); return; }
    onChanged();
  };

  const out = txn.amount < 0;
  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/50 backdrop-blur-[2px]" onClick={onClose}>
      <div className="w-full max-w-sm h-full bg-surface shadow-popover ring-1 ring-subtle flex flex-col animate-in slide-in-from-right duration-150" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-subtle">
          <h2 className="text-sm font-semibold text-primary">Transaction</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <div>
            <div className="text-[15px] font-semibold text-primary">{txn.description || '—'}</div>
            <div className={`text-2xl font-semibold tabular-nums ${out ? 'text-danger' : 'text-success'}`}>{money(txn.amount)}</div>
            <div className="text-[12px] text-tertiary mt-0.5">{fmtDate(txn.txn_date)} · {txn.account || 'No account'} · {txn.method.replace(/_/g, ' ')}</div>
          </div>

          {canEdit ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-[12px] font-semibold text-secondary mb-1">Category</span>
                <input list="drawer-cats" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="Uncategorized"
                  className="w-full h-9 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none" />
                <datalist id="drawer-cats">{categorySuggestions.map((c) => <option key={c} value={c} />)}</datalist>
              </label>
              <label className="block">
                <span className="block text-[12px] font-semibold text-secondary mb-1">Status</span>
                <select value={status} onChange={(e) => setStatus(e.target.value)}
                  className="w-full h-9 px-2 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none capitalize">
                  {['posted', 'pending', 'excluded'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <button onClick={saveEdits} disabled={busy === 'save'} className="col-span-2 h-8 rounded-md text-[13px] font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-sunken inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
                {busy === 'save' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save changes
              </button>
            </div>
          ) : (
            <p className="text-[12px] text-warning bg-warning/10 rounded-lg px-3 py-2 ring-1 ring-warning/30">Sign in to categorize and reconcile.</p>
          )}

          {/* Reconciliation */}
          <div>
            <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold uppercase tracking-wider text-tertiary">
              <Sparkles className="w-3.5 h-3.5" /> Reconciliation
            </div>
            {txn.match ? (
              <div className="rounded-lg ring-1 ring-accent/30 bg-accent/10 p-3">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-accent"><Link2 className="w-3.5 h-3.5" /> {txn.match}</div>
                <p className="text-[12px] text-secondary mt-1">Linked and marked paid.</p>
                {canEdit && <button onClick={unmatch} disabled={busy === 'unmatch'} className="mt-2 h-7 px-2.5 rounded-md text-[12px] font-semibold text-secondary ring-1 ring-subtle hover:bg-surface inline-flex items-center gap-1.5 disabled:opacity-50">{busy === 'unmatch' && <Loader2 className="w-3 h-3 animate-spin" />} Unmatch</button>}
              </div>
            ) : suggestions === null ? (
              <div className="h-16 flex items-center justify-center text-tertiary"><Loader2 className="w-4 h-4 animate-spin" /></div>
            ) : suggestions.length === 0 ? (
              <p className="text-[12px] text-tertiary">{canEdit ? `No open ${out ? 'expenses/bills' : 'invoices'} match this amount.` : 'Sign in to see suggested matches.'}</p>
            ) : (
              <div className="space-y-1.5">
                <p className="text-[12px] text-secondary">Suggested {out ? 'bills/expenses' : 'invoices'} — matching marks the document paid.</p>
                {suggestions.map((s) => (
                  <div key={`${s.kind}-${s.id}`} className="flex items-center gap-2 rounded-lg ring-1 ring-subtle p-2.5 hover:ring-strong">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-primary truncate">{s.label}</div>
                      <div className="text-[11px] text-tertiary tabular-nums">${Number(s.amount).toLocaleString()} · {fmtDate(s.date)} · {s.status}</div>
                    </div>
                    {canEdit && (
                      <button onClick={() => doMatch(s.kind, s.id)} disabled={busy === s.id}
                        className="h-7 px-2.5 rounded-md text-[12px] font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 inline-flex items-center gap-1.5 disabled:opacity-50">
                        {busy === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Match
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Add bank account ──────────────────────────────────────────────────────────
function AddAccount({ privy, onClose, onSaved }: { privy: string | null; onClose: () => void; onSaved: (id?: string) => void }) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [institution, setInstitution] = useState('');
  const [opening, setOpening] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!privy) { setError('Sign in to add an account.'); return; }
    if (!name.trim()) { setError('Name is required.'); return; }
    setBusy(true); setError('');
    const res = await createBankAccount(privy, name.trim(), currency.trim() || 'USD', Number(opening) || 0, institution.trim());
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    onSaved(res.id);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-surface rounded-xl ring-1 ring-subtle shadow-popover animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 flex items-center justify-between px-4 border-b border-subtle">
          <h2 className="text-sm font-semibold text-primary">New bank account</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <label className="block"><span className="block text-[12px] font-semibold text-secondary mb-1">Name *</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Business checking" className="w-full h-9 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="block text-[12px] font-semibold text-secondary mb-1">Currency</span>
              <input value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full h-9 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none uppercase" /></label>
            <label className="block"><span className="block text-[12px] font-semibold text-secondary mb-1">Opening balance</span>
              <input type="number" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" className="w-full h-9 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none" /></label>
          </div>
          <label className="block"><span className="block text-[12px] font-semibold text-secondary mb-1">Institution</span>
            <input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Mercury, Revolut…" className="w-full h-9 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none" /></label>
          {error && <p className="text-[12px] text-danger">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 p-3 border-t border-subtle">
          <button onClick={onClose} className="h-8 px-3 rounded-md text-[13px] font-medium text-secondary hover:bg-surface-hover">Cancel</button>
          <button onClick={save} disabled={busy} className="h-8 px-3 rounded-md text-[13px] font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 inline-flex items-center gap-1.5 disabled:opacity-50">{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Create</button>
        </div>
      </div>
    </div>
  );
}

// ── CSV import (account target + debit/credit or signed amount) ────────────────
const num = (x: string) => parseFloat(String(x ?? '').replace(/[^0-9.-]/g, '')) || 0;

function ImportTxns({ privy, accounts, defaultAccount, onClose, onDone }: {
  privy: string | null; accounts: BankAccount[]; defaultAccount: string | null; onClose: () => void; onDone: () => void;
}) {
  const [step, setStep] = useState<'source' | 'map' | 'done'>('source');
  const [text, setText] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [acct, setAcct] = useState<string>(defaultAccount || accounts[0]?.id || '');
  const [map, setMap] = useState<Record<string, number>>({ txn_date: -1, description: -1, amount: -1, debit: -1, credit: -1, category: -1 });
  const [flip, setFlip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [count, setCount] = useState(0);

  const readFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ''));
    reader.readAsText(file);
  };

  const parse = () => {
    setError('');
    const { headers: h, rows: r } = parseCSV(text);
    if (h.length === 0 || r.length === 0) { setError('Could not find a header row and data.'); return; }
    setHeaders(h); setRows(r);
    setMap({
      txn_date: autoMatch('txn_date', 'date', h),
      description: autoMatch('description', 'description', h),
      amount: autoMatch('amount', 'amount', h),
      debit: autoMatch('debit', 'debit', h),
      credit: autoMatch('credit', 'credit', h),
      category: autoMatch('category', 'category', h),
    });
    setStep('map');
  };

  const run = async () => {
    if (!privy) { setError('Sign in to import.'); return; }
    if (map.amount < 0 && map.debit < 0 && map.credit < 0) { setError('Map an Amount column, or Debit/Credit columns.'); return; }
    setBusy(true); setError('');
    const useDC = map.debit >= 0 || map.credit >= 0;
    const payload = rows.map((r) => {
      let amount = useDC ? num(r[map.credit] ?? '') - num(r[map.debit] ?? '') : num(r[map.amount] ?? '');
      if (!useDC && flip) amount = -amount;
      return {
        bank_account_id: acct || '',
        txn_date: (r[map.txn_date] ?? '').trim(),
        description: (r[map.description] ?? '').trim(),
        category: map.category >= 0 ? (r[map.category] ?? '').trim() : '',
        amount: String(amount),
      };
    });
    const res = await importRecords(privy, 'transactions', payload);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setCount(res.count || 0); setStep('done');
  };

  const sel = (key: string) => (
    <select value={map[key] ?? -1} onChange={(e) => setMap((m) => ({ ...m, [key]: Number(e.target.value) }))}
      className="flex-1 h-8 px-2 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none">
      <option value={-1}>— skip —</option>
      {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
    </select>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col bg-surface rounded-xl ring-1 ring-subtle shadow-popover animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-subtle">
          <h2 className="text-sm font-semibold text-primary flex items-center gap-2">
            {step === 'map' && <button onClick={() => setStep('source')} className="p-1 -ml-1 rounded text-tertiary hover:bg-surface-hover"><ArrowLeft className="w-4 h-4" /></button>}
            Import transactions
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {step === 'source' && (
            <div className="space-y-4">
              <label className="block"><span className="block text-[12px] font-semibold text-secondary mb-1">Import into account</span>
                <select value={acct} onChange={(e) => setAcct(e.target.value)} className="w-full h-9 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none">
                  <option value="">— no account —</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label className="flex items-center justify-center gap-2 h-20 rounded-lg ring-1 ring-dashed ring-strong text-[13px] text-secondary cursor-pointer hover:ring-strong hover:bg-surface-sunken">
                <Upload className="w-4 h-4" /> Upload a bank-statement .csv
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} />
              </label>
              <div>
                <span className="block text-[12px] font-semibold text-secondary mb-1">…or paste CSV</span>
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="Date,Description,Amount&#10;2026-07-01,Stripe payout,4200&#10;2026-07-02,AWS,-820"
                  className="w-full px-2.5 py-2 text-[12px] font-mono rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none" />
              </div>
              {error && <p className="text-[12px] text-danger">{error}</p>}
            </div>
          )}

          {step === 'map' && (
            <div className="space-y-3">
              <p className="text-[12px] text-secondary">{rows.length} rows detected. Map your columns:</p>
              {[['txn_date', 'Date'], ['description', 'Description'], ['category', 'Category']].map(([k, label]) => (
                <div key={k} className="flex items-center gap-3"><span className="w-32 shrink-0 text-[13px] font-medium text-secondary">{label}</span>{sel(k)}</div>
              ))}
              <div className="h-px bg-surface-hover my-1" />
              <p className="text-[11px] font-semibold uppercase tracking-wider text-tertiary">Amount — one signed column, or separate debit/credit</p>
              <div className="flex items-center gap-3"><span className="w-32 shrink-0 text-[13px] font-medium text-secondary">Amount (signed)</span>{sel('amount')}</div>
              <div className="flex items-center gap-3"><span className="w-32 shrink-0 text-[13px] font-medium text-secondary">Money out (debit)</span>{sel('debit')}</div>
              <div className="flex items-center gap-3"><span className="w-32 shrink-0 text-[13px] font-medium text-secondary">Money in (credit)</span>{sel('credit')}</div>
              {map.debit < 0 && map.credit < 0 && (
                <label className="flex items-center gap-2 text-[12px] text-secondary pt-1">
                  <input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} className="rounded border-subtle accent-accent" />
                  Positive numbers are money OUT (flip the sign)
                </label>
              )}
              {error && <p className="text-[12px] text-danger">{error}</p>}
            </div>
          )}

          {step === 'done' && (
            <div className="py-8 text-center">
              <Check className="w-10 h-10 text-success mx-auto mb-3" />
              <p className="text-sm font-semibold text-primary">Imported {count} transactions</p>
              <p className="text-[12px] text-secondary mt-1">{rows.length - count > 0 ? `${rows.length - count} rows were skipped (bad date/amount).` : 'All rows imported.'}</p>
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-end gap-2 p-3 border-t border-subtle">
          {step === 'source' && <>
            <button onClick={onClose} className="h-8 px-3 rounded-md text-[13px] font-medium text-secondary hover:bg-surface-hover">Cancel</button>
            <button onClick={parse} disabled={!text.trim()} className="h-8 px-3 rounded-md text-[13px] font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">Continue</button>
          </>}
          {step === 'map' && (
            <button onClick={run} disabled={busy} className="h-8 px-3 rounded-md text-[13px] font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 inline-flex items-center gap-1.5 disabled:opacity-50">{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Import {rows.length} rows</button>
          )}
          {step === 'done' && <button onClick={onDone} className="h-8 px-3 rounded-md text-[13px] font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">Done</button>}
        </div>
      </div>
    </div>
  );
}
