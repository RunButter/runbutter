'use client';

import { useEffect, useState } from 'react';
import { NAV, OBJECTS } from './registry';
import { loadCustomObjects, type CustomObject } from './custom';
import { loadObjectSettings, EMPTY_SETTINGS, viewSlug, type ObjectSettings } from './objects';
import { getWorkspace } from './data';
import { rpc } from '@/lib/rpc';

/**
 * The nav, with the workspace's own objects folded into it.
 *
 * WHY THIS EXISTS. `custom_objects.group_key` has been written since 0087 — the
 * create form asks "Nav group" and stores the answer — and nothing ever read
 * it. A custom object appeared in exactly one place: the "Open" button on
 * Settings → Objects. Someone who added Vehicles got a working table, a working
 * form, import, export and agent access, and no way to reach any of it twice.
 * That is the whole of the user-visible bug: the data was right, the nav simply
 * never asked.
 *
 * The group is now a CHOICE FROM THE REAL GROUPS rather than free text, because
 * a typo used to be unrecoverable — "sales " with a trailing space is not the
 * Sales pillar, and there was no way to tell from the screen. Free-text values
 * already stored still work: an unrecognised group becomes its own section
 * rather than vanishing, which is the only behaviour that does not lose
 * someone's object.
 */

export interface NavItem { slug: string; label: string; icon: string; href: string; custom?: boolean; tabs?: { label: string; href: string }[] }
export interface NavGroup { group: string; pinned?: boolean; items: NavItem[] }

/**
 * Where a custom object may be filed.
 *
 * Automate and Settings are deliberately absent. They are not places you keep
 * records — putting Vehicles between "Members & roles" and "Plans & billing"
 * makes both harder to find.
 */
export const CUSTOM_OBJECT_GROUPS = ['Workspace', 'Sales', 'Finance', 'Marketing', 'HR', 'Projects', 'Team'];

const norm = (s: string) => s.trim().toLowerCase();

/** Pure: NAV + the workspace's objects → the nav to render. */
export function navWithCustomObjects(objects: CustomObject[], nav: any[] = NAV): NavGroup[] {
  const usable = objects
    .filter((o) => o.enabled !== false)
    .sort((a, b) => a.position - b.position || a.plural.localeCompare(b.plural));
  if (usable.length === 0) return nav as NavGroup[];

  const out: NavGroup[] = nav.map((g: any) => ({ ...g, items: [...g.items] }));
  const byGroup = new Map(out.map((g) => [norm(g.group), g]));
  const extra: NavGroup[] = [];

  for (const o of usable) {
    const item: NavItem = {
      // Prefixed so a custom object called "docs" cannot collide with the
      // built-in Docs entry — these slugs are React keys and badge keys.
      slug: `object:${o.slug}`,
      label: o.plural,
      icon: o.icon || 'Table2',
      href: `/objects/${o.slug}`,
      custom: true,
    };
    const key = norm(o.group_key || 'Workspace');
    const target = byGroup.get(key);
    if (target) { target.items.push(item); continue; }
    // A group nobody recognises still has to appear somewhere.
    let made = extra.find((g) => norm(g.group) === key);
    if (!made) { made = { group: (o.group_key || 'Workspace').trim(), items: [] }; extra.push(made); }
    made.items.push(item);
  }

  if (extra.length === 0) return out;
  // Before Settings, so the workspace's own sections sit with the product's
  // and configuration stays last.
  const at = out.findIndex((g) => g.group === 'Settings');
  const idx = at === -1 ? out.length : at;
  return [...out.slice(0, idx), ...extra, ...out.slice(idx)];
}

/**
 * The built-ins, as this workspace renamed, hid and re-filed them (0097).
 *
 * Runs BEFORE the custom objects are folded in, so a renamed built-in and a
 * custom object land in the same section by the same rule. Only entries that
 * point at an object are touched: `/finance/overview` is a screen, not a
 * record type, and nothing in Settings offers to rename it.
 *
 * A section that ends up empty is DROPPED. Hiding the only two things in
 * Projects and leaving a "Projects" heading with nothing under it looks like a
 * loading failure, and it is the shape people actually produce — you hide a
 * pillar by hiding its contents.
 */
export function navWithOverrides(settings: ObjectSettings, nav: any[] = NAV): NavGroup[] {
  const ovs = settings.overrides;
  if (Object.keys(ovs).length === 0) return nav as NavGroup[];

  // slug → its nav entry. Built by matching hrefs rather than by name, because
  // the nav item's own `slug` and the object's slug agree for most entries and
  // not all of them (Deals, Overview).
  const objectOf = (item: NavItem) => {
    const m = /^\/objects\/([a-z0-9_]+)$/.exec(item.href);
    return m && OBJECTS[m[1]] ? viewSlug(m[1]) : null;
  };

  const out: NavGroup[] = [];
  const moved: { group: string; item: NavItem }[] = [];

  for (const g of nav) {
    const items: NavItem[] = [];
    for (const item of g.items as NavItem[]) {
      const slug = objectOf(item);
      const ov = slug ? ovs[slug] : null;
      if (!ov) { items.push(item); continue; }
      if (ov.hidden) continue;
      const next: NavItem = { ...item, label: ov.plural?.trim() || item.label, icon: ov.icon?.trim() || item.icon };
      // An object filed into a section it is not already in moves; one filed
      // into a section that no longer exists stays where it is rather than
      // disappearing, the same rule custom objects get below.
      const target = (ov.group_key || '').trim();
      if (target && norm(target) !== norm(g.group)) { moved.push({ group: target, item: next }); continue; }
      items.push(next);
    }
    out.push({ ...g, items });
  }

  for (const { group, item } of moved) {
    const target = out.find((g) => norm(g.group) === norm(group));
    (target ?? out[0]).items.push(item);
  }

  return out.filter((g) => g.items.length > 0);
}

/**
 * Load this workspace's objects and return the merged nav.
 *
 * `enabled` exists for the command palette, which is mounted on every screen
 * but only needs this once it is opened — a list of objects nobody has asked to
 * see is a round trip on every page load.
 */
export function useNav(privy: string | null, enabled = true): NavGroup[] {
  const [objects, setObjects] = useState<CustomObject[]>([]);
  const [settings, setSettings] = useState<ObjectSettings>(EMPTY_SETTINGS);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [prefsTick, setPrefsTick] = useState(0);

  // Settings → Modules announces a save so the rail updates without a reload.
  useEffect(() => {
    const on = () => setPrefsTick((t) => t + 1);
    window.addEventListener(NAV_PREFS_EVENT, on);
    return () => window.removeEventListener(NAV_PREFS_EVENT, on);
  }, []);

  useEffect(() => {
    if (!enabled || !privy) return;
    let cancelled = false;
    getWorkspace(privy).then(async (w) => {
      if (!w?.id || cancelled) return;
      const p = await loadNavPrefs(privy, w.id);
      if (!cancelled && p) setHidden(new Set([...p.workspace, ...p.mine]));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [privy, enabled, prefsTick]);

  useEffect(() => {
    if (!enabled || !privy) return;
    let cancelled = false;
    getWorkspace(privy)
      .then(async (w) => {
        if (!w?.id || cancelled) return;
        // Both in flight together. Sequentially, the sidebar would show the
        // shipped names, then the workspace's, and the second reflow is
        // visible on every page load.
        const [objs, setts] = await Promise.all([
          loadCustomObjects(privy, w.id),
          loadObjectSettings(privy, w.id),
        ]);
        if (cancelled) return;
        if (objs?.rows) setObjects(objs.rows);
        if (setts?.settings) setSettings(setts.settings);
      })
      // A workspace that has not run 0087/0097 has no custom objects and no
      // overrides, which is the same nav as a workspace with none. Nothing to
      // report.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [privy, enabled]);

  return applyNavPrefs(navWithCustomObjects(objects, navWithOverrides(settings)), hidden);
}

// ── Modules on/off (0128) ─────────────────────────────────────────────────────
// PRESENTATION ONLY. A hidden screen is still reachable by URL and by the
// Copilot; who may do what is decided by the RPCs, never by the sidebar.

export const NAV_PREFS_EVENT = 'rb:nav-prefs';
export interface NavPrefs { workspace: string[]; mine: string[]; can_edit_workspace: boolean }

export const groupKey = (group: string) => 'g:' + norm(group);
export const itemKey = (slug: string) => 'i:' + slug.toLowerCase();

/**
 * Sections nobody may switch off as a whole. Home is where you land and
 * Settings holds the switch itself (and the AI key) — hiding either is how
 * somebody locks themselves out of undoing it. Workspace's other entries
 * (Docs, Files, Signatures, Calendar) can still be switched off one by one.
 */
export const LOCKED_GROUPS = new Set(['g:workspace', 'g:settings']);
export const LOCKED_ITEMS = new Set(['i:home', 'i:modules']);

export function applyNavPrefs(nav: NavGroup[], hidden: Set<string>): NavGroup[] {
  if (hidden.size === 0) return nav;
  return nav
    .filter((g) => LOCKED_GROUPS.has(groupKey(g.group)) || !hidden.has(groupKey(g.group)))
    .map((g) => ({ ...g, items: g.items.filter((it) => LOCKED_ITEMS.has(itemKey(it.slug)) || !hidden.has(itemKey(it.slug))) }))
    .filter((g) => g.items.length > 0);
}

export async function loadNavPrefs(privy: string, ws: string): Promise<NavPrefs | null> {
  // quiet: a workspace that has not run 0128 has nothing hidden, which is the
  // same sidebar it always had — not a load failure worth a banner.
  const { data, error } = await rpc('get_nav_prefs', { p_privy: privy, p_workspace: ws }, { quiet: true });
  if (error || !data) return null;
  const d = data as any;
  return { workspace: d.workspace || [], mine: d.mine || [], can_edit_workspace: !!d.can_edit_workspace };
}

export async function saveNavPrefs(privy: string, ws: string, scope: 'workspace' | 'mine', keys: string[]): Promise<{ error?: string }> {
  const fn = scope === 'workspace' ? 'set_workspace_nav' : 'set_my_nav';
  const { error } = await rpc(fn, { p_privy: privy, p_workspace: ws, p_hidden: keys });
  if (error) return { error: /does not exist|schema cache/i.test(error.message) ? 'Needs migration 0128.' : error.message };
  window.dispatchEvent(new Event(NAV_PREFS_EVENT));
  return {};
}
