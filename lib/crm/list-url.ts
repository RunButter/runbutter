'use client';

import type { FilterState } from '@/components/crm/FilterBar';

/**
 * List state in the URL.
 *
 * WHY THIS EXISTS. Filters, a search term and an open record all lived in
 * React state, which means "the overdue invoices for Northwind" was something
 * you could look at and not something you could send. That matters twice over
 * now: a colleague cannot be pointed at a view, and an agent that finds
 * something has no way to hand back WHERE it found it — only prose describing
 * a screen the reader then has to reconstruct by hand.
 *
 * A URL fixes both, and it is the cheapest possible fix: no schema, no saved
 * views table, no sharing model. The address bar already is one.
 *
 * The encoding is deliberately flat and readable — `?q=acme&f.status=overdue`
 * rather than a base64 blob — because a person is expected to read these, and
 * so is a model.
 */

const FACET_PREFIX = 'f.';

export interface ListState { query: string; filters: FilterState }

export const EMPTY_LIST_STATE: ListState = { query: '', filters: { facets: {}, from: '', to: '' } };

/** Read list state out of a query string. Unknown params pass through untouched. */
export function readListState(search: string): ListState {
  const p = new URLSearchParams(search);
  const facets: Record<string, string> = {};
  p.forEach((v, k) => {
    if (k.startsWith(FACET_PREFIX) && v) facets[k.slice(FACET_PREFIX.length)] = v;
  });
  return {
    query: p.get('q') || '',
    filters: { facets, from: p.get('from') || '', to: p.get('to') || '' },
  };
}

/**
 * Write list state back into a query string, preserving anything else already
 * there. Empty values are REMOVED rather than written as blanks, so a cleared
 * filter produces a clean URL instead of `?q=&from=&to=` — which would be
 * ugly, and would make two identical views look like different links.
 */
export function writeListState(search: string, s: ListState): string {
  const p = new URLSearchParams(search);
  // Drop every facet first: a facet that was cleared has no key to update, so
  // patching in place would leave the old one behind forever.
  [...p.keys()].filter((k) => k.startsWith(FACET_PREFIX)).forEach((k) => p.delete(k));

  const set = (k: string, v: string) => (v ? p.set(k, v) : p.delete(k));
  set('q', s.query.trim());
  set('from', s.filters.from);
  set('to', s.filters.to);
  for (const [k, v] of Object.entries(s.filters.facets)) if (v) p.set(FACET_PREFIX + k, v);

  const out = p.toString();
  return out ? `?${out}` : '';
}

export const sameListState = (a: ListState, b: ListState) =>
  writeListState('', a) === writeListState('', b);
