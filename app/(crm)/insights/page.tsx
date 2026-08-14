'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePrivy, getAccessToken } from '@privy-io/react-auth';
import { Sparkles, Loader2, CornerDownLeft } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import AppLoading from '@/components/ui/AppLoading';
import InsightChart from '@/components/crm/InsightChart';
import RecordTable from '@/components/crm/RecordTable';
import { OBJECTS } from '@/lib/crm/registry';
import { loadCustomObjects, customObjectMap } from '@/lib/crm/custom';
import { loadRecords, getWorkspace } from '@/lib/crm/data';
import { runSpec } from '@/lib/insights/run';
import {
  describeSpec, isNumeric, CHART_KINDS, METRIC_FNS,
  type InsightSpec, type SchemaObject, type ChartKind, type MetricFn,
} from '@/lib/insights/spec';
import type { ObjectDef } from '@/lib/crm/types';

/**
 * Ask a question about the business, get a chart.
 *
 * THE POINT OF THIS SCREEN is the thing no competitor can do. Notion, ClickUp
 * and Monday all have databases and all have AI; none of them has invoices, a
 * ledger, deals and candidates in ONE relational store, so none of them can
 * answer a question that crosses departments. Here it is one query.
 *
 * THE MODEL NEVER TOUCHES THE DATA. It is sent the column NAMES and the
 * question, and returns a spec (see lib/insights/spec.ts). The rows are fetched
 * by the browser through `list_records` — the tenancy-safe read used everywhere
 * else — and the arithmetic happens locally. So no record is ever in the prompt,
 * which means a hostile string typed into a record cannot reach the model at
 * all, and the answer cannot be poisoned by the data it is about.
 *
 * THE QUERY IS ALWAYS SHOWN, and every part of it is a dropdown. A number you
 * cannot check is worse than no number: the failure mode of natural-language
 * analytics is not a crash, it is a confident chart of the wrong column. Being
 * able to see "sum of amount, grouped by status" and fix the one wrong dropdown
 * is what makes it usable for anything that matters. It also means the whole
 * screen works with NO AI KEY — the model is a shortcut to a query you could
 * always have built by hand.
 */

const EXAMPLES = [
  'How much do clients owe us, by company?',
  'How many invoices are overdue?',
  'Deals by stage',
  'Expenses this quarter by category',
];

function toSchema(o: ObjectDef): SchemaObject {
  return {
    slug: o.slug,
    plural: o.plural,
    fields: o.fields.map((f) => ({ key: f.key, label: f.label, type: f.type })),
  };
}

export default function InsightsPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [wsId, setWsId] = useState<string | null>(null);
  const [custom, setCustom] = useState<Record<string, ObjectDef>>({});
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [spec, setSpec] = useState<InsightSpec | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);

  useEffect(() => {
    if (!privy) return;
    let cancelled = false;
    getWorkspace(privy).then(async (w) => {
      if (cancelled || !w?.id) return;
      setWsId(w.id);
      const { rows: co } = await loadCustomObjects(privy, w.id);
      if (!cancelled) setCustom(customObjectMap(co));
    });
    return () => { cancelled = true; };
  }, [privy]);

  // Everything queryable: the built-ins plus this workspace's own objects. A
  // custom object is answerable the day it is created, for the same reason the
  // board and calendar work on one — it is all ObjectDef underneath.
  const allObjects = useMemo<ObjectDef[]>(() => {
    const merged: Record<string, ObjectDef> = { ...custom, ...OBJECTS };
    return Object.values(merged).filter((o) => o.fields.length > 0);
  }, [custom]);

  const schemas = useMemo(() => allObjects.map(toSchema), [allObjects]);
  const objectDef = spec ? allObjects.find((o) => o.slug === spec.object) : undefined;
  const schema = objectDef ? toSchema(objectDef) : undefined;

  // Rows for whichever object the current spec names.
  useEffect(() => {
    if (!spec || !privy) { setRows([]); return; }
    let cancelled = false;
    setLoadingRows(true);
    loadRecords(privy, spec.object).then((res) => {
      if (cancelled) return;
      setRows(res.rows); setLoadingRows(false);
    });
    return () => { cancelled = true; };
  }, [spec?.object, privy]);   // eslint-disable-line react-hooks/exhaustive-deps

  const ask = useCallback(async (q: string) => {
    if (!q.trim() || !privy || !wsId) return;
    setAsking(true); setError('');
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch('/api/insights/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
        body: JSON.stringify({ privyUserId: privy, workspaceId: wsId, question: q, objects: schemas }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j?.error || `Request failed (${res.status})`); return; }
      setSpec(j.spec as InsightSpec);
    } catch (e: any) {
      setError(e?.message || 'Could not reach the server.');
    } finally {
      setAsking(false);
    }
  }, [privy, wsId, schemas]);

  const result = useMemo(() => (spec ? runSpec(spec, rows) : null), [spec, rows]);

  // A currency metric should read as money. Counting things should not.
  const currency = !!(spec?.metric.field && objectDef?.fields.find((f) => f.key === spec.metric.field)?.type === 'currency');

  const patch = (p: Partial<InsightSpec>) => setSpec((s) => (s ? { ...s, ...p } : s));

  if (!ready) return <AppLoading label="Opening…" />;

  return (
    <>
      <PageHeader title="Ask" />

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="page-body p-6 2xl:p-8 flex flex-col gap-5">

          <div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-tertiary" />
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !asking) ask(question); }}
                  placeholder="Ask about your business — “how much do clients owe us, by company?”"
                  disabled={!privy}
                  className="w-full h-11 pl-9 pr-9 text-sm bg-surface rounded-xl ring-1 ring-subtle shadow-sm text-primary placeholder:text-tertiary outline-none transition-shadow focus:ring-2 focus:ring-accent/30" />
                <CornerDownLeft className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-tertiary" />
              </div>
              <button onClick={() => ask(question)} disabled={asking || !question.trim() || !privy}
                className="h-11 px-4 rounded-xl bg-inverse text-inverse-fg text-sm font-semibold shadow-sm disabled:opacity-40 inline-flex items-center gap-2">
                {asking ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Ask
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXAMPLES.map((x) => (
                <button key={x} onClick={() => { setQuestion(x); ask(x); }} disabled={asking || !privy}
                  className="h-6 px-2 rounded-md text-2xs text-secondary bg-surface-sunken hover:text-primary disabled:opacity-40">
                  {x}
                </button>
              ))}
            </div>
            {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          </div>

          {spec && schema && result && (
            <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-5">
              <h2 className="text-base font-medium text-primary">{spec.title}</h2>
              {/* The query, in words. Shown always — see the header. */}
              <p className="mt-0.5 text-2xs text-tertiary">{describeSpec(spec, schema)}</p>

              {/* …and as controls, so a wrong guess is one dropdown from right. */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Select value={spec.object} onChange={(v) => setSpec({ ...spec, object: v, groupBy: null, filters: [], metric: { fn: 'count', field: null } })}
                  options={allObjects.map((o) => [o.slug, o.plural])} label="Records" />
                <Select value={spec.metric.fn} onChange={(v) => patch({ metric: { fn: v as MetricFn, field: v === 'count' ? null : spec.metric.field } })}
                  options={METRIC_FNS.map((f) => [f, f])} label="Measure" />
                {spec.metric.fn !== 'count' && (
                  <Select value={spec.metric.field || ''} onChange={(v) => patch({ metric: { ...spec.metric, field: v || null } })}
                    options={[['', '—'], ...objectDef!.fields.filter((f) => isNumeric(f.type)).map((f) => [f.key, f.label] as [string, string])]} label="of" />
                )}
                <Select value={spec.groupBy || ''} onChange={(v) => patch({ groupBy: v || null })}
                  options={[['', 'nothing'], ...objectDef!.fields.map((f) => [f.key, f.label] as [string, string])]} label="Group by" />
                <Select value={spec.chart} onChange={(v) => patch({ chart: v as ChartKind })}
                  options={CHART_KINDS.map((c) => [c, c])} label="As" />
              </div>

              <div className="mt-4">
                {loadingRows ? <AppLoading /> : (
                  <InsightChart buckets={result.buckets} kind={spec.chart} currency={currency} total={result.total} />
                )}
              </div>

              <p className="mt-3 text-2xs text-tertiary">
                {result.rows.length} of {rows.length} {schema.plural.toLowerCase()} matched
                {result.truncated && ` · showing the top ${spec.limit}`}
              </p>
            </div>
          )}

          {/* The rows behind the chart. An answer you cannot open is a claim. */}
          {spec && objectDef && result && result.rows.length > 0 && (
            <div className="min-h-[16rem]">
              <RecordTable object={objectDef} rows={result.rows.slice(0, 100)} />
            </div>
          )}

          {!spec && !asking && (
            <div className="rounded-2xl bg-surface ring-1 ring-subtle p-8 text-center">
              <p className="text-sm text-secondary">Ask a question to see a chart.</p>
              <p className="mt-1 text-2xs text-tertiary">
                Your records are never sent to the model — only the column names. The query it writes is
                shown, and you can change any part of it.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Select({ value, onChange, options, label }: {
  value: string; onChange: (v: string) => void; options: [string, string][]; label: string;
}) {
  return (
    <label className="inline-flex items-center gap-1 text-2xs text-tertiary">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="h-7 px-1.5 rounded-md bg-surface-sunken text-xs text-secondary capitalize outline-none focus:ring-2 focus:ring-accent/30">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
