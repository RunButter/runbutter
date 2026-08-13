'use client';

import { useEffect } from 'react';

/**
 * "The copilot changed something — reload what you are showing."
 *
 * WHY AN EVENT AND NOT REALTIME. Supabase Realtime needs anon-key RLS policies
 * on every table it watches, and this app deliberately has none: every read
 * goes through the /api/rpc proxy so the browser never holds a capability of
 * its own. Opening RLS to get live updates would undo the entire auth model for
 * a refresh. Team chat made the same call and polls instead (0075).
 *
 * And nothing here needs a server push. The only writer the page cares about is
 * the copilot running in the SAME TAB — it knows exactly what it touched,
 * because every tool call is recorded on the run. So the signal travels
 * in-process and costs one event.
 *
 * WHAT IT DOES NOT DO, on purpose: it does not push another person's edits into
 * your screen. That needs a server and is a different feature; pretending this
 * is that would leave someone trusting a list that silently went stale.
 */

const EVENT = 'rb:changed';

/** What changed, in the vocabulary the pages already use. */
export interface Changed {
  /** Object slugs written, e.g. ['invoices']. */
  objects?: string[];
  docs?: boolean;
  newsletters?: boolean;
}

export function notifyChanged(what: Changed): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<Changed>(EVENT, { detail: what }));
}

/**
 * Reload when something this screen shows has changed.
 *
 * `keys` are the things the screen is looking at — an object slug, `docs`, or
 * `newsletters`. An empty `keys` means "anything", which is right for a
 * dashboard that aggregates several.
 *
 * `reload` is read through a ref rather than listed as a dependency, because
 * pages define it inline: as a dependency it would tear down and re-add the
 * listener on every render, and the render that happens WHILE a change event is
 * dispatching is the one that drops it.
 */
export function useLiveRefresh(keys: string[], reload: () => void): void {
  useEffect(() => {
    const fn = (e: Event) => {
      const d = (e as CustomEvent<Changed>).detail || {};
      const hit =
        keys.length === 0 ||
        keys.some((k) =>
          (k === 'docs' && d.docs) ||
          (k === 'newsletters' && d.newsletters) ||
          (d.objects || []).includes(k));
      if (hit) reload();
    };
    window.addEventListener(EVENT, fn);
    return () => window.removeEventListener(EVENT, fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.join(','), reload]);
}

/**
 * A finished run's steps → what changed.
 *
 * Derived from the tool calls the run actually made rather than from what the
 * model SAID it did. A model that reports creating an invoice it never created
 * would otherwise trigger a reload that shows nothing new, which reads as the
 * page being broken rather than the model being wrong.
 *
 * Only tools that write are considered. A `list_records` on invoices means the
 * copilot looked at invoices, and reloading the page because something was READ
 * is a flicker with no cause.
 */
const WRITERS = new Set(['create_record', 'update_record', 'add_record_note']);

export function changedFromSteps(steps: any[]): Changed | null {
  const objects = new Set<string>();
  let docs = false, newsletters = false;
  for (const s of Array.isArray(steps) ? steps : []) {
    if (s?.type !== 'tool' || !s.name) continue;
    // A tool that failed changed nothing. The executor returns { error } rather
    // than throwing, so this is the only place the difference is visible.
    if (s.result && typeof s.result === 'object' && 'error' in s.result) continue;
    // A proposal is not a change. In suggest mode every write comes back
    // `proposed: true` and nothing has happened yet — reloading then would show
    // the person an unchanged page right after being told about five changes,
    // which is the most confusing possible moment to do it.
    if (s.result && typeof s.result === 'object' && (s.result as any).proposed) continue;
    if (WRITERS.has(s.name) && s.args?.object) objects.add(String(s.args.object));
    if (s.name === 'save_doc' || s.name === 'toggle_doc_item') docs = true;
    if (s.name === 'save_newsletter') newsletters = true;
  }
  if (!objects.size && !docs && !newsletters) return null;
  return { objects: [...objects], docs, newsletters };
}
